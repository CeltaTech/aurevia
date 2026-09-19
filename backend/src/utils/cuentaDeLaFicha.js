import { supabase } from '../db/connection.js';

// De qué cuenta cuelga una ficha, escrito una sola vez.
//
// Desde que una misma persona puede estar en varias Prestadoras, el Legajo de Asistente y el de
// Familia tienen identificador propio, y ese número ya no es el de la cuenta. Todo lo que cuelga
// del Legajo —guardias, matrículas, pacientes, avisos— guarda el del Legajo; lo de la persona
// —cómo se llama, qué teléfono tiene, con qué entra— sigue estando en la cuenta.
//
// Preguntarle a `usuarios` con un número de Legajo no devuelve nada, y el defecto no se nota: la
// pantalla muestra un nombre vacío y nadie sabe por qué. Por eso el paso de uno al otro se hace
// acá y en ningún otro lado.

/** La cuenta de una sola ficha. Devuelve el identificador de la cuenta, o `null`. */
export async function cuentaDeLaFicha(tabla, fichaId) {
  if (!fichaId) return null;
  const { data } = await supabase.from(tabla).select('usuario_id').eq('id', fichaId).maybeSingle();
  return data?.usuario_id || null;
}

/**
 * Datos de la cuenta de varias fichas de una vez, en un mapa de ficha a datos.
 *
 * `columnas` son las de `usuarios` que hacen falta —`nombre`, `telefono`—, y nunca todas: lo que
 * no se pide no viaja.
 */
export async function cuentasDeLasFichas(tabla, fichaIds, columnas) {
  const mapa = new Map();
  const unicos = [...new Set((fichaIds ?? []).filter(Boolean))];
  if (unicos.length === 0) return mapa;

  const { data, error } = await supabase
    .from(tabla)
    .select(`id, usuarios!inner(${columnas})`)
    .in('id', unicos);
  if (error) {
    console.error(`No se pudieron leer las cuentas de ${tabla}:`, error.message);
    return mapa;
  }

  for (const fila of data ?? []) mapa.set(fila.id, fila.usuarios ?? null);
  return mapa;
}
