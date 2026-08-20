import { supabase } from '../db/connection.js';

// Qué es esta persona —cuidador/a, enfermero/a…— y qué le toca hacer.
//
// El catálogo vive en dos tablas y se lee siempre de la misma manera: primero el tipo,
// después sus dos listas de tareas. Está acá adentro y no copiado en cada pantalla
// porque es un catálogo, no un dato de cada guardia. Si mañana la Prestadora agrega una
// tarea, la ven todos a la vez (regla 12 de CLAUDE.md §7).
//
// El corte por Prestadora se escribe a mano en las dos consultas. El motor entra a la
// base con la llave maestra, así que las cerraduras de la base no lo frenan y el corte
// tiene que estar en el código (CLAUDE.md §7). Un tipo de la plataforma no tiene
// Prestadora y lo ven todas; uno propio, solo la Prestadora que lo creó.

/** El tipo de Asistente, si existe y si esta Prestadora puede verlo. */
export async function tipoDelAsistente(tipoAsistenteId, prestadoraId) {
  if (!tipoAsistenteId) return null;

  const { data } = await supabase
    .from('tipos_asistente')
    .select('id, clave, nombre, prestadora_id')
    .eq('id', tipoAsistenteId)
    .or(`prestadora_id.is.null,prestadora_id.eq.${prestadoraId}`)
    .maybeSingle();

  return data || null;
}

/** Las dos listas del tipo: lo que hace y lo que no hace. Siempre las dos, aunque estén vacías. */
export async function tareasDelTipo(tipoAsistenteId, prestadoraId) {
  const tareas = { corresponde: [], no_corresponde: [] };
  if (!tipoAsistenteId) return tareas;

  const { data: filas } = await supabase
    .from('tareas_tipo_asistente')
    .select('id, clase, clave, texto, orden')
    .eq('tipo_asistente_id', tipoAsistenteId)
    .or(`prestadora_id.is.null,prestadora_id.eq.${prestadoraId}`)
    .order('orden', { ascending: true });

  for (const fila of filas || []) {
    if (tareas[fila.clase]) tareas[fila.clase].push(fila);
  }
  return tareas;
}

// Las dos cosas juntas, que es como las pide cualquier pantalla. Si el tipo no existe, o
// es de otra Prestadora, no se devuelve ninguna tarea: sin tipo no hay lista que mostrar.
export async function tipoConSusTareas(tipoAsistenteId, prestadoraId) {
  const tipo = await tipoDelAsistente(tipoAsistenteId, prestadoraId);
  if (!tipo) {
    return { tipo: null, tareas: { corresponde: [], no_corresponde: [] } };
  }
  return { tipo, tareas: await tareasDelTipo(tipo.id, prestadoraId) };
}
