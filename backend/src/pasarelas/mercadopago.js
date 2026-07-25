// Adaptador Mercado Pago — conexión OAuth (Mercado Pago Connect), suscripción vía
// "preapproval" (https://api.mercadopago.com/preapproval), el mecanismo real de Mercado
// Pago para cobro recurrente. La credencial guardada es el access_token de la cuenta
// conectada de la Prestadora (obtenido por OAuth Connect, no una clave suelta).

const API_BASE = process.env.MERCADOPAGO_API_BASE || 'https://api.mercadopago.com';

export async function crearSuscripcion({ credencial, suscripcionId, monto, familiaId }) {
  const respuesta = await fetch(`${API_BASE}/preapproval`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credencial}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reason: 'Suscripción Aurevia Marketplace',
      external_reference: suscripcionId,
      payer_email: undefined, // se completa en la ruta que llama, con el email real de la Familia
      auto_recurring: {
        frequency: 1,
        frequency_type: 'months',
        transaction_amount: monto,
        currency_id: 'ARS',
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

export function verificarWebhook({ body }) {
  // Mercado Pago no firma el webhook de `preapproval` con secreto por defecto — la
  // confirmación real se hace re-consultando `consultarEstado` con el id recibido, nunca
  // confiando en el payload del webhook a ciegas.
  const referenciaExterna = body?.data?.id;
  return { valido: Boolean(referenciaExterna), referenciaExterna, estado: 'pendiente' };
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
