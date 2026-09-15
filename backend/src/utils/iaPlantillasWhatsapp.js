import Anthropic from '@anthropic-ai/sdk';
import { registrarUsoIA } from './registrarUsoIA.js';
import { TRATO_IA } from './tratoIA.js';
import { jsonDeRespuestaIA } from './respuestaIA.js';
import { MODELO_IA } from '../config/modeloIA.js';
import { ErrorConMotivo } from './errorConMotivo.js';
import { IDIOMA_POR_DEFECTO } from '../i18n/idiomas.js';

/* Redactar y corregir el texto de una plantilla de WhatsApp
   ==========================================================================

   QUÉ RESUELVE. Un mensaje que empieza la Prestadora sale por una plantilla que Meta aprobó de
   antemano, y Meta la aprueba o la rechaza contra reglas que son de Meta y no del negocio del
   cuidado: cuántos huecos lleva el texto, dónde pueden ir, qué cuenta como promoción. Quien
   coordina no tiene por qué saber ninguna de esas reglas, y hasta acá la pantalla se las pedía
   igual: un cuadro de texto vacío y, si Meta decía que no, una sigla en inglés al lado de la
   palabra «rechazada».

   QUÉ HACE. Redacta el texto a partir de para qué es el mensaje, y cuando Meta rechazó uno,
   propone otro leyendo lo que Meta objetó. Las dos cosas son una propuesta y nada más: la
   escribe la IA, la mira quien coordina y sale recién cuando la aprueba —así lo pidió el
   Desarrollador en `docs/PRD_06_WhatsApp_IA.md:49`, «el agente de IA asiste, pero la decisión
   final siempre queda en manos del licenciatario»—. Acá no se guarda ninguna fila ni se le manda
   nada a Meta.

   LO QUE NUNCA ENTRA EN UNA PLANTILLA. El texto viaja a Meta y queda guardado del lado de Meta,
   así que no lleva nada de una persona: ni diagnóstico, ni medicación, ni domicilio, ni nombre
   propio escrito adentro del texto. Lo que cambia mensaje por mensaje va en un hueco numerado, y
   lo que se completa en ese hueco se decide en el envío, no acá. */

/** Lo que Meta le exige a una plantilla, dicho una sola vez, porque las dos tareas se lo tienen
 *  que decir al modelo con las mismas palabras. Si se lo dijera cada una por su lado, corregir
 *  podría contradecir a redactar y nadie se enteraría hasta que Meta rechazara la corrección. */
const REGLAS_DE_LA_PLANTILLA = `REGLAS DEL TEXTO (las pone Meta y no se negocian):
- Lo que cambia en cada envío va en un hueco numerado: {{1}}, {{2}}, {{3}}, en ese orden y sin
  saltearse ninguno.
- El texto no empieza ni termina con un hueco, y nunca hay dos huecos pegados.
- Como mucho 1024 caracteres, sin saltos de línea de más y sin emojis.
- Cuanto menos huecos, mejor: Meta rechaza el texto que es casi todo huecos.

REGLAS DEL PRODUCTO (no son de Meta, son de acá):
- El texto queda guardado del lado de Meta, así que no lleva nada de ninguna persona: ningún
  nombre propio, ninguna dirección, ningún teléfono, nada de salud ni de dinero escrito adentro
  del texto. Eso va en un hueco, o no va.
- No se promete ni se ofrece nada: el mensaje avisa, y nada más.
- El texto es de una empresa que cuida personas, así que se dice corto y sereno.`;

/** El formato de la respuesta, también una sola vez. */
const FORMATO = `Se responde únicamente con un JSON de esta forma, sin texto adicional:
{"cuerpo": "...", "huecos": ["qué se completa en {{1}}", "qué se completa en {{2}}"], "nota": "..."}

"huecos" lleva un renglón por hueco, en orden, y queda vacío si el texto no tiene ninguno.
"nota" es una línea para quien coordina, con lo que conviene que sepa antes de mandarlo a Meta.`;

const SYSTEM_REDACTAR = `Este asistente ayuda a quien coordina en una empresa de cuidado de
personas a escribir el texto de una plantilla de mensaje de WhatsApp, de las que Meta tiene que
aprobar antes de que la empresa pueda usarlas para empezar una conversación.

${REGLAS_DE_LA_PLANTILLA}

${TRATO_IA}
Alcanza a "cuerpo", que lo va a leer la persona que reciba el mensaje, y a "nota", que la lee
quien coordina.

${FORMATO}`;

const SYSTEM_CORREGIR = `Este asistente ayuda a quien coordina en una empresa de cuidado de
personas a corregir el texto de una plantilla de mensaje de WhatsApp que Meta rechazó. Se recibe
el texto que se mandó y lo que Meta objetó, en la forma en que Meta lo nombra, y se devuelve otro
texto que diga lo mismo y no vuelva a chocar con esa objeción.

Se cambia lo que haya que cambiar para que Meta lo acepte, y nada más: si el motivo del rechazo
no obliga a cambiar una parte del mensaje, esa parte queda como está.

${REGLAS_DE_LA_PLANTILLA}

${TRATO_IA}
Alcanza a "cuerpo", que lo va a leer la persona que reciba el mensaje, y a "nota", que la lee
quien coordina. En "nota" se dice qué se cambió y por qué.

${FORMATO}`;

