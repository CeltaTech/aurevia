// Adaptador de red de cobranza extrabancaria (Rapipago/Pago Fácil/Cobro Express) — clave
// manual de la cuenta de cobranza de la Prestadora. Genera un cupón/código de pago que la
// Familia paga en cualquier boca de la red; no hay suscripción recurrente del lado del
// proveedor, cada período genera su propio cupón, confirmado por webhook cuando se abona.

import { comprobarFirmaSinEsquemaPublicado, MOTIVO } from './firmaWebhook.js';

const API_BASE = process.env.COBRANZA_EFECTIVO_API_BASE;

/** Las redes de cobranza extrabancaria tampoco publican un esquema de firma común —cada una
 *  tiene el suyo, y ninguno está abierto—, así que este riel entra por la misma puerta que Modo
 *  y el DEBIN: sin secreto de firma cargado se rechaza todo aviso. Se corrigió junto con esos
 *  dos porque tenía exactamente el mismo agujero, y un defecto encontrado en un riel se revisa
 *  en todos (`celtatech\CLAUDE.md` §8). */
export const REQUIERE_SECRETO_FIRMA = true;

export async function crearSuscripcion({ suscripcionId }) {
  return { estadoConexion: 'pendiente', referenciaExterna: suscripcionId };
}

export async function cancelarSuscripcion() {
  return { ok: true };
}

export async function generarCupon({ credencial, monto, referencia, vencimiento }) {
  const respuesta = await fetch(`${API_BASE}/cupones`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credencial}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ monto, referencia_externa: referencia, fecha_vencimiento: vencimiento }),
  });
  const data = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(data?.mensaje || 'La red de cobranza rechazó la generación del cupón');
  }
  return { codigoCupon: data.codigo, referenciaExterna: data.id };
}

/** Comprueba que el aviso vino firmado y recién ahí lo interpreta. Antes alcanzaba con que
 *  trajera un identificador, y la dirección del webhook es pública. Ver el porqué del esquema
 *  en `firmaWebhook.js`, en `comprobarFirmaSinEsquemaPublicado`. */
export function verificarWebhook({ secretoFirma, headers, cuerpoCrudo, body, ahoraMs }) {
  const comprobacion = comprobarFirmaSinEsquemaPublicado({
    secretoFirma,
    secretoDeAmbiente: process.env.COBRANZA_EFECTIVO_SECRETO_FIRMA_WEBHOOK,
    headers,
    cuerpoCrudo,
    ahoraMs,
  });
  if (!comprobacion.valido) {
    return { valido: false, motivo: comprobacion.motivo, referenciaExterna: null, estado: 'pendiente' };
  }

  const referenciaExterna = body?.id;
  if (!referenciaExterna) {
    return { valido: false, motivo: MOTIVO.SIN_REFERENCIA, referenciaExterna: null, estado: 'pendiente' };
  }

  const mapa = { pagado: 'exitoso', vencido: 'fallido', pendiente: 'pendiente' };
  return { valido: true, motivo: null, referenciaExterna, estado: mapa[body?.estado] || 'pendiente' };
}

export async function consultarEstado({ credencial, referenciaExterna }) {
  const respuesta = await fetch(`${API_BASE}/cupones/${referenciaExterna}`, {
    headers: { Authorization: `Bearer ${credencial}` },
  });
  const data = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(data?.mensaje || 'La red de cobranza rechazó la consulta de estado');
  }
  const mapa = { pagado: 'exitoso', vencido: 'fallido', pendiente: 'pendiente' };
  return { estado: mapa[data.estado] || 'pendiente' };
}
