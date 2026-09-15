/* Las tres traducciones al idioma de Meta.
   ==========================================================================

   QUÉ RESUELVE. Meta nombra las cosas a su manera: el nombre de una plantilla sólo admite
   minúsculas, números y guión bajo; el idioma va con guión bajo y no con guión; y el texto de la
   plantilla lleva huecos numerados que al mandar el mensaje se completan aparte. Nada de eso se le
   pide a quien escribe la plantilla en el Panel.

   POR QUÉ VIVEN SOLAS Y NO ADENTRO DE UNO DE LOS DOS ARCHIVOS QUE LAS USAN. Las usan el alta de la
   plantilla (utils/plantillasWhatsapp.js) y el envío del mensaje (utils/whatsapp.js), y el nombre
   con el que se da de alta tiene que ser exactamente el mismo con el que después se manda: si
   cada lado lo derivara por su cuenta, el día que uno cambiara el mensaje dejaría de salir sin que
   nada fallara. */

/** Los idiomas del producto, dichos como los nombra Meta. `en` sale como `en_US` porque Meta no
 *  tiene un inglés sin país y ése es el que usa por omisión para el idioma. */
const IDIOMA_PARA_META = {
  'es-AR': 'es_AR',
  en: 'en_US',
  'pt-BR': 'pt_BR',
};

/** El idioma de la plantilla, dicho como lo nombra Meta. Un idioma que el producto no tiene sale
 *  como el de la Argentina, que es el que la plantilla trae por omisión. */
export function idiomaParaMeta(idioma) {
  return IDIOMA_PARA_META[idioma] ?? IDIOMA_PARA_META['es-AR'];
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

/** Cuántos huecos declara el texto de una plantilla. Meta los escribe `{{1}}`, `{{2}}`, y lo que
 *  vale es el más alto y no cuántos hay: un texto que usa `{{1}}` dos veces lleva un solo valor. */
export function huecosDePlantilla(cuerpoTexto) {
  let mayor = 0;
  for (const hueco of String(cuerpoTexto ?? '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
    mayor = Math.max(mayor, Number(hueco[1]));
  }
  return mayor;
}

/**
 * Los valores con los que se completa una plantilla, en el orden en que los espera Meta.
 *
 * Devuelve `null` cuando el texto pide más huecos de los que hay valores para darle. No se rellena
 * con vacío a propósito: un mensaje al que le falta un dato no dice menos, dice otra cosa, y ese
 * mensaje ya no se puede desmandar. Quien llama decide qué hacer con el `null` —hoy el aviso sale
 * por correo—, que es siempre mejor que mandar una frase incompleta.
 *
 * @param {string} cuerpoTexto  El texto de la plantilla, tal como se aprobó.
 * @param {string[]} valores    Lo que hay para completarla, en orden.
 * @returns {string[]|null}
 */
export function valoresDePlantilla(cuerpoTexto, valores) {
  const huecos = huecosDePlantilla(cuerpoTexto);
  const disponibles = (valores ?? []).map((valor) => String(valor ?? '').trim()).filter(Boolean);
  if (huecos > disponibles.length) return null;
  return disponibles.slice(0, huecos);
}
