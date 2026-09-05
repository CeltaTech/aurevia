/**
 * Las horas de una guardia, y a quién se le cuentan.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE. Desde que una guardia puede cubrir a más de un Paciente
 * (una sola guardia en una casa donde viven dos), la misma guardia se mira desde dos lados
 * distintos y las cuentas NO son la misma:
 *
 *   - Al Asistente se le pagan las horas ENTERAS, una sola vez. Estuvo ocho horas
 *     trabajando; atienda a uno o a cinco, cobra ocho. Nunca se divide.
 *     Eso lo hace el Panel (`pages/PagosAsistentes.jsx`) contando una fila por guardia.
 *
 *   - A cada Paciente se le imputan las horas REPARTIDAS entre los Pacientes que ese
 *     turno cubrió. Ocho horas y dos Pacientes son cuatro y cuatro, no ocho y ocho.
 *     Si fueran ocho y ocho, el informe diría que se trabajaron dieciséis horas donde se
 *     trabajaron ocho, y eso es cobrar dos veces la misma hora de trabajo.
 *
 * Las dos cuentas son correctas y suman distinto a propósito: una mide trabajo prestado,
 * la otra mide cuidado recibido. La única forma de que no se contradigan es que la
 * división viva en un solo lugar — este —, y no copiada en cada pantalla que la necesite
 * (regla 12 de CLAUDE.md §7).
 */

import { horasDeGuardia } from './horarios.js';

/** Un día cualquiera: sólo hace falta para poder preguntar cuándo termina el turno. */
const UN_DIA_CUALQUIERA = '2000-01-01';

/**
 * Cuántas horas dura un turno, en número (2.5 son dos horas y media).
 * Si la hora de fin es menor o igual a la de inicio, el turno cruza la medianoche.
 *
 * POR QUÉ "O IGUAL". Una guardia escrita `08:00 → 08:00` es la guardia de veinticuatro
 * horas, que en este rubro es de las más comunes. Leída literal daría cero, y cero es un
 * resultado imposible: nadie programa un turno que dura nada. Hasta el 2026-08-21 esta
 * cuenta devolvía cero en ese caso y la del Panel devolvía veinticuatro, así que la misma
 * guardia valía dos cosas distintas según quién la mirara — y la que pagaba era la de acá.
 *
 * La regla estuvo escrita igual en los dos lados hasta el 2026-09-05, que es una copia esperando
 * separarse. Hoy la cuenta la hace `utils/horarios.js` —copia máquina de
 * `panel/src/lib/horarios.js`, donde la regla de la medianoche vive una sola vez para todo el
 * producto—, y lo único propio de acá es que estas dos horas no vienen con fecha: se les presta
 * un día cualquiera, porque cuánto dura un turno no depende de qué día sea.
 */
export function horasEntre(horaInicio, horaFin) {
  return horasDeGuardia({ fecha: UN_DIA_CUALQUIERA, hora_inicio: horaInicio, hora_fin: horaFin });
}

/**
 * Las horas de ese turno que le tocan a UN Paciente, repartidas entre todos los que el
 * turno cubrió.
 *
 * `cuantosPacientes` nunca puede achicar el resultado por debajo de la división real:
 * si llega un cero o un número raro se trata como uno solo, porque quedarse corto en la
 * cantidad de Pacientes infla las horas de cada uno, que es justamente el error a evitar.
 */
export function horasImputadasAlPaciente(horasDelTurno, cuantosPacientes) {
  const entreCuantos = Number.isFinite(cuantosPacientes) && cuantosPacientes > 1 ? cuantosPacientes : 1;
  return horasDelTurno / entreCuantos;
}
