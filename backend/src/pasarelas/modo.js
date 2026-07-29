// Adaptador Modo — la Prestadora se da de alta como comercio directamente en el portal de
// Modo (fuera de Careonys) y pega acá la clave de API resultante (mecanismo de clave manual,
// no hay OAuth Connect). El cobro es push: la Familia escanea el QR de pago que Modo genera
// y transfiere — no existe un objeto "suscripción" recurrente en Modo, cada período se
// resuelve como un cobro independiente que el webhook confirma.

const API_BASE = process.env.MODO_API_BASE || 'https://api.modo.com.ar';

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

export function verificarWebhook({ body }) {
  const referenciaExterna = body?.id;
  const mapa = { aprobado: 'exitoso', rechazado: 'fallido', pendiente: 'pendiente' };
  return { valido: Boolean(referenciaExterna), referenciaExterna, estado: mapa[body?.estado] || 'pendiente' };
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
