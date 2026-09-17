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
