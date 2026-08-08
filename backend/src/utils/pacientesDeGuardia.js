// Punto único de verdad de a quiénes atiende una guardia, dentro del backend
// (regla 12 de CLAUDE.md §7). Es el hermano de `panel/src/lib/pacientesDeGuardia.js`:
// la misma pregunta, contestada del lado del servidor.
//
// Una guardia es un turno, no una visita a una persona. Adentro de ese turno el Asistente
// puede atender a más de un Paciente: un matrimonio en su casa, o un grupo entero en un
// asilo. Por eso la respuesta a "¿a quién atiende esta guardia?" es siempre una lista,
// aunque casi siempre tenga un solo nombre.
//
// La lista vive en la tabla `guardia_pacientes`. La columna vieja `guardias.paciente_id`
// está en retiro: guarda a uno solo de los Pacientes y sigue existiendo únicamente como red
// de seguridad. Este archivo y el del Panel son los dos únicos lugares que la nombran.
//
// Ver la migración 20260807190000_una_guardia_puede_cubrir_varios_pacientes.sql.

import { supabase } from '../db/connection.js';

/** Lo mínimo que necesita una pantalla para nombrar y ubicar a un Paciente. */
export const CAMPOS_BASICOS = 'id, nombre, domicilio, lat, lng';

/**
 * A quiénes atiende cada una de estas guardias.
 *
 * Recibe las filas de guardia ya leídas —no los ids— porque necesita `paciente_id` para la
 * red de seguridad de abajo. Devuelve un Map de id de guardia → lista de Pacientes, ordenada
 * por nombre para que dos guardias con la misma gente se lean igual.
 *
 * `campos` tiene que incluir siempre `id`: es con lo que se arma el respaldo.
 */
export async function pacientesDeGuardias(guardias, campos = CAMPOS_BASICOS) {
  const lista = (guardias ?? []).filter(Boolean);
  const mapa = new Map();
  if (lista.length === 0) return mapa;

  const { data, error } = await supabase
    .from('guardia_pacientes')
    .select(`guardia_id, pacientes(${campos})`)
    .in(
      'guardia_id',
      lista.map((g) => g.id)
    );
  if (error) throw new Error(error.message);

  for (const fila of data ?? []) {
    if (!fila.pacientes) continue;
    if (!mapa.has(fila.guardia_id)) mapa.set(fila.guardia_id, []);
    mapa.get(fila.guardia_id).push(fila.pacientes);
  }

  // Red de seguridad: una guardia que no tenga ninguna fila en la lista se atiende con el
  // Paciente de la columna vieja, para no mostrarle al Asistente un turno sin nadie cuando
  // en realidad sí tiene a quién atender.
  const sinLista = lista.filter((g) => !mapa.has(g.id) && g.paciente_id);
  if (sinLista.length > 0) {
    const { data: sueltos, error: errorSueltos } = await supabase
      .from('pacientes')
      .select(campos)
      .in('id', [...new Set(sinLista.map((g) => g.paciente_id))]);
    if (errorSueltos) throw new Error(errorSueltos.message);

    const porId = new Map((sueltos ?? []).map((p) => [p.id, p]));
    for (const g of sinLista) {
      const paciente = porId.get(g.paciente_id);
      if (paciente) mapa.set(g.id, [paciente]);
    }
  }

  for (const delTurno of mapa.values()) {
    delTurno.sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? ''));
  }
  return mapa;
}

/** Lo mismo para una sola guardia: devuelve la lista, nunca `null`. */
export async function pacientesDeGuardia(guardia, campos = CAMPOS_BASICOS) {
  const mapa = await pacientesDeGuardias([guardia], campos);
  return mapa.get(guardia?.id) ?? [];
}

/**
 * Le agrega a cada guardia su lista de Pacientes, en el campo `pacientes`.
 *
 * Antes ese campo traía **un** Paciente (el que enganchaba PostgREST por la columna vieja) y
 * ahora trae la lista entera. El nombre se mantiene a propósito: es la misma pregunta, con
 * la respuesta completa.
 */
export async function conPacientes(guardias, campos = CAMPOS_BASICOS) {
  const mapa = await pacientesDeGuardias(guardias, campos);
  return (guardias ?? []).map((g) => ({ ...g, pacientes: mapa.get(g.id) ?? [] }));
}

/**
 * ¿Este Asistente atiende o atendió alguna vez a este Paciente?
 *
 * Es el permiso que dejan pasar los reportes anteriores y las órdenes de medicación. Se
 * pregunta contra la lista de la guardia y no contra `guardias.paciente_id`: si no, un
 * Asistente que cubre a dos personas en la misma casa vería los datos de una sola.
 */
export async function asistenteAtiendeAlPaciente(pacienteId, usuarioAsistente) {
  const { data } = await supabase
    .from('guardia_pacientes')
    .select('guardia_id, guardias!inner(asistente_id, prestadora_id)')
    .eq('paciente_id', pacienteId)
    .eq('guardias.asistente_id', usuarioAsistente.id)
    .eq('guardias.prestadora_id', usuarioAsistente.prestadoraId)
    .limit(1)
    .maybeSingle();
  return !!data;
}

/** Los ids de las guardias en las que estuvo este Paciente. */
export async function guardiasDelPaciente(pacienteId, prestadoraId) {
  const { data, error } = await supabase
    .from('guardia_pacientes')
    .select('guardia_id')
    .eq('paciente_id', pacienteId)
    .eq('prestadora_id', prestadoraId);
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((f) => f.guardia_id))];
}
