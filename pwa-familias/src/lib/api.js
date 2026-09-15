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
  // El día que se manda es el de este teléfono: el motor devuelve la semana que lo contiene.
  guardiasDelPaciente: (id, dia) => pedido(`/pacientes/${id}/guardias?dia=${encodeURIComponent(dia)}`),
  reportesDelPaciente: (id) => pedido(`/pacientes/${id}/reportes`),
  reporteDelPaciente: (id, reporteId) => pedido(`/pacientes/${id}/reportes/${reporteId}`),
  alertasDelPaciente: (id) => pedido(`/pacientes/${id}/alertas`),
  asistenteDelPaciente: (id) => pedido(`/pacientes/${id}/asistente`),
  verificarAsistente: (pacienteId, qrToken) => pedido(`/pacientes/${pacienteId}/verificar-asistente/${encodeURIComponent(qrToken)}`),
  calificar: (guardiaId, datos) => pedido(`/guardias/${guardiaId}/calificar`, { method: 'POST', body: JSON.stringify(datos) }),
  suscribirPush: (suscripcion) => pedido('/push/suscribir', { method: 'POST', body: JSON.stringify(suscripcion) }),
  desuscribirPush: (endpoint) => pedido('/push/suscribir', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  accesoMarketplace: (pacienteId) => pedido(`/acceso/${pacienteId}`),
  generarQrCobro: (datos) => pedido('/qr-cobro', { method: 'POST', body: JSON.stringify(datos) }),
  estadoQrCobro: (id) => pedido(`/qr-cobro/${id}`),
  // La baja en un clic. Apaga la renovación y no corta nada de lo que ya está pagado: hasta
  // cuándo alcanza vuelve en la respuesta, para poder decirlo sin volver a preguntar.
  darDeBajaAcceso: (accesoId) => pedido(`/acceso/${accesoId}/baja`, { method: 'POST' }),
  indicacionesMedicacion: (pacienteId) => pedido(`/medicacion/${pacienteId}`),
  crearIndicacionMedicacion: (pacienteId, formData) => pedido(`/medicacion/${pacienteId}`, { method: 'POST', body: formData }),
  // La instrucción del círculo familiar que el titular todavía no firmó. El perfil ya avisa que
  // hay una; esto trae el texto entero, que es lo único que no conviene mandar en cada pedido.
  instruccionPendiente: () => pedido('/instruccion-pendiente'),
  // Firmar es entrar con la clave —eso ya pasó— y confirmar con un código que se manda aparte.
  // Son dos pedidos porque son dos momentos: el código se pide cuando la persona ya leyó.
  pedirCodigoDeInstruccion: (id) => pedido(`/instruccion/${id}/codigo`, { method: 'POST' }),
  confirmarInstruccion: (id, codigo) => pedido(`/instruccion/${id}/confirmar`, { method: 'POST', body: JSON.stringify({ codigo }) }),
  // El pase de guardia (pendiente #113): el código que se le muestra al Asistente que llega. No
  // lleva el Paciente adentro porque el código es del círculo familiar entero, y quién es ese
  // círculo lo resuelve el motor con la sesión de quien pide, nunca con un dato de este teléfono.
  codigoDePresencia: () => pedido('/codigo-de-presencia'),
  // Las facturas de la Familia. La lista trae la resta ya hecha —lo facturado, lo cobrado y lo
  // que falta— porque esa resta la hace la base en un solo lugar y no se vuelve a hacer acá; el
  // detalle agrega de qué es cada renglón y qué pagos entraron contra esa factura.
  facturas: () => pedido('/facturas'),
  factura: (facturaId) => pedido(`/facturas/${facturaId}`),
  // La vidriera del Marketplace. Los filtros van vacíos cuando no se eligió ninguno, y las
  // opciones para elegir vuelven en la misma respuesta: las arma el motor con quien está
  // realmente en la vidriera, así que una zona sin nadie no se ofrece.
  asistentesDelMarketplace: ({ zona, tipo } = {}) => {
    const filtros = new URLSearchParams();
    if (zona) filtros.set('zona', zona);
    if (tipo) filtros.set('tipo', tipo);
    const cola = filtros.toString();
    return pedido(`/marketplace/asistentes${cola ? `?${cola}` : ''}`);
  },
  // El perfil público de una persona de la vidriera. De acá no sale ningún dato de contacto:
  // llegar a la persona es lo que el Marketplace vende y tiene su propio circuito.
  asistenteDelMarketplace: (id) => pedido(`/marketplace/asistentes/${id}`),
  // VER CÓMO LLEGAR A UNA PERSONA. Son dos direcciones y no una a propósito: preguntar no cobra
  // nada y contesta qué pasaría —con qué forma, cuánto sale, si eso termina el período gratuito—,
  // y abrir es un pedido aparte que sale únicamente cuando alguien toca el botón. Así ver el dato
  // de contacto nunca es el efecto de haber mirado una pantalla.
  comoEstaElContactoDelAsistente: (asistenteId) => pedido(`/marketplace/asistentes/${asistenteId}/contacto`),
  verElContactoDelAsistente: (asistenteId) =>
    pedido(`/marketplace/asistentes/${asistenteId}/contacto`, { method: 'POST' }),
  // EL CHAT CON UN ASISTENTE DE LA VIDRIERA. El chat no se cobra: lo que se cobra es el dato de
  // contacto, y por eso sale tapado de acá hasta que esa pareja lo abra. Quien tapa es el motor,
  // una sola vez para las dos puntas.
  conversacionesDelMarketplace: () => pedido('/marketplace/conversaciones'),
  conversacionDelMarketplace: (id) => pedido(`/marketplace/conversaciones/${id}`),
  // La conversación la abre siempre la Familia, desde el perfil público de la persona. Si ya
  // existía, devuelve la misma: no hay dos hilos para la misma pareja.
  abrirConversacionConAsistente: (asistenteId) =>
    pedido(`/marketplace/asistentes/${asistenteId}/conversacion`, { method: 'POST' }),
  escribirEnConversacion: (id, cuerpo) =>
    pedido(`/marketplace/conversaciones/${id}/mensajes`, { method: 'POST', body: JSON.stringify({ cuerpo }) }),
  // La videollamada de esta Prestadora. Donde no configuró ninguna, el motor contesta que no hay
  // y la pantalla no ofrece el botón.
  abrirVideollamada: (id) => pedido(`/marketplace/conversaciones/${id}/videollamada`, { method: 'POST' }),
  // Lo que la Prestadora escribió para quien cuida en su casa. Vuelve sólo lo publicado, y no
  // lleva el Paciente adentro: es material de la Prestadora para todo su círculo familiar.
  contenidos: () => pedido('/contenidos'),
  // LAS LLAVES QUE ESTA PERSONA GUARDA EN SUS APARATOS. Entrar con la huella no está acá: eso pasa
  // antes de tener sesión y va por su propia puerta (`lib/llaveDelDispositivo.js`). Acá está lo que
  // se hace desde adentro: ver cuáles tiene, agregar una en este aparato y sacar la de uno que ya
  // no usa. Lo que vuelve son fechas: ni la credencial ni la mitad pública de la llave salen del
  // motor, porque para reconocer cuál es cuál no hacen falta.
  llaves: () => pedido('/llaves'),
  desafioDeLlave: () => pedido('/llaves/desafio', { method: 'POST' }),
  guardarLlave: (respuesta) => pedido('/llaves', { method: 'POST', body: JSON.stringify({ respuesta }) }),
  sacarLlave: (id) => pedido(`/llaves/${id}`, { method: 'DELETE' }),
};
