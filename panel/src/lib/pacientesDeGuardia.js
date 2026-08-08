// Punto único de verdad de a quiénes atiende una guardia, dentro del Panel
// (regla 12 de CLAUDE.md §7).
//
// Una guardia es un turno, no una visita a una persona. Adentro de ese turno el Asistente
// puede atender a más de un Paciente: un matrimonio en su casa, o un grupo entero en un
// asilo. Por eso la respuesta a "¿a quién atiende esta guardia?" es siempre una lista,
// aunque casi siempre tenga un solo nombre.
//
// La lista vive en la tabla `guardia_pacientes`. La columna vieja `guardias.paciente_id`
// está en retiro: guarda a uno solo de los Pacientes y sigue existiendo únicamente para que
// las pantallas todavía sin actualizar no se rompan. Este archivo es el único lugar que
// sabe que esa columna existe, y la usa nada más que como red de seguridad — cuando ese
// respaldo deje de hacer falta, se saca de acá y de ningún otro lado.
//
// Ver la migración 20260807190000_una_guardia_puede_cubrir_varios_pacientes.sql.

import { supabase } from './supabaseClient';

/**
 * Identificador de la fila de la grilla cuando la guardia no tiene ningún Paciente.
 *
 * Se usa una cadena y no `null` por el mismo motivo que en `cobertura.js`: `null` como clave
 * de Map se confunde con "todavía no cargó".
 */
export const SIN_PACIENTES = 'sin-pacientes';

/**
 * Trae de la base a quiénes atiende cada guardia de la lista.
 *
 * Devuelve un Map de id de guardia → array de ids de Paciente. Las guardias que no aparecen
 * en el resultado quedan fuera del Map, no con un array vacío: "no vino" y "no tiene a
 * nadie" son cosas distintas y conviene no confundirlas.
 */
export async function cargarPacientesDeGuardias(idsGuardias) {
  const ids = [...new Set((idsGuardias ?? []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from('guardia_pacientes')
    .select('guardia_id, paciente_id')
    .in('guardia_id', ids);

  if (error) throw error;

  const mapa = new Map();
  for (const fila of data ?? []) {
    if (!mapa.has(fila.guardia_id)) mapa.set(fila.guardia_id, []);
    mapa.get(fila.guardia_id).push(fila.paciente_id);
  }
  return mapa;
}

/** Lo mismo, para las series de guardias (la plantilla que las genera). */
export async function cargarPacientesDeSeries(idsSeries) {
  const ids = [...new Set((idsSeries ?? []).filter(Boolean))];
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from('series_guardias_pacientes')
    .select('serie_id, paciente_id')
    .in('serie_id', ids);

  if (error) throw error;

  const mapa = new Map();
  for (const fila of data ?? []) {
    if (!mapa.has(fila.serie_id)) mapa.set(fila.serie_id, []);
    mapa.get(fila.serie_id).push(fila.paciente_id);
  }
  return mapa;
}

/**
 * Los ids de los Pacientes de una guardia.
 *
 * Se busca primero en la lista traída de la base. Si esa guardia no está en el Map —porque
 * la pantalla todavía no pide la lista, o porque la consulta no la trajo— se cae al Paciente
 * de la columna vieja, para no mostrar una guardia sin nadie cuando en realidad sí tiene.
 */
export function pacientesDeGuardia(guardia, mapa) {
  const deLaLista = mapa?.get(guardia?.id);
  if (deLaLista?.length) return deLaLista;
  return guardia?.paciente_id ? [guardia.paciente_id] : [];
}

/** ¿Este turno cubre a más de una persona? */
export function atiendeAVarios(guardia, mapa) {
  return pacientesDeGuardia(guardia, mapa).length > 1;
}

/**
 * Le agrega a cada guardia sus Pacientes, ya con nombre.
 *
 * Deja dos campos nuevos: `paciente_ids` (los ids, en el orden en que vinieron) y
 * `pacientes_nombres` (los nombres, ordenados alfabéticamente para que dos guardias con la
 * misma gente se lean igual). Un Paciente cuyo nombre todavía no cargó no se inventa ni se
 * pierde: entra como `null` y cada pantalla decide qué poner en su lugar.
 */
export function conPacientes(guardias, mapa, nombresPorId) {
  return (guardias ?? []).map((g) => {
    const ids = pacientesDeGuardia(g, mapa);
    const nombres = ids
      .map((id) => nombresPorId?.[id] ?? null)
      .sort((a, b) => (a ?? '').localeCompare(b ?? ''));
    return { ...g, paciente_ids: ids, pacientes_nombres: nombres };
  });
}

/**
 * Qué nombres mostrar y cuántos quedaron afuera.
 *
 * En una grilla no entran veinte nombres, así que se muestran los primeros y se dice cuántos
 * faltan. Devuelve los datos, no el texto: la frase final ("y 3 más") la arma cada pantalla
 * con sus traducciones, porque este archivo no depende del idioma.
 */
export function resumenDePacientes(nombres, maximo = 2) {
  const lista = (nombres ?? []).filter(Boolean);
  return {
    visibles: lista.slice(0, maximo),
    restantes: Math.max(0, lista.length - maximo),
  };
}

/**
 * Identificador de la fila cuando la grilla agrupa por Paciente.
 *
 * Es la única vista que sigue necesitando un solo Paciente por fila: si un turno cubre a
 * tres personas, en la vista por Paciente aparece en las tres filas. Eso no duplica el
 * turno — es la misma guardia mirada desde tres lugares distintos, igual que un mismo
 * partido aparece en el calendario de los dos equipos.
 */
export function filasPorPaciente(guardia, mapa) {
  const ids = pacientesDeGuardia(guardia, mapa);
  return ids.length ? ids : [SIN_PACIENTES];
}
