import { supabase } from '../db/connection.js';
import { ausenciaQueTapaLaGuardia, ultimoDiaDeLaGuardia } from './ausenciaQueTapa.js';

// Una guardia de cobertura no arranca hasta que tiene sustituto
// (docs/PRD_02B_Gestion_Personal.md:187).
//
// QUÉ ES ESTE CASO. El Asistente que tiene la guardia pide una licencia, se la registran, y la
// guardia queda tapada: esa persona no va a ir. Mientras la Prestadora no le asigne un sustituto,
// esa guardia no tiene quién la haga, y el Panel la muestra en la lista de las que quedaron sin
// cubrir. Lo que faltaba es que la agenda lo sostenga: hasta acá, el titular de la licencia podía
// marcar la llegada igual y la guardia pasaba a activa, con lo cual desaparecía de esa lista sin
// que nadie hubiera resuelto nada.
//
// POR QUÉ SE COMPRUEBA AL MARCAR LA LLEGADA Y NO EN OTRO LADO. Pasar a `activa` ocurre en un solo
// lugar de todo el producto —el check-in de `routes/appAsistentes.js`—, así que la guarda entra
// ahí y no hay ningún otro camino que la esquive.
//
// POR QUÉ ALCANZA CON PREGUNTAR SI HAY FILA. `guardias_cobertura.asistente_sustituto_id` es una
// columna obligatoria, así que una fila de cobertura ES un sustituto asignado: no existe la fila
// a medio llenar. Y por eso la pregunta de acá se puede contestar sin leer de quién se trata.
//
// EL TIPO DE LICENCIA NO ENTRA. La consulta pide las tres columnas que hacen falta para saber si
// la ausencia tapa el día, y ninguna más: por qué esa persona está de licencia es información de
// salud y no sale del legajo (CLAUDE.md §6, y la razón larga está escrita en
// `utils/ausenciaQueTapa.js`).

/** El motivo que viaja hasta la pantalla del Asistente. La frase la busca ella, en su idioma. */
export const MOTIVO_SIN_SUSTITUTO = 'guardia_de_cobertura_sin_sustituto';

/**
 * ¿Esta guardia está tapada por una licencia y todavía no tiene sustituto asignado?
 *
 * @param {object} guardia  La guardia como viene de la base: hacen falta `id`, `asistente_id`,
 *                          `prestadora_id`, `fecha`, `hora_inicio` y `hora_fin`.
 * @returns {Promise<boolean>} `true` solamente cuando hay licencia registrada que la tapa y no
 *                          hay ninguna fila de cobertura. Ante cualquier otra cosa, `false`: esto
 *                          frena una guardia, y una consulta que no se pudo hacer no es motivo
 *                          para dejar a alguien afuera de su trabajo en la puerta de una casa.
 */
export async function faltaElSustituto(guardia) {
  if (!guardia?.id || !guardia?.asistente_id || !guardia?.fecha) return false;

  const { data: ausencias, error: errorAusencias } = await supabase
    .from('ausencias')
    .select('asistente_id, fecha_inicio, fecha_fin')
    .eq('asistente_id', guardia.asistente_id)
    .eq('prestadora_id', guardia.prestadora_id)
    .lte('fecha_inicio', ultimoDiaDeLaGuardia(guardia));
  if (errorAusencias) {
    console.error('[guardiaSinSustituto] no se pudieron leer las ausencias', errorAusencias);
    return false;
  }
  if (!ausenciaQueTapaLaGuardia(guardia, ausencias)) return false;

  const { data: coberturas, error: errorCobertura } = await supabase
    .from('guardias_cobertura')
    .select('id')
    .eq('guardia_original_id', guardia.id)
    .eq('prestadora_id', guardia.prestadora_id)
    .limit(1);
  if (errorCobertura) {
    console.error('[guardiaSinSustituto] no se pudo leer la cobertura', errorCobertura);
    return false;
  }

  return !coberturas?.length;
}
