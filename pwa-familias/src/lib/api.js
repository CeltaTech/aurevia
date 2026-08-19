import { supabase } from './supabaseClient';
import { errorDeLaRespuesta } from './errores';

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
      ...(opciones.body && !(opciones.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...opciones.headers,
    },
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    // El error lo arma lib/errores.js y no esta función: ahí viajan juntos el número de la
    // respuesta —que distingue una sesión vencida (401) de un permiso que falta (403)— y el
    // motivo, que es lo que después le permite a la pantalla explicar por qué no se pudo.
    throw errorDeLaRespuesta(respuesta, datos);
  }
  return datos;
}

export const api = {
  perfil: () => pedido('/perfil'),
  misPacientes: () => pedido('/pacientes'),
  paciente: (id) => pedido(`/pacientes/${id}`),
  reportesDelPaciente: (id) => pedido(`/pacientes/${id}/reportes`),
  reporteDelPaciente: (id, reporteId) => pedido(`/pacientes/${id}/reportes/${reporteId}`),
  alertasDelPaciente: (id) => pedido(`/pacientes/${id}/alertas`),
  asistenteDelPaciente: (id) => pedido(`/pacientes/${id}/asistente`),
  verificarAsistente: (pacienteId, qrToken) => pedido(`/pacientes/${pacienteId}/verificar-asistente/${encodeURIComponent(qrToken)}`),
  calificar: (guardiaId, datos) => pedido(`/guardias/${guardiaId}/calificar`, { method: 'POST', body: JSON.stringify(datos) }),
  suscribirPush: (suscripcion) => pedido('/push/suscribir', { method: 'POST', body: JSON.stringify(suscripcion) }),
  desuscribirPush: (endpoint) => pedido('/push/suscribir', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  suscripcionMarketplace: (pacienteId) => pedido(`/suscripcion/${pacienteId}`),
  generarQrCobro: (datos) => pedido('/qr-cobro', { method: 'POST', body: JSON.stringify(datos) }),
  estadoQrCobro: (id) => pedido(`/qr-cobro/${id}`),
  indicacionesMedicacion: (pacienteId) => pedido(`/medicacion/${pacienteId}`),
  crearIndicacionMedicacion: (pacienteId, formData) => pedido(`/medicacion/${pacienteId}`, { method: 'POST', body: formData }),
};
