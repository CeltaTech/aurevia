// Adaptador DEBIN (Débito Inmediato, mecanismo BCRA) — clave manual del PSP/banco que
// tramita el DEBIN por cuenta de la Prestadora. A diferencia de Modo/QR, el DEBIN permite
// una autorización única (`crearSuscripcion`) que habilita débitos automáticos recurrentes
// sin acción de la Familia en cada período — más cercano en mecánica a MercadoPago/Stripe
// que a los rieles de cobro manual/QR.

import { comprobarFirmaSinEsquemaPublicado, MOTIVO } from './firmaWebhook.js';

const API_BASE = process.env.DEBIN_API_BASE || process.env.DEBIN_PSP_API_BASE;

/** El DEBIN es un mecanismo del BCRA, no una pasarela con documentación pública: quien avisa es
 *  el PSP o el banco que lo tramita, y cada uno tiene la suya. La documentación abierta de PSP
 *  que se pudo consultar describe cómo **consultar** el estado de un DEBIN y no publica ninguna
 *  notificación firmada. Así que acá tampoco se reproduce ningún esquema ajeno: se exige el que
 *  declara este producto, y sin secreto de firma cargado se rechaza todo. */
export const REQUIERE_SECRETO_FIRMA = true;

export async function crearSuscripcion({ credencial, suscripcionId, monto, familiaId }) {
  const respuesta = await fetch(`${API_BASE}/debines/autorizaciones`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credencial}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ referencia_externa: suscripcionId, monto, recurrente: true, familia_id: familiaId }),
  });
  const data = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(data?.mensaje || 'El PSP rechazó la autorización de DEBIN');
  }
  return {
    estadoConexion: data.estado === 'autorizado' ? 'exitoso' : 'pendiente',
    referenciaExterna: data.id,
    urlAccion: data.url_autorizacion,
  };
}

export async function cancelarSuscripcion({ credencial, referenciaExterna }) {
  const respuesta = await fetch(`${API_BASE}/debines/autorizaciones/${referenciaExterna}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${credencial}` },
  });
  if (!respuesta.ok) {
    const data = await respuesta.json().catch(() => ({}));
    throw new Error(data?.mensaje || 'El PSP rechazó la cancelación del DEBIN');
  }
  return { ok: true };
}

/**
 * Comprueba que el aviso vino firmado y recién ahí lo interpreta (pendiente #9 del plan).
 *
 * Antes acá alcanzaba con que el aviso trajera un identificador: `valido: Boolean(body?.id)`.
 * Como la dirección del webhook es pública, eso quería decir que cualquiera que golpeara la
 * puerta con `{"id": "…", "estado": "debitado"}` daba por cobrada una suscripción.
 *
 * Cada PSP notifica a su manera y ninguno publica su esquema, así que no se le reproduce uno
 * inventado: se le exige el que declara este producto, y sin secreto de firma cargado se
 * rechaza todo. El porqué entero está en `firmaWebhook.js`,
 * en `comprobarFirmaSinEsquemaPublicado`.
 */
export function verificarWebhook({ secretoFirma, headers, cuerpoCrudo, body, ahoraMs }) {
  const comprobacion = comprobarFirmaSinEsquemaPublicado({
    secretoFirma,
    secretoDeAmbiente: process.env.DEBIN_SECRETO_FIRMA_WEBHOOK,
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

  const mapa = { debitado: 'exitoso', rechazado: 'fallido', pendiente: 'pendiente' };
  return { valido: true, motivo: null, referenciaExterna, estado: mapa[body?.estado] || 'pendiente' };
}

export async function consultarEstado({ credencial, referenciaExterna }) {
  const respuesta = await fetch(`${API_BASE}/debines/autorizaciones/${referenciaExterna}`, {
    headers: { Authorization: `Bearer ${credencial}` },
  });
  const data = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(data?.mensaje || 'El PSP rechazó la consulta de estado');
  }
  const mapa = { autorizado: 'exitoso', rechazado: 'fallido', pendiente: 'pendiente' };
  return { estado: mapa[data.estado] || 'pendiente' };
}
