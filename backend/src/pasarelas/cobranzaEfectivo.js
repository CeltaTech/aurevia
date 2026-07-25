// Adaptador de red de cobranza extrabancaria (Rapipago/Pago Fácil/Cobro Express) — clave
// manual de la cuenta de cobranza de la Prestadora. Genera un cupón/código de pago que la
// Familia paga en cualquier boca de la red; no hay suscripción recurrente del lado del
// proveedor, cada período genera su propio cupón, confirmado por webhook cuando se abona.

const API_BASE = process.env.COBRANZA_EFECTIVO_API_BASE;

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

export function verificarWebhook({ body }) {
  const referenciaExterna = body?.id;
  const mapa = { pagado: 'exitoso', vencido: 'fallido', pendiente: 'pendiente' };
  return { valido: Boolean(referenciaExterna), referenciaExterna, estado: mapa[body?.estado] || 'pendiente' };
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
