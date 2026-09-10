// Adaptador Modo — la Prestadora se da de alta como comercio directamente en el portal de
// Modo (fuera de Careonys) y pega acá la clave de API resultante (mecanismo de clave manual,
// no hay OAuth Connect). El cobro es push: la Familia escanea el QR de pago que Modo genera
// y transfiere — no existe un objeto "suscripción" recurrente en Modo, cada período se
// resuelve como un cobro independiente que el webhook confirma.

import { comprobarFirmaSinEsquemaPublicado, MOTIVO } from './firmaWebhook.js';

const API_BASE = process.env.MODO_API_BASE || 'https://api.modo.com.ar';

/** Modo no publica cómo firma sus avisos de cobro —el sitio de integraciones para comercios no
 *  tiene sección de notificaciones—, así que acá no se reproduce ningún esquema suyo: se le
 *  exige el que declara este producto (`comprobarFirmaSinEsquemaPublicado`). La marca sigue
 *  siendo `true` porque lo que decide es lo mismo de siempre: sin secreto de firma cargado, los
 *  avisos de este proveedor se rechazan, y el Panel tiene que pedírselo a la Prestadora y
 *  avisarle cuando falta. */
export const REQUIERE_SECRETO_FIRMA = true;

/** En Modo no queda nada recurrente: cada período hay que pedirle su propio QR. Con esta marca,
 *  el trabajo diario que arma los cobros (`backend/src/utils/cobrosMarketplace.js`) sabe que a
 *  este riel le toca pasar todos los meses, y que a los que cobran solos no. */
export const ARMA_COBRO_POR_PERIODO = true;

export async function crearSuscripcion({ suscripcionId }) {
  // No hay nada que crear del lado de Modo al dar de alta la suscripción — el cobro real
  // se genera período a período (ver generarCobroQr más abajo, llamado desde la ruta que
  // arma el próximo período de cobro). Acá solo se confirma que el riel está disponible.
  return { estadoConexion: 'pendiente', referenciaExterna: suscripcionId };
}

export async function cancelarSuscripcion() {
  return { ok: true };
}

export async function generarCobroQr({ credencial, monto, referencia }) {
  const respuesta = await fetch(`${API_BASE}/pagos/qr`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credencial}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ monto, referencia_externa: referencia }),
  });
  const data = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(data?.mensaje || 'Modo rechazó la generación del QR de cobro');
  }
  return { qrUrl: data.qr_url, referenciaExterna: data.id };
}

/** El nombre común con el que el trabajo diario le pide a cualquier riel de período el cobro de
 *  un mes. Cada riel devuelve lo suyo con su propio nombre —acá un QR, en la red de cobranza un
 *  cupón—; esto lo traduce a la forma única que guarda `cobros_marketplace`, para que el trabajo
 *  no tenga que saber con qué riel está hablando (`celtatech\CLAUDE.md` §8, punto único de
 *  verdad). Modo no recibe fecha de vencimiento: el QR vive lo que Modo decide. */
export async function armarCobroDelPeriodo({ credencial, monto, referencia }) {
  const { qrUrl, referenciaExterna } = await generarCobroQr({ credencial, monto, referencia });
  return { referenciaExterna, urlAccion: qrUrl, codigoCupon: null };
}

/**
 * Comprueba que el aviso vino firmado y recién ahí lo interpreta (pendiente #9 del plan).
 *
 * Antes acá alcanzaba con que el aviso trajera un identificador: `valido: Boolean(body?.id)`.
 * Como la dirección del webhook es pública, eso quería decir que cualquiera que golpeara la
 * puerta con `{"id": "…", "estado": "aprobado"}` daba por cobrada una suscripción.
 *
 * Modo no publica ningún esquema de firma, así que no se le reproduce uno inventado: se le
 * exige el que declara este producto, y sin secreto de firma cargado se rechaza todo. El
 * porqué entero está en `firmaWebhook.js`, en `comprobarFirmaSinEsquemaPublicado`.
 */
export function verificarWebhook({ secretoFirma, headers, cuerpoCrudo, body, ahoraMs }) {
  const comprobacion = comprobarFirmaSinEsquemaPublicado({
    secretoFirma,
    secretoDeAmbiente: process.env.MODO_SECRETO_FIRMA_WEBHOOK,
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

  const mapa = { aprobado: 'exitoso', rechazado: 'fallido', pendiente: 'pendiente' };
  return { valido: true, motivo: null, referenciaExterna, estado: mapa[body?.estado] || 'pendiente' };
}

export async function consultarEstado({ credencial, referenciaExterna }) {
  const respuesta = await fetch(`${API_BASE}/pagos/${referenciaExterna}`, {
    headers: { Authorization: `Bearer ${credencial}` },
  });
  const data = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(data?.mensaje || 'Modo rechazó la consulta de estado');
  }
  const mapa = { aprobado: 'exitoso', rechazado: 'fallido', pendiente: 'pendiente' };
  return { estado: mapa[data.estado] || 'pendiente' };
}
