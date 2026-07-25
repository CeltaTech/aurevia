// Adaptador DEBIN (Débito Inmediato, mecanismo BCRA) — clave manual del PSP/banco que
// tramita el DEBIN por cuenta de la Prestadora. A diferencia de Modo/QR, el DEBIN permite
// una autorización única (`crearSuscripcion`) que habilita débitos automáticos recurrentes
// sin acción de la Familia en cada período — más cercano en mecánica a MercadoPago/Stripe
// que a los rieles de cobro manual/QR.

const API_BASE = process.env.DEBIN_API_BASE || process.env.DEBIN_PSP_API_BASE;

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

export function verificarWebhook({ body }) {
  const referenciaExterna = body?.id;
  const mapa = { debitado: 'exitoso', rechazado: 'fallido', pendiente: 'pendiente' };
  return { valido: Boolean(referenciaExterna), referenciaExterna, estado: mapa[body?.estado] || 'pendiente' };
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
