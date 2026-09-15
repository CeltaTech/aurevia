import { credencialesWhatsapp, META_GRAPH_VERSION } from './whatsapp.js';
import { ErrorConMotivo } from './errorConMotivo.js';

/* Dar de alta una plantilla de mensaje en Meta.
   ==========================================================================

   QUÉ RESUELVE. Un mensaje que la Prestadora empieza —no una respuesta adentro de una
   conversación que abrió la otra persona— Meta sólo lo entrega si el texto está aprobado de
   antemano. Hasta acá el botón «Enviar a Meta» del Panel cambiaba el estado guardado y nada más:
   la plantilla quedaba escrita como enviada sin que Meta se hubiera enterado, y el día que
   hiciera falta usarla el mensaje rebotaba. Acá se hace el pedido de verdad y se guarda el
   identificador que Meta devuelve, que es con lo que después se manda el mensaje y con lo que se
   pregunta si la aprobaron.

   LAS PLANTILLAS SON DE LA CUENTA, NO DEL NÚMERO. Se dan de alta contra el identificador de la
   cuenta de WhatsApp Business (`waba_id`), que es otro que el del número por el que salen los
   mensajes. Una Prestadora puede tener el número configurado y la cuenta no, y entonces esto no
   se puede hacer todavía; se dice así y no como una falla del sistema.

   LO QUE META EXIGE Y ACÁ SE TRADUCE. El nombre sólo admite minúsculas, números y guión bajo, y
   el idioma va con guión bajo y no con guión. Nada de eso se le pide a quien carga la plantilla:
   el nombre que se ve es el que escribió, y lo que viaja es su forma admitida. Si se le pidiera a
   la persona, la pantalla estaría enseñando las reglas de un tercero. */

/** Los idiomas del producto, dichos como los nombra Meta. `en` sale como `en_US` porque Meta no
 *  tiene un inglés sin país y ése es el que usa por omisión para el idioma. */
const IDIOMA_PARA_META = {
  'es-AR': 'es_AR',
  en: 'en_US',
  'pt-BR': 'pt_BR',
};

/** Cómo queda el estado guardado según lo que Meta contesta. Meta revisa algunas plantillas en el
 *  momento y otras las deja pendientes; las tres respuestas están previstas para no guardar
 *  «esperando» una que ya se resolvió. */
const ESTADO_SEGUN_META = {
  APPROVED: 'aprobada',
  REJECTED: 'rechazada',
  PENDING: 'enviada_meta',
};

/** El nombre con el que la plantilla queda dada de alta en Meta, derivado del que se ve en el
 *  Panel. Lo que no es letra, número o guión bajo pasa a ser guión bajo, y las mayúsculas bajan. */
export function nombreParaMeta(nombreInterno) {
  return nombreInterno
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512);
}

/**
 * Da de alta la plantilla en Meta y devuelve lo que hay que guardar.
 *
 * @param {object} plantilla  La fila de `plantillas_whatsapp`.
 * @returns {Promise<{metaTemplateId: string, estado: string}>}
 * @throws {ErrorConMotivo} `whatsapp_sin_cuenta` si la Prestadora no tiene la cuenta configurada,
 *   `meta_no_acepto` si Meta rechazó el pedido —el detalle queda del lado del servidor—.
 */
export async function darDeAltaEnMeta(plantilla) {
  const credenciales = await credencialesWhatsapp(plantilla.prestadora_id);
  if (!credenciales?.wabaId) {
    throw new ErrorConMotivo('whatsapp_sin_cuenta', 'Falta la cuenta de WhatsApp Business o el token');
  }

  const respuesta = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${credenciales.wabaId}/message_templates`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credenciales.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: nombreParaMeta(plantilla.nombre_interno),
        language: IDIOMA_PARA_META[plantilla.idioma] ?? IDIOMA_PARA_META['es-AR'],
        category: plantilla.categoria.toUpperCase(),
        components: [{ type: 'BODY', text: plantilla.cuerpo_texto }],
      }),
    },
  );

  const cuerpo = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok || !cuerpo.id) {
    // Lo que Meta contesta cuando no acepta describe su propia API. Sube el motivo, y el detalle
    // se queda del lado del servidor y en la fila, para quien tenga que corregir la plantilla.
    throw new ErrorConMotivo(
      'meta_no_acepto',
      `${respuesta.status} ${cuerpo?.error?.message ?? 'sin detalle'}`,
    );
  }

  return {
    metaTemplateId: String(cuerpo.id),
    estado: ESTADO_SEGUN_META[cuerpo.status] ?? 'enviada_meta',
  };
}
