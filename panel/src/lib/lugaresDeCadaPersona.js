// Los lugares guardados de una persona, leídos desde el Panel.
//
// **Es la misma pieza que del lado del motor**, escrita acá porque el Panel consulta la base por
// su cuenta y las dos carpetas no pueden importarse entre sí. Lo que no se repite es la decisión:
// las dos preguntan lo mismo a las mismas tablas, y la Organización la resuelve la protección por
// fila, no un filtro escrito en la pantalla.
//
// **Se guardan lugares, no zonas.** La zona es el atajo para marcarlos, y lo que queda anotado es
// cuál lugar. Por eso acá nunca se compara un texto con otro: las dos puntas son el mismo
// identificador.

import { supabase } from './supabaseClient';

/**
 * Los lugares de varias personas de una vez.
 *
 * Devuelve un mapa de identificador de persona a sus lugares. Quien no tenga ninguno no aparece,
 * que es lo mismo que decir que no llega a ningún lado.
 */
export async function lugaresDeVarias(tabla, columna, ids) {
  const porPersona = new Map();
  const buscados = [...new Set((ids ?? []).filter(Boolean))];
  if (!buscados.length) return porPersona;
  const { data, error } = await supabase.from(tabla).select(`${columna}, lugar_id`).in(columna, buscados);
  if (error) throw error;
  for (const fila of data ?? []) {
    const anteriores = porPersona.get(fila[columna]) ?? [];
    anteriores.push(fila.lugar_id);
    porPersona.set(fila[columna], anteriores);
  }
  return porPersona;
}

/** Los lugares guardados de esa persona, en la tabla que corresponda. */
export async function lugaresDe(tabla, columna, id) {
  const { data, error } = await supabase.from(tabla).select('lugar_id').eq(columna, id);
  if (error) throw error;
  return (data ?? []).map((fila) => fila.lugar_id);
}

/** Quiénes tienen alguno de esos lugares guardados. */
export async function personasEnLosLugares(tabla, columna, lugares) {
  const buscados = [...new Set((lugares ?? []).filter(Boolean))];
  if (!buscados.length) return [];
  const { data, error } = await supabase.from(tabla).select(columna).in('lugar_id', buscados);
  if (error) throw error;
  return [...new Set((data ?? []).map((fila) => fila[columna]))];
}
