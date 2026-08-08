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

/**
 * Cuántas horas dura un turno, en número (2.5 son dos horas y media).
 * Si la hora de fin es menor que la de inicio, el turno cruza la medianoche.
 */
export function horasEntre(horaInicio, horaFin) {
  const [hi, mi] = horaInicio.split(':').map(Number);
  const [hf, mf] = horaFin.split(':').map(Number);
  let minutos = hf * 60 + mf - (hi * 60 + mi);
  if (minutos < 0) minutos += 24 * 60; // guardia que cruza medianoche
  return minutos / 60;
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
