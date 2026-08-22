// Adaptador Mercado Pago — conexión OAuth (Mercado Pago Connect), suscripción vía
// "preapproval" (https://api.mercadopago.com/preapproval), el mecanismo real de Mercado
// Pago para cobro recurrente. La credencial guardada es el access_token de la cuenta
// conectada de la Prestadora (obtenido por OAuth Connect, no una clave suelta).

import { IDENTIDAD } from '../config/identidadProducto.js';
import { comprobarFirma, MOTIVO } from './firmaWebhook.js';

const API_BASE = process.env.MERCADOPAGO_API_BASE || 'https://api.mercadopago.com';

/** Mercado Pago firma sus avisos con la clave secreta que la Prestadora saca del panel de
 *  Mercado Pago al configurar la notificación. El Panel lee esta marca para saber si le pide
 *  ese segundo dato o no (regla 12: la lista de quién firma vive en el adaptador, no copiada
 *  en la pantalla). */
export const REQUIERE_SECRETO_FIRMA = true;

export async function crearSuscripcion({ credencial, suscripcionId, monto, moneda, familiaId }) {
  // La moneda llega de la suscripción, que la heredó de la Prestadora. No hay valor por
  // descarte: cobrarle a una Familia en una moneda que nadie eligió es peor que fallar
  // (regla 14, §7).
  if (!moneda) throw new Error('Falta la moneda de la suscripción');

  const respuesta = await fetch(`${API_BASE}/preapproval`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credencial}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: `Suscripción ${IDENTIDAD.nombre} Marketplace`,
      external_reference: suscripcionId,
      payer_email: undefined, // se completa en la ruta que llama, con el email real de la Familia
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: monto,
        currency_id: moneda,
      },
      back_url: process.env.MERCADOPAGO_BACK_URL,
      status: 'pending',
    }),
  });
  const data = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(data?.message || 'Mercado Pago rechazó la creación de la suscripción');
  }
  return {
    estadoConexion: data.status === 'authorized' ? 'exitoso' : 'pendiente',
    referenciaExterna: data.id,
    urlAccion: data.init_point,
  };
}

export async function cancelarSuscripcion({ credencial, referenciaExterna }) {
  const respuesta = await fetch(`${API_BASE}/preapproval/${referenciaExterna}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${credencial}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'cancelled' }),
  });
  if (!respuesta.ok) {
    const data = await respuesta.json().catch(() => ({}));
    throw new Error(data?.message || 'Mercado Pago rechazó la cancelación');
  }
  return { ok: true };
}

/**
 * Comprueba que el aviso vino de Mercado Pago y recién ahí lo interpreta (pendiente #159).
 *
 * Mercado Pago manda dos cabeceras: `x-signature`, con la forma `ts=<instante>,v1=<firma>`, y
 * `x-request-id`, que identifica ese envío. Lo que se firma no es el cuerpo sino una
 * plantilla armada con tres datos —`id:<data.id>;request-id:<x-request-id>;ts:<instante>;`—
 * con la clave secreta de la notificación que la Prestadora carga en el Panel.
 *
 * El `data.id` que entra en la plantilla es el mismo que después se usa como referencia de
 * cobro: se firma exactamente lo que se va a mirar, no un dato parecido. Mercado Pago lo
 * manda en la dirección del aviso (`?data.id=…`) y también adentro del cuerpo; se prefiere el
 * de la dirección, que es el que la pasarela usó para calcular la firma, y si no viniera se
 * cae al del cuerpo. Va en minúsculas porque así lo pide Mercado Pago para los
 * identificadores con letras; para los que son solo números no cambia nada.
 *
 * **El estado sigue siendo `pendiente` a propósito.** Comprobar la firma dice que el aviso es
 * auténtico, no que la plata entró. Si además hay que volver a preguntarle el estado a
 * Mercado Pago antes de dar un cobro por bueno es una decisión del Desarrollador que sigue
 * abierta en el pendiente #159, y no se toca desde acá.
 */
export function verificarWebhook({ secretoFirma, headers, consulta, body, ahoraMs }) {
  const idDelAviso = consulta?.['data.id'] ?? body?.data?.id;
  const idDeLaRequisitoria = headers?.['x-request-id'];

  // Sin secreto guardado no hay nada contra qué comparar, y sin `x-request-id` falta un
  // tercio de lo que se firma. En los dos casos se rechaza acá, en vez de seguir con un
  // hueco en la plantilla y dejar que el resultado no coincida por accidente.
  if (!secretoFirma) {
    return { valido: false, motivo: MOTIVO.SECRETO_AUSENTE, referenciaExterna: null, estado: 'pendiente' };
  }
  if (!idDeLaRequisitoria) {
    return { valido: false, motivo: MOTIVO.CABECERA_AUSENTE, referenciaExterna: null, estado: 'pendiente' };
  }

  const comprobacion = comprobarFirma({
    secreto: secretoFirma,
    cabecera: headers?.['x-signature'],
    claveDelInstante: 'ts',
    textoFirmado: (instante) =>
      [`id:${String(idDelAviso ?? '').toLowerCase()};request-id:${idDeLaRequisitoria};ts:${instante};`],
    ahoraMs,
  });
  if (!comprobacion.valido) {
    return { valido: false, motivo: comprobacion.motivo, referenciaExterna: null, estado: 'pendiente' };
  }

  if (!idDelAviso) {
    return { valido: false, motivo: MOTIVO.SIN_REFERENCIA, referenciaExterna: null, estado: 'pendiente' };
  }

  return { valido: true, motivo: null, referenciaExterna: idDelAviso, estado: 'pendiente' };
}

export async function consultarEstado({ credencial, referenciaExterna }) {
  const respuesta = await fetch(`${API_BASE}/preapproval/${referenciaExterna}`, {
    headers: { Authorization: `Bearer ${credencial}` },
  });
  const data = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(data?.message || 'Mercado Pago rechazó la consulta de estado');
  }
  const mapa = { authorized: 'exitoso', cancelled: 'fallido', paused: 'pendiente', pending: 'pendiente' };
  return { estado: mapa[data.status] || 'pendiente' };
}
