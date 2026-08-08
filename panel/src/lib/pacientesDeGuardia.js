// Punto único de verdad de a quiénes atiende una guardia, dentro del Panel
// (regla 12 de CLAUDE.md §7).
//
// Una guardia son las horas que el Asistente pasa cuidando, no el cuidado de una persona.
// Adentro de esas horas puede atender a más de un Paciente: un matrimonio en su casa, o un
// grupo entero en una residencia. Por eso la respuesta a "¿a quién atiende esta guardia?" es siempre una lista,
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
import { con } from './textos';

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

/**
 * Los ids de los Pacientes de una guardia que ya viene enriquecida.
 *
 * Es la versión de `pacientesDeGuardia` para cuando la pantalla ya pasó por `conPacientes` y
 * no tiene el Map a mano — el caso de una guardia que viaja de una pantalla a otra. Si por lo
 * que sea llega sin enriquecer, se cae al Paciente de la columna vieja, la misma red de
 * seguridad de siempre.
 */
export function idsDePacientes(guardia) {
  if (guardia?.paciente_ids?.length) return guardia.paciente_ids;
  return guardia?.paciente_id ? [guardia.paciente_id] : [];
}

/** ¿Este turno cubre a más de una persona? */
export function atiendeAVarios(guardia, mapa) {
  return pacientesDeGuardia(guardia, mapa).length > 1;
}

/**
 * Le agrega a cada guardia sus Pacientes, ya con nombre.
 *
 * Deja tres campos nuevos: `pacientes` (la lista de `{ id, nombre }`, ordenada por nombre para
 * que dos guardias con la misma gente se lean igual) y, sacados de esa misma lista y en el
 * mismo orden, `paciente_ids` y `pacientes_nombres`.
 *
 * El id y el nombre viajan **juntos, en el mismo objeto**, y no en dos listas paralelas: dos
 * listas ordenadas por separado se desalinean sin avisar y terminan mostrando el nombre de
 * una persona al lado del id de otra.
 *
 * Un Paciente cuyo nombre todavía no cargó no se inventa ni se pierde: su nombre entra como
 * `null` y cada pantalla decide qué poner en su lugar.
 */
export function conPacientes(guardias, mapa, nombresPorId) {
  return (guardias ?? []).map((g) => {
    const pacientes = pacientesDeGuardia(g, mapa)
      .map((id) => ({ id, nombre: nombresPorId?.[id] ?? null }))
      .sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? ''));
    return {
      ...g,
      pacientes,
      paciente_ids: pacientes.map((p) => p.id),
      pacientes_nombres: pacientes.map((p) => p.nombre),
    };
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
 * En qué filas aparece una guardia cuando la grilla agrupa por Paciente.
 *
 * Es la única vista que sigue necesitando un solo Paciente por fila: si un turno cubre a
 * tres personas, en la vista por Paciente aparece en las tres filas. Eso no duplica el
 * turno — es la misma guardia mirada desde tres lugares distintos, igual que un mismo
 * partido aparece en el calendario de los dos equipos.
 *
 * Recibe la guardia ya enriquecida por `conPacientes`, porque la grilla nunca habla con la
 * base: dibuja lo que le pasan.
 */
export function filasPorPaciente(guardia) {
  const lista = guardia?.pacientes ?? [];
  if (lista.length) return lista.map((p) => p.id);
  return guardia?.paciente_id ? [guardia.paciente_id] : [SIN_PACIENTES];
}

/**
 * Los nombres, en una sola línea, para mostrar donde no entra una lista.
 *
 * Recibe los textos ya traducidos —no las claves— justamente para no depender del idioma:
 * `plantillaMas` es la frase con el hueco `{n}` ("y {n} más") y `vacio` es lo que se escribe
 * cuando la guardia no tiene a nadie.
 */
export function textoDePacientes(nombres, plantillaMas, vacio = '—') {
  const { visibles, restantes } = resumenDePacientes(nombres);
  if (visibles.length === 0) return vacio;
  const partes = [...visibles];
  if (restantes > 0) partes.push(con(plantillaMas, { n: restantes }));
  return partes.join(' · ');
}
