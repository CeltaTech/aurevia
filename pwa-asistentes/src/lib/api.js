import { supabase } from './supabaseClient';

const API_URL = import.meta.env.VITE_API_URL;

async function tokenActual() {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
}

async function pedido(ruta, opciones = {}) {
  const token = await tokenActual();
  const respuesta = await fetch(`${API_URL}/api/app-asistentes${ruta}`, {
    ...opciones,
    headers: {
      ...(opciones.body && !(opciones.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...opciones.headers,
    },
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const error = new Error(datos.error || 'Error de red');
    if (datos.yaRegistrado) error.yaRegistrado = true;
    throw error;
  }
  return datos;
}

export const api = {
  perfil: () => pedido('/perfil'),
  misGuardias: () => pedido('/guardias'),
  guardia: (id) => pedido(`/guardias/${id}`),
  checkin: (id, datos) => pedido(`/guardias/${id}/checkin`, { method: 'POST', body: JSON.stringify(datos) }),
  estructurarReporte: (id, textoLibre) =>
    pedido(`/guardias/${id}/reporte/estructurar`, { method: 'POST', body: JSON.stringify({ textoLibre }) }),
  subirFotoReporte: (id, archivo) => {
    const formData = new FormData();
    formData.append('foto', archivo);
    return pedido(`/guardias/${id}/reporte/foto`, { method: 'POST', body: formData });
  },
  confirmarReporte: (id, datos) => pedido(`/guardias/${id}/reporte/confirmar`, { method: 'POST', body: JSON.stringify(datos) }),
  reportesDelPaciente: (pacienteId) => pedido(`/pacientes/${pacienteId}/reportes`),
  medicacionDelPaciente: (pacienteId) => pedido(`/medicacion/${pacienteId}`),
  // Pendiente #102 — consentimiento para el registro de ubicación. El idioma
  // viaja en el pedido porque el texto que se guarda como constancia tiene que
  // ser el mismo que la persona leyó en pantalla.
  consentimientos: (idioma) => pedido(`/consentimientos?idioma=${encodeURIComponent(idioma)}`),
  decidirConsentimiento: (clave, decision, idioma) =>
    pedido('/consentimientos', { method: 'POST', body: JSON.stringify({ clave, decision, idioma }) }),
  retirarConsentimiento: (clave, motivo) =>
    pedido('/consentimientos/retirar', { method: 'POST', body: JSON.stringify({ clave, motivo }) }),
  suscribirPush: (suscripcion) => pedido('/push/suscribir', { method: 'POST', body: JSON.stringify(suscripcion) }),
  desuscribirPush: (endpoint) => pedido('/push/suscribir', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
};
