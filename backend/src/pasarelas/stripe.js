// Adaptador Stripe — conexión OAuth (Stripe Connect), suscripción vía la API real de
// Stripe Billing (Customers + Subscriptions). La credencial guardada es el access_token de
// la cuenta conectada de la Prestadora.

import { IDENTIDAD } from '../config/identidadProducto.js';

const API_BASE = process.env.STRIPE_API_BASE || 'https://api.stripe.com/v1';

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

export function verificarWebhook({ body }) {
  // La verificación real de firma (Stripe-Signature) requiere el webhook signing secret
  // por Prestadora, guardado junto a la credencial — se valida en la ruta de webhook antes
  // de llamar acá, este adaptador solo interpreta el evento ya verificado.
  const referenciaExterna = body?.data?.object?.id;
  const mapa = {
    'invoice.paid': 'exitoso',
    'invoice.payment_failed': 'fallido',
    'customer.subscription.deleted': 'fallido',
  };
  return { valido: Boolean(referenciaExterna), referenciaExterna, estado: mapa[body?.type] || 'pendiente' };
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
