// Los lugares guardados de una persona: dónde acepta trabajar una Asistente, hasta dónde llega una
// coordinadora.
//
// **Escrito acá porque lo escriben dos lados.** La ficha lo cambia por su propia ruta, y el alta lo
// deja puesto de entrada, en el mismo pedido que crea a la persona. Si cada lado tuviera su copia,
// uno terminaría borrando antes de escribir y el otro no, y nadie sabría cuál de los dos deja la
// lista como la dejó quien la cargó.
//
// **Se guardan lugares, no zonas.** La zona es el atajo para marcarlos en pantalla.

import { supabase } from '../db/connection.js';

/**
 * Los lugares de varias personas de una vez, para no preguntar una por una.
 *
 * Devuelve un mapa de identificador de persona a sus lugares. Quien no tenga ninguno no aparece en
 * el mapa, que es lo mismo que decir que no llega a ningún lado.
 */
export async function lugaresDeVarias(tabla, columna, ids, prestadoraId) {
  const porPersona = new Map();
  const buscados = [...new Set((ids ?? []).filter(Boolean))];
  if (!buscados.length) return porPersona;
  const { data, error } = await supabase
    .from(tabla)
    .select(`${columna}, lugar_id`)
    .eq('prestadora_id', prestadoraId)
    .in(columna, buscados);
  if (error) throw error;
  for (const fila of data ?? []) {
    const anteriores = porPersona.get(fila[columna]) ?? [];
    anteriores.push(fila.lugar_id);
    porPersona.set(fila[columna], anteriores);
  }
  return porPersona;
}

/**
 * Quiénes de esa Prestadora tienen alguno de esos lugares guardados.
 *
 * Es la comparación que antes se hacía entre dos textos escritos a mano. Ahora las dos puntas son
 * el mismo identificador de lugar, así que una coincidencia es una coincidencia de verdad.
 */
export async function personasEnLosLugares(tabla, columna, lugares, prestadoraId) {
  const buscados = [...new Set((lugares ?? []).filter(Boolean))];
  if (!buscados.length) return [];
  const { data, error } = await supabase
    .from(tabla)
    .select(columna)
    .eq('prestadora_id', prestadoraId)
    .in('lugar_id', buscados);
  if (error) throw error;
  return [...new Set((data ?? []).map((fila) => fila[columna]))];
}

/** Los lugares guardados de esa persona, en la tabla que corresponda. */
export async function lugaresDe(tabla, columna, id, prestadoraId) {
  const { data, error } = await supabase
    .from(tabla)
    .select('lugar_id')
    .eq(columna, id)
    .eq('prestadora_id', prestadoraId);
  if (error) throw error;
  return (data ?? []).map((fila) => fila.lugar_id);
}

/**
 * Deja guardados exactamente esos lugares: borra los que había y escribe los que llegaron.
 *
 * Se borra y se escribe, y no se calcula la diferencia, porque la pantalla manda la lista entera
 * de lo que quedó tildado: comparar acá sería adivinar cuál de las dos listas es la buena.
 *
 * Que los lugares sean de esta Organización no se comprueba renglón por renglón: lo hace la clave
 * foránea compuesta, que rechaza la inserción entera si alguno no lo es. Un control escrito acá
 * además del de la base sería la misma decisión en dos lugares.
 */
export async function guardarLugaresDe(tabla, columna, id, prestadoraId, lugares) {
  const { error: errorBorrado } = await supabase
    .from(tabla)
    .delete()
    .eq(columna, id)
    .eq('prestadora_id', prestadoraId);
  if (errorBorrado) throw errorBorrado;

  const elegidos = (Array.isArray(lugares) ? lugares : []).filter(Boolean);
  if (!elegidos.length) return;
  const { error } = await supabase
    .from(tabla)
    .insert(elegidos.map((lugarId) => ({ [columna]: id, lugar_id: lugarId, prestadora_id: prestadoraId })));
  if (error) throw error;
}
