import { supabase } from '../db/connection.js';
import { enviarEmailCoordinador, configuracionEvento } from './email.js';
import { idiomaParaMeta, nombreParaMeta, valoresDePlantilla } from './nombresDeMeta.js';

export const META_GRAPH_VERSION = 'v20.0';

// Credenciales por prestadora — nunca en variables de entorno globales, cada prestadora
// licenciataria tiene su propia cuenta de Meta Cloud API (docs/PRD_06_WhatsApp_IA.md punto C).
// El token nunca vive en esta tabla en texto plano: se lee desde Supabase Vault a través de
// la función leer_token_whatsapp (supabase/migrations/),
// ejecutable solo con el service role que ya usa este backend.
//
// Devuelve además `wabaId`, que es la cuenta de WhatsApp Business y no el número: los mensajes
// salen por el número y las plantillas se dan de alta contra la cuenta. Son dos identificadores
// distintos de Meta y no se pueden usar uno por otro.
export async function credencialesWhatsapp(prestadoraId) {
  const { data: config } = await supabase
    .from('configuracion_whatsapp_prestadora')
    .select('activo, phone_number_id, waba_id')
    .eq('prestadora_id', prestadoraId)
    .single();

  if (!config?.activo || !config.phone_number_id) return null;

  const { data: token, error } = await supabase.rpc('leer_token_whatsapp', { p_prestadora_id: prestadoraId });
  if (error || !token) return null;

  return { phoneNumberId: config.phone_number_id, wabaId: config.waba_id, token };
}

// Los dos mensajes de WhatsApp, y no son intercambiables.
// ======================================================================================
//
// Meta entrega texto libre solamente adentro de una conversación que abrió la otra persona, y
// durante las veinticuatro horas que sigue abierta. Un mensaje que la Prestadora empieza —un aviso
// al Coordinador, un recordatorio a la Asistente— fuera de esa ventana lo rechaza, salvo que vaya
// con una plantilla aprobada de antemano.
//
// Por eso hay dos funciones y no una con un parámetro más: quien escribe el código tiene que
// decidir cuál de los dos casos es el suyo, y esa decisión no la puede tomar el envío por su
// cuenta. `enviarWhatsApp` es la respuesta adentro de una conversación abierta;
// `enviarWhatsAppPorPlantilla`, el mensaje que empieza la Prestadora.

/** Le manda el cuerpo ya armado al número de la Prestadora. El detalle de lo que contesta Meta
 *  describe su API, así que queda del lado del servidor y no sube con el error. */
async function mandarAMeta(credenciales, mensaje) {
  const respuesta = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${credenciales.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credenciales.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...mensaje }),
    },
  );

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new Error(`whatsapp_envio_fallido: ${respuesta.status} ${detalle}`);
  }

  return respuesta.json();
}

/** Respuesta de texto libre adentro de una conversación abierta. Nunca para empezar una. */
export async function enviarWhatsApp({ prestadoraId, telefono, texto }) {
  const credenciales = await credencialesWhatsapp(prestadoraId);
  if (!credenciales) throw new Error('whatsapp_no_configurado');

  return mandarAMeta(credenciales, { to: telefono, type: 'text', text: { body: texto } });
}

/**
 * Mensaje que empieza la Prestadora, por una plantilla que Meta ya aprobó.
 *
 * La plantilla viaja por su nombre y su idioma, no por su texto: el texto lo tiene Meta desde que
 * la aprobó, y de este lado sólo salen los valores que completan sus huecos.
 *
 * @param {object} plantilla  La fila de `plantillas_whatsapp`, ya aprobada.
 * @param {string[]} valores  Con qué se completan los huecos del texto, en orden.
 * @throws {Error} `whatsapp_no_configurado`, `whatsapp_plantilla_no_aprobada`,
 *   `whatsapp_plantilla_incompleta` si el texto pide más datos de los que hay, o
 *   `whatsapp_envio_fallido` si Meta no lo aceptó.
 */
