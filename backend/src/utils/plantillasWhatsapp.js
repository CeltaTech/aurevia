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

/** Cómo queda el estado guardado según lo que Meta contesta, en el alta y después. Meta tiene más
 *  situaciones que las cuatro que guarda el producto, así que se agrupan por lo único que importa
 *  del lado de acá: si la plantilla se puede usar para mandar un mensaje o no. Una plantilla
 *  pausada o dada de baja por Meta no entrega, y quedarse esperando por ella sería decir que va a
 *  salir cuando no va a salir; por eso cae del mismo lado que la rechazada, y qué pasó en realidad
 *  queda escrito al lado, en la fila. */
const ESTADO_SEGUN_META = {
  APPROVED: 'aprobada',
  REJECTED: 'rechazada',
  DISABLED: 'rechazada',
  PAUSED: 'rechazada',
  PENDING: 'enviada_meta',
  IN_APPEAL: 'enviada_meta',
  PENDING_DELETION: 'enviada_meta',
};

/** Lo que dice Meta, dicho como lo guarda el producto. Lo que no está previsto queda esperando: de
 *  una respuesta que no se entiende no se deduce nunca que la plantilla está aprobada. */
export function estadoSegunMeta(loQueDiceMeta) {
  return ESTADO_SEGUN_META[String(loQueDiceMeta ?? '').toUpperCase()] ?? 'enviada_meta';
}

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
    estado: estadoSegunMeta(cuerpo.status),
  };
}

/**
 * Le pregunta a Meta cómo quedaron las plantillas de una Prestadora.
 *
 * Meta las revisa a su tiempo y el resultado llega por su aviso automático, que la Prestadora
 * configura en su panel. Esto es la otra puerta: la que se usa cuando ese aviso no está conectado,
 * cuando se perdió uno, o cuando alguien quiere mirar ahora mismo. Se trae la lista entera en un
 * pedido y no una plantilla por vez, que serían tantas llamadas como plantillas tenga.
 *
 * @param {string} prestadoraId
 * @returns {Promise<Map<string, {estado: string, motivo: string|null}>>} por identificador de Meta.
 * @throws {ErrorConMotivo} `whatsapp_sin_cuenta` o `meta_no_acepto`, igual que el alta.
 */
export async function traerEstadosDeMeta(prestadoraId) {
  const credenciales = await credencialesWhatsapp(prestadoraId);
  if (!credenciales?.wabaId) {
    throw new ErrorConMotivo('whatsapp_sin_cuenta', 'Falta la cuenta de WhatsApp Business o el token');
  }

  const estados = new Map();
  let direccion =
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${credenciales.wabaId}/message_templates` +
    '?fields=id,status,rejected_reason&limit=100';

  // Meta entrega la lista de a pedazos y deja la dirección del siguiente adentro de la respuesta.
  // El tope de vueltas no es desconfianza del servidor: es que un ciclo que depende de lo que
  // conteste un tercero tiene que terminar aunque el tercero conteste cualquier cosa.
  for (let vuelta = 0; vuelta < 20 && direccion; vuelta += 1) {
    const respuesta = await fetch(direccion, {
      headers: { Authorization: `Bearer ${credenciales.token}` },
    });
    const cuerpo = await respuesta.json().catch(() => ({}));

    if (!respuesta.ok || !Array.isArray(cuerpo.data)) {
      throw new ErrorConMotivo(
        'meta_no_acepto',
        `${respuesta.status} ${cuerpo?.error?.message ?? 'sin detalle'}`,
      );
    }

    for (const plantilla of cuerpo.data) {
      if (!plantilla?.id) continue;
      estados.set(String(plantilla.id), {
        estado: estadoSegunMeta(plantilla.status),
        motivo: motivoDeMeta(plantilla.status, plantilla.rejected_reason),
      });
    }

    direccion = cuerpo.paging?.next ?? null;
  }

  return estados;
}

/** Por qué la plantilla no se puede usar, tal como lo nombra Meta, para que quien la escribió sepa
 *  qué corregir. `NONE` es lo que Meta contesta cuando no hay nada que decir, y no se guarda. */
export function motivoDeMeta(loQueDiceMeta, razon) {
  if (estadoSegunMeta(loQueDiceMeta) !== 'rechazada') return null;
  const limpia = String(razon ?? '').toUpperCase();
  const util = limpia && limpia !== 'NONE' ? limpia : null;
  return util ? `${String(loQueDiceMeta).toUpperCase()}: ${util}` : String(loQueDiceMeta).toUpperCase();
}
