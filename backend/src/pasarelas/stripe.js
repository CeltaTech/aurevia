// Adaptador Stripe — conexión OAuth (Stripe Connect), suscripción vía la API real de
// Stripe Billing (Customers + Subscriptions). La credencial guardada es el access_token de
// la cuenta conectada de la Prestadora.

import { IDENTIDAD } from '../config/identidadProducto.js';
import { comprobarFirma, MOTIVO } from './firmaWebhook.js';

const API_BASE = process.env.STRIPE_API_BASE || 'https://api.stripe.com/v1';

/** Stripe firma sus avisos, así que la Prestadora tiene que cargar el secreto de firma del
 *  endpoint además de la credencial de cobro. El Panel lee esta marca para saber si le pide
 *  ese segundo dato o no (regla 12: la lista de quién firma vive en el adaptador, no
 *  copiada en la pantalla). */
export const REQUIERE_SECRETO_FIRMA = true;

function form(objeto) {
  return new URLSearchParams(objeto).toString();
}

export async function crearSuscripcion({ credencial, suscripcionId, monto, moneda, familiaId }) {
  // Ver la nota de mercadopago.js: la moneda viene de la suscripción, sin valor por descarte.
  if (!moneda) throw new Error('Falta la moneda de la suscripción');

  const cliente = await llamar('/customers', credencial, {
    'metadata[suscripcion_id]': suscripcionId,
    'metadata[familia_id]': familiaId,
  });

  const precio = await llamar('/prices', credencial, {
    'currency': moneda.toLowerCase(),
    'unit_amount': Math.round(monto * 100),
    'recurring[interval]': 'month',
    'product_data[name]': `Suscripción ${IDENTIDAD.nombre} Marketplace`,
  });

  const suscripcion = await llamar('/subscriptions', credencial, {
    customer: cliente.id,
    'items[0][price]': precio.id,
    'metadata[suscripcion_id]': suscripcionId,
  });

  return {
    estadoConexion: suscripcion.status === 'active' ? 'exitoso' : 'pendiente',
    referenciaExterna: suscripcion.id,
  };
}

export async function cancelarSuscripcion({ credencial, referenciaExterna }) {
  const respuesta = await fetch(`${API_BASE}/subscriptions/${referenciaExterna}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${credencial}` },
  });
  if (!respuesta.ok) {
    const data = await respuesta.json().catch(() => ({}));
    throw new Error(data?.error?.message || 'Stripe rechazó la cancelación');
  }
  return { ok: true };
}

/**
 * Comprueba que el aviso vino de Stripe y recién ahí lo interpreta (pendiente #159).
 *
 * Stripe manda la cabecera `Stripe-Signature` con la forma `t=<instante>,v1=<firma>`, y la
 * firma es el HMAC-SHA256 de `<instante>.<cuerpo crudo>` con el secreto de firma de ese
 * endpoint (el `whsec_…` que la Prestadora carga en el Panel). El cuerpo tiene que ser el
 * que llegó, byte por byte: si express lo convirtió a objeto y se lo vuelve a convertir a
 * texto, un espacio de más o el orden de dos campos alcanzan para que la firma no dé nunca.
 * Por eso la ruta pasa `cuerpoCrudo` aparte del `body` ya leído.
 */
export function verificarWebhook({ secretoFirma, headers, cuerpoCrudo, body, ahoraMs }) {
  if (!Buffer.isBuffer(cuerpoCrudo)) {
    return { valido: false, motivo: MOTIVO.CUERPO_AUSENTE, referenciaExterna: null, estado: 'pendiente' };
  }

  const comprobacion = comprobarFirma({
    secreto: secretoFirma,
    cabecera: headers?.['stripe-signature'],
    claveDelInstante: 't',
    textoFirmado: (instante) => [`${instante}.`, cuerpoCrudo],
    ahoraMs,
  });
  if (!comprobacion.valido) {
    return { valido: false, motivo: comprobacion.motivo, referenciaExterna: null, estado: 'pendiente' };
  }

  const referenciaExterna = body?.data?.object?.id;
  if (!referenciaExterna) {
    return { valido: false, motivo: MOTIVO.SIN_REFERENCIA, referenciaExterna: null, estado: 'pendiente' };
  }

  const mapa = {
    'invoice.paid': 'exitoso',
    'invoice.payment_failed': 'fallido',
    'customer.subscription.deleted': 'fallido',
  };
  return { valido: true, motivo: null, referenciaExterna, estado: mapa[body?.type] || 'pendiente' };
}

export async function consultarEstado({ credencial, referenciaExterna }) {
  const respuesta = await fetch(`${API_BASE}/subscriptions/${referenciaExterna}`, {
    headers: { Authorization: `Bearer ${credencial}` },
  });
  const data = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(data?.error?.message || 'Stripe rechazó la consulta de estado');
  }
  const mapa = { active: 'exitoso', past_due: 'pendiente', canceled: 'fallido', unpaid: 'fallido' };
  return { estado: mapa[data.status] || 'pendiente' };
}

async function llamar(ruta, credencial, cuerpo) {
  const respuesta = await fetch(`${API_BASE}${ruta}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credencial}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form(cuerpo),
  });
  const data = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(data?.error?.message || `Stripe rechazó la llamada a ${ruta}`);
  }
  return data;
}