/** Cómo se le nombra al modelo cada categoría de Meta, para que no tenga que adivinar qué es. */
const QUE_ES_CADA_CATEGORIA = {
  utility: 'un aviso sobre algo que ya está en marcha: una guardia, un turno, un trámite',
  authentication: 'un código de un solo uso para confirmar la identidad de quien lo recibe',
  marketing: 'un mensaje que ofrece algo, y que por eso Meta mira con más cuidado',
};

let cliente = null;
function obtenerCliente() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!cliente) cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cliente;
}

/**
 * Le pide al modelo una propuesta de texto y devuelve lo que se puede mostrar.
 *
 * @throws {ErrorConMotivo} `ia_no_configurada` si el motor no tiene con qué hablarle al modelo, y
 *   `ia_sin_propuesta` si lo que contestó no se pudo leer. La segunda no es una falla del sistema:
 *   se vuelve a pedir y suele salir, y decirlo como falla mandaría a buscar donde no hay nada.
 */
async function proponerTexto({ system, pedido, prestadoraId }) {
  const anthropic = obtenerCliente();
  if (!anthropic) {
    throw new ErrorConMotivo('ia_no_configurada', 'Falta ANTHROPIC_API_KEY en el motor');
  }

  const respuesta = await anthropic.messages.create({
    model: MODELO_IA,
    max_tokens: 800,
    system,
    messages: [{ role: 'user', content: pedido }],
  });

  registrarUsoIA({
    prestadoraId,
    modulo: 'plantillas_whatsapp',
    modelo: MODELO_IA,
    respuestaAnthropic: respuesta,
  });

  const parseado = jsonDeRespuestaIA(respuesta);
  const cuerpo = typeof parseado?.cuerpo === 'string' ? parseado.cuerpo.trim() : '';
  if (!cuerpo) {
    throw new ErrorConMotivo('ia_sin_propuesta', 'La IA no devolvió un cuerpo de plantilla legible');
  }

  return {
    cuerpo,
    huecos: Array.isArray(parseado.huecos) ? parseado.huecos.filter((h) => typeof h === 'string') : [],
    nota: typeof parseado.nota === 'string' ? parseado.nota : null,
  };
}

/**
 * Escribe el texto de una plantilla nueva a partir de para qué es el mensaje.
 *
 * @param {object} p
 * @param {string} p.proposito  Para qué es el mensaje, escrito por quien coordina.
 * @param {string} p.categoria  La categoría de Meta: `utility`, `authentication` o `marketing`.
 * @param {string} p.idioma     El idioma de la plantilla, como lo guarda el producto (`es-AR`).
 * @param {string} p.prestadoraId
 * @returns {Promise<{cuerpo: string, huecos: string[], nota: string|null}>}
 */
export async function redactarPlantillaWhatsapp({ proposito, categoria, idioma, prestadoraId }) {
  const limpio = String(proposito ?? '').trim();
  if (!limpio) throw new ErrorConMotivo('faltan_datos', 'Falta para qué es el mensaje');

  const queEs = QUE_ES_CADA_CATEGORIA[categoria] ?? QUE_ES_CADA_CATEGORIA.utility;

  return proponerTexto({
    system: SYSTEM_REDACTAR,
    pedido: `Idioma del mensaje: ${idioma || IDIOMA_POR_DEFECTO}.
Categoría de Meta: ${categoria || 'utility'}, que es ${queEs}.
Para qué es el mensaje, en palabras de quien coordina: ${limpio}`,
    prestadoraId,
  });
}

/**
 * Propone otro texto para una plantilla que Meta rechazó, leyendo lo que Meta objetó.
 *
 * @param {object} p
 * @param {object} p.plantilla  La fila de `plantillas_whatsapp`, con su `motivo_rechazo`.
 * @param {string} p.prestadoraId
 * @returns {Promise<{cuerpo: string, huecos: string[], nota: string|null}>}
 * @throws {ErrorConMotivo} `plantilla_sin_rechazo` si no hay nada que Meta haya objetado. Sin eso
 *   la corrección sería una reescritura a ciegas de un texto que nadie dijo que estuviera mal.
 */
export async function corregirPlantillaWhatsapp({ plantilla, prestadoraId }) {
  const objecion = String(plantilla?.motivo_rechazo ?? '').trim();
  if (!objecion) {
    throw new ErrorConMotivo('plantilla_sin_rechazo', 'La plantilla no tiene ninguna objeción de Meta guardada');
  }

  const queEs = QUE_ES_CADA_CATEGORIA[plantilla.categoria] ?? QUE_ES_CADA_CATEGORIA.utility;

  return proponerTexto({
    system: SYSTEM_CORREGIR,
    pedido: `Idioma del mensaje: ${plantilla.idioma || IDIOMA_POR_DEFECTO}.
Categoría de Meta: ${plantilla.categoria || 'utility'}, que es ${queEs}.
Texto que Meta rechazó:
${plantilla.cuerpo_texto}

Lo que Meta objetó, tal como lo nombra Meta: ${objecion}`,
    prestadoraId,
  });
}