export async function enviarWhatsAppPorPlantilla({ prestadoraId, telefono, plantilla, valores }) {
  const credenciales = await credencialesWhatsapp(prestadoraId);
  if (!credenciales) throw new Error('whatsapp_no_configurado');
  if (plantilla?.estado !== 'aprobada') throw new Error('whatsapp_plantilla_no_aprobada');

  const completados = valoresDePlantilla(plantilla.cuerpo_texto, valores);
  if (completados === null) throw new Error('whatsapp_plantilla_incompleta');

  // Una plantilla sin huecos no lleva componentes: mandarle un BODY vacío es un error para Meta.
  const componentes = completados.length
    ? [{ type: 'body', parameters: completados.map((valor) => ({ type: 'text', text: valor })) }]
    : [];

  return mandarAMeta(credenciales, {
    to: telefono,
    type: 'template',
    template: {
      name: nombreParaMeta(plantilla.nombre_interno),
      language: { code: idiomaParaMeta(plantilla.idioma) },
      ...(componentes.length ? { components: componentes } : {}),
    },
  });
}

/**
 * Con qué plantilla sale un aviso por WhatsApp, si es que sale.
 *
 * Devuelve `null` cuando la Prestadora no eligió ninguna o cuando la que eligió todavía no está
 * aprobada. No se busca una parecida ni se elige la primera aprobada que haya: cuál es el mensaje
 * de cada aviso lo decide la Prestadora, y adivinarlo sería mandarle a la gente un texto que nadie
 * mandó.
 */
export async function plantillaDelEvento(plantillaId, prestadoraId) {
  if (!plantillaId) return null;

  const { data } = await supabase
    .from('plantillas_whatsapp')
    .select('id, nombre_interno, idioma, cuerpo_texto, estado')
    .eq('id', plantillaId)
    .eq('prestadora_id', prestadoraId)
    .single();

  return data?.estado === 'aprobada' ? data : null;
}

/**
 * Manda el aviso de un evento por WhatsApp, con la plantilla que la Prestadora le eligió.
 *
 * Es el único camino por el que un aviso sale por WhatsApp, y existe para que las dos condiciones
 * —la Prestadora encendió el canal para ese aviso, y le eligió una plantilla que Meta aprobó—
 * estén escritas una sola vez y no en cada proceso que avisa.
 *
 * @param {object} config     La fila de `configuracion_notificaciones` de ese evento.
 * @param {string[]} valores  Con qué se completan los huecos de la plantilla, en orden.
 * @returns {Promise<boolean>} si el mensaje salió. Falso con el canal apagado, sin teléfono, o
 *                             sin plantilla elegida o aprobada.
 * @throws lo que devuelva Meta. Quien llama decide si eso cae a otro canal o sólo se registra.
 */
export async function avisarPorWhatsapp({ config, prestadoraId, telefono, valores }) {
  if (!config?.whatsapp_activo || !telefono) return false;

  const plantilla = await plantillaDelEvento(config.plantilla_whatsapp_id, prestadoraId);
  if (!plantilla) return false;

  await enviarWhatsAppPorPlantilla({ prestadoraId, telefono, plantilla, valores });
  return true;
}

// Envío al Coordinador de un evento configurado (Módulo 8 > Notificaciones del Panel):
// intenta WhatsApp si el evento lo tiene activado, hay un teléfono de destino y la Prestadora le
// eligió una plantilla aprobada; si falla cualquiera de esas tres cosas, cae a email — nunca se
// pierde un aviso por un problema del canal WhatsApp (docs/PRD_06_WhatsApp_IA.md punto B,
// "ningún mensaje queda sin respuesta").
//
// El aviso lo empieza la Prestadora, así que va por plantilla y no por texto libre. Sin plantilla
// elegida el mensaje no se intenta: Meta lo rechazaría, y el intento retrasaría el correo que de
// todos modos hay que mandar. Los dos valores que se le dan a la plantilla son el asunto y el
// cuerpo, en ese orden; una plantilla que pida más de dos no le corresponde a este aviso y también
// cae a correo.
export async function notificarCoordinador({ evento, prestadoraId, asunto, texto, telefono }) {
  const config = await configuracionEvento(evento, prestadoraId);
  if (config && config.activo === false) return;

  try {
    const salio = await avisarPorWhatsapp({
      config,
      prestadoraId,
      telefono,
      valores: [asunto, texto],
    });
    if (salio) return;
  } catch (err) {
    console.error(`Error enviando WhatsApp de notificación (${evento}), cae a email:`, err.message);
  }

  await enviarEmailCoordinador({ evento, prestadoraId, asunto, texto });
}
