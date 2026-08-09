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
    // El número de la respuesta viaja con el error: es lo que le permite a lib/errores.js
    // distinguir una sesión vencida (401) de un permiso que falta (403) sin leer el texto.
    error.status = respuesta.status;
    if (datos.yaRegistrado) error.yaRegistrado = true;
    // El motivo permite que la pantalla explique por qué no se pudo (falta el reporte,
    // continuidad de guardia) en vez de mostrar siempre el mismo error genérico.
    if (datos.motivo) error.motivo = datos.motivo;
    // Cuando falta un reporte, el backend dice de quiénes falta. Con un turno que cubre a
    // tres personas, "falta un reporte" no le dice al Asistente cuál le quedó pendiente.
    if (datos.pacientesSinReporte) error.pacientesSinReporte = datos.pacientesSinReporte;
    throw error;
  }
  return datos;
}

export const api = {
  perfil: () => pedido('/perfil'),
  misGuardias: () => pedido('/guardias'),
  guardia: (id) => pedido(`/guardias/${id}`),
  checkin: (id, datos) => pedido(`/guardias/${id}/checkin`, { method: 'POST', body: JSON.stringify(datos) }),
  checkout: (id, datos) => pedido(`/guardias/${id}/checkout`, { method: 'POST', body: JSON.stringify(datos) }),
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
  // La Matrícula. Se carga en un solo envío —datos y archivo juntos— porque un
  // archivo sin su ficha es un papel suelto que nadie va a mirar.
  matricula: () => pedido('/matricula'),
  cargarMatricula: ({ numeroMatricula, vigenteDesde, vigenteHasta, archivo }) => {
    const formData = new FormData();
    if (numeroMatricula) formData.append('numeroMatricula', numeroMatricula);
    formData.append('vigenteDesde', vigenteDesde);
    if (vigenteHasta) formData.append('vigenteHasta', vigenteHasta);
    if (archivo) formData.append('archivo', archivo);
    return pedido('/matricula', { method: 'POST', body: formData });
  },
  archivoDeMatricula: (ruta) => pedido(`/matricula/archivo-url?ruta=${encodeURIComponent(ruta)}`),
  suscribirPush: (suscripcion) => pedido('/push/suscribir', { method: 'POST', body: JSON.stringify(suscripcion) }),
  desuscribirPush: (endpoint) => pedido('/push/suscribir', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
};
