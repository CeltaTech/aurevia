import { supabase } from './supabaseClient';
import { errorDeLaRespuesta } from './errores';

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
    // El error lo arma lib/errores.js y no esta función: ahí viajan juntos el número de la
    // respuesta —que distingue una sesión vencida (401) de un permiso que falta (403)— y el
    // motivo, que es lo que después le permite a la pantalla explicar por qué no se pudo.
    const error = errorDeLaRespuesta(respuesta, datos);
    if (datos.yaRegistrado) error.yaRegistrado = true;
    // Cuando falta un reporte, el motor dice de quiénes falta. Con un turno que cubre a
    // tres personas, "falta un reporte" no le dice al Asistente cuál le quedó pendiente.
    if (datos.pacientesSinReporte) error.pacientesSinReporte = datos.pacientesSinReporte;
    throw error;
  }
  return datos;
}

export const api = {
  perfil: () => pedido('/perfil'),
  // Sus papeles y su Certificado. Va aparte de `/perfil` porque `/perfil` lo pide la aplicación
  // al arrancar y esto lo mira quien entró a Mi Perfil.
  papeles: () => pedido('/perfil/papeles'),
  // El interruptor de disponibilidad. No lleva el identificador de nadie: la sesión decide sobre
  // qué ficha se escribe, y lo que vuelve es lo que quedó guardado, no lo que se mandó.
  cambiarDisponibilidad: (disponible) =>
    pedido('/perfil/disponibilidad', { method: 'PATCH', body: JSON.stringify({ disponible }) }),
  misGuardias: () => pedido('/guardias'),
  guardia: (id) => pedido(`/guardias/${id}`),
  checkin: (id, datos) => pedido(`/guardias/${id}/checkin`, { method: 'POST', body: JSON.stringify(datos) }),
  checkout: (id, datos) => pedido(`/guardias/${id}/checkout`, { method: 'POST', body: JSON.stringify(datos) }),
  // Los dos actos de antes de llegar (pendiente #101). Son deliberados: los aprieta la persona,
  // y por eso quedan guardados como acto suyo y no como una cuenta del sistema. Ninguno de los
  // dos exige ubicación: sin GPS se manda igual y lo único que se pierde es la estimación.
  registrarSalida: (id, datos) => pedido(`/guardias/${id}/salida`, { method: 'POST', body: JSON.stringify(datos) }),
  avisarDemora: (id, datos) => pedido(`/guardias/${id}/aviso-demora`, { method: 'POST', body: JSON.stringify(datos) }),
  // Lo que pasa durante la guardia y no admite esperar al cierre. Manda el momento en que pasó,
  // porque si el aviso queda en la cola sin conexión lo que importa es esa hora y no la de la
  // sincronización.
  avisarEmergencia: (id, datos) => pedido(`/guardias/${id}/emergencia`, { method: 'POST', body: JSON.stringify(datos) }),
  // El descanso adentro de una guardia larga. No cierra nada ni descuenta nada: deja constancia.
  empezarDescanso: (id, datos) => pedido(`/guardias/${id}/descanso/empezar`, { method: 'POST', body: JSON.stringify(datos) }),
  terminarDescanso: (id, datos) => pedido(`/guardias/${id}/descanso/terminar`, { method: 'POST', body: JSON.stringify(datos) }),
  // El pase de guardia (pendiente #113). Tres pedidos y ninguno más:
  //   - el código que este Asistente muestra cuando es él el que se va y llega el relevo;
  //   - el aviso de que no hay nadie que pueda mostrarle el código, que aparece en la pantalla
  //     de la Prestadora;
  //   - en qué quedó ese aviso, que la pantalla pregunta sola mientras espera.
  // El código que se tipea no viaja por acá: va adentro del mismo checkin o checkout, junto con
  // la ubicación, porque comprobar la presencia y marcar la llegada son un solo acto.
  codigoDePresencia: () => pedido('/codigo-de-presencia'),
  pedirCodigoALaPrestadora: (id, { momento, texto }) =>
    pedido(`/guardias/${id}/comprobacion/pedido`, { method: 'POST', body: JSON.stringify({ momento, texto }) }),
  estadoDeComprobacion: (id, momento) => pedido(`/guardias/${id}/comprobacion/${momento}`),
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
  // Las guardias que le ofrecieron y todavía puede tomar. El motivo del rechazo es opcional:
  // se pregunta, no se exige — obligar a explicarse antes de poder decir que no es una forma
  // de que nadie diga que no.
  ofertas: () => pedido('/ofertas'),
  responderOferta: (id, respuesta, motivo) =>
    pedido(`/ofertas/${id}/responder`, { method: 'POST', body: JSON.stringify({ respuesta, motivo }) }),
  // Las calificaciones que le pusieron, y el descargo que puede dejar ante cada una. El
  // descargo se carga una sola vez y no se edita nunca: la base lo sostiene con la policy
  // `asistente_carga_su_descargo`, que sólo deja escribir mientras el campo esté vacío.
  calificaciones: () => pedido('/calificaciones'),
  cargarDescargo: (id, descargo) =>
    pedido(`/calificaciones/${id}/descargo`, { method: 'PATCH', body: JSON.stringify({ descargo }) }),
  suscribirPush: (suscripcion) => pedido('/push/suscribir', { method: 'POST', body: JSON.stringify(suscripcion) }),
  desuscribirPush: (endpoint) => pedido('/push/suscribir', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  // EL CHAT CON UNA FAMILIA DE LA VIDRIERA. Es el mismo hilo que ve la Familia, mirado desde la
  // otra punta. El dato de contacto sale tapado para los dos lados hasta que esa pareja lo abra:
  // tapar de un solo lado no taparía nada, porque alcanza con que lo escriba el otro.
  conversacionesDelMarketplace: () => pedido('/marketplace/conversaciones'),
  conversacionDelMarketplace: (id) => pedido(`/marketplace/conversaciones/${id}`),
  escribirEnConversacion: (id, cuerpo) =>
    pedido(`/marketplace/conversaciones/${id}/mensajes`, { method: 'POST', body: JSON.stringify({ cuerpo }) }),
  abrirVideollamada: (id) => pedido(`/marketplace/conversaciones/${id}/videollamada`, { method: 'POST' }),
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
