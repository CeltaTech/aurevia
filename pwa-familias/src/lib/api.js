import { supabase } from './supabaseClient';

const API_URL = import.meta.env.VITE_API_URL;

async function tokenActual() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

async function pedido(ruta, opciones = {}) {
  const token = await tokenActual();
  const respuesta = await fetch(`${API_URL}/api/app-familias${ruta}`, {
    ...opciones,
    headers: {
      ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...opciones.headers,
    },
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    throw new Error(datos.error || 'Error de red');
  }
  return datos;
}

export const api = {
  perfil: () => pedido('/perfil'),
  misPacientes: () => pedido('/pacientes'),
  paciente: (id) => pedido(`/pacientes/${id}`),
  reportesDelPaciente: (id) => pedido(`/pacientes/${id}/reportes`),
  alertasDelPaciente: (id) => pedido(`/pacientes/${id}/alertas`),
  asistenteDelPaciente: (id) => pedido(`/pacientes/${id}/asistente`),
  verificarAsistente: (pacienteId, qrToken) => pedido(`/pacientes/${pacienteId}/verificar-asistente/${encodeURIComponent(qrToken)}`),
  calificar: (guardiaId, datos) => pedido(`/guardias/${guardiaId}/calificar`, { method: 'POST', body: JSON.stringify(datos) }),
  suscribirPush: (suscripcion) => pedido('/push/suscribir', { method: 'POST', body: JSON.stringify(suscripcion) }),
  desuscribirPush: (endpoint) => pedido('/push/suscribir', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  suscripcionMarketplace: (pacienteId) => pedido(`/suscripcion/${pacienteId}`),
  generarQrCobro: (datos) => pedido('/qr-cobro', { method: 'POST', body: JSON.stringify(datos) }),
  estadoQrCobro: (id) => pedido(`/qr-cobro/${id}`),
};
