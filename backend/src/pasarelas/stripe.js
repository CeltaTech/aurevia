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

/** Cada cuánto cobra Stripe, dicho como lo pide él: `interval` con su `interval_count`. Las cuatro
 *  unidades que la Prestadora puede elegir tienen las cuatro su equivalente, así que acá no hay
 *  ninguna cuenta que hacer. */
const INTERVALO_STRIPE = { dia: 'day', semana: 'week', mes: 'month', anio: 'year' };

function recurrenciaStripe(periodo) {
  const cantidad = periodo?.cantidad;
  const intervalo = INTERVALO_STRIPE[periodo?.unidad];
  if (!cantidad || !periodo?.unidad) {
    throw new Error('Falta cada cuánto se cobra esta forma de cobro');
  }
  if (!intervalo) throw new Error(`unidad de período desconocida: ${periodo.unidad}`);
  return { 'recurring[interval]': intervalo, 'recurring[interval_count]': cantidad };
}

/** El período gratuito, dicho como lo pide Stripe: `trial_end`, en segundos desde 1970. Stripe cobra
 *  el primer período apenas se crea la suscripción, así que sin esto el período gratuito que armó la
 *  Prestadora no existiría del lado del proveedor por más que estuviera guardado acá.
 *  Una fecha que ya pasó no se manda: Stripe rechaza el alta entera por un `trial_end` vencido, y lo
 *  que corresponde en ese caso es justamente lo que hace Stripe sin la marca, cobrar ya. */
function pruebaGratisStripe(gratisHasta) {
  if (!gratisHasta) return {};
  const instante = Date.parse(`${gratisHasta}T00:00:00Z`);
  if (!Number.isFinite(instante) || instante <= Date.now()) return {};
  return { trial_end: Math.floor(instante / 1000) };
}

export async function crearSuscripcion({
  credencial,
  accesoId,
  monto,
  moneda,
  periodo,
  gratisHasta,
  familiaId,
  emailPagador,
}) {
  // Ver la nota de mercadopago.js: la moneda viene del acceso, sin valor por descarte.
  if (!moneda) throw new Error('Falta la moneda del acceso');
  const recurrencia = recurrenciaStripe(periodo);
  // Stripe crea igual un cliente sin correo, pero entonces no le manda ningún comprobante a la
  // Familia y el cobro le aparece en el resumen sin haber recibido nada. Se corta acá, con el
  // mismo criterio que la moneda: falta un dato del que depende el cobro.
  if (!emailPagador) throw new Error('Falta el correo de la Familia que va a pagar');

  const cliente = await llamar('/customers', credencial, {
    email: emailPagador,
    'metadata[acceso_id]': accesoId,
    'metadata[familia_id]': familiaId,
  });

  const precio = await llamar('/prices', credencial, {
    'currency': moneda.toLowerCase(),
    'unit_amount': Math.round(monto * 100),
    ...recurrencia,
    'product_data[name]': `Suscripción ${IDENTIDAD.nombre} Marketplace`,
  });

  const suscripcion = await llamar('/subscriptions', credencial, {
    customer: cliente.id,
    'items[0][price]': precio.id,
    'metadata[acceso_id]': accesoId,
    ...pruebaGratisStripe(gratisHasta),
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

  // Qué identificador se devuelve. Lo que este producto guardó al dar de alta es la suscripción
  // de Stripe, no la factura de cada mes: la factura nace del lado de Stripe y acá no existe
  // hasta que llega este aviso. Así que en el aviso de una factura se mira a qué suscripción
  // pertenece, y sólo si no lo dice se usa el identificador del objeto —que es lo correcto para
  // `customer.subscription.deleted`, donde el objeto *es* la suscripción—. Stripe pone ese dato
  // en dos lugares según la versión de su API y se prueban los dos, porque devolver el
  // identificador de la factura equivale a no encontrar nunca nada.
  const objeto = body?.data?.object;
  const referenciaExterna =
    objeto?.subscription || objeto?.parent?.subscription_details?.subscription || objeto?.id;
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
