// Adaptador de efectivo en mano — cobranza directa y personal, sin procesador de pago de
// por medio. No requiere credencial (no hay fila en credenciales_pasarela_pago para este
// proveedor). El registro del cobro lo hace el Coordinador/Admin_prestadora desde el Panel
// (carga manual) o se genera automáticamente al canjear un qr_cobro_efectivo escaneado —
// ambos casos insertan directo en `cobros_marketplace` con `estado_cobro = 'exitoso'` desde
// la ruta que llama, este adaptador no tiene nada que confirmar de forma asíncrona.

export async function crearSuscripcion({ suscripcionId }) {
  return { estadoConexion: 'exitoso', referenciaExterna: suscripcionId };
}

export async function cancelarSuscripcion() {
  return { ok: true };
}

export function verificarWebhook() {
  // No aplica: efectivo en mano no tiene webhook, la confirmación es siempre un acto
  // humano (carga manual o escaneo de QR), nunca una notificación de un tercero.
  return { valido: false, referenciaExterna: null, estado: 'pendiente' };
}

export async function consultarEstado() {
  return { estado: 'pendiente' };
}
