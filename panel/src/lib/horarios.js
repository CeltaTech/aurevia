// Punto único de verdad para pasar de "fecha + hora escrita" a un momento real
// (regla 12 de CLAUDE.md §7).
//
// Parece de más, pero no lo es: una guardia se guarda como una fecha (`2026-08-01`) y dos
// horas de reloj (`22:00` y `06:00`). Leído literal, esa guardia "termina" ocho horas antes
// de empezar. La guardia de noche es lo más común del rubro, así que cualquier cuenta que
// use `hora_fin` sin arreglar eso —cuántas horas duró, si ya pasaron dos horas del final,
// si se pisa con otra— da mal justamente en el caso más frecuente.
//
// Antes de este archivo, `Guardias.jsx` armaba la fecha de fin a mano y tenía ese error.
// Ahora la conversión está escrita una sola vez, acá.

const MS_POR_HORA = 60 * 60 * 1000;

/** Momento en que la guardia empieza. */
export function inicioDeGuardia(guardia) {
  return new Date(`${guardia.fecha}T${guardia.hora_inicio}`);
}

/**
 * Momento en que la guardia termina.
 *
 * Si la hora de fin es menor o igual a la de inicio, la guardia cruza la medianoche y
 * termina al día siguiente. Es la regla que hace que la guardia de noche cuente bien.
 */
export function finDeGuardia(guardia) {
  const inicio = inicioDeGuardia(guardia);
  const fin = new Date(`${guardia.fecha}T${guardia.hora_fin}`);
  if (fin <= inicio) fin.setDate(fin.getDate() + 1);
  return fin;
}

/** Cuánto dura, en horas. Sirve para sumar la carga semanal de un Asistente. */
export function horasDeGuardia(guardia) {
  return (finDeGuardia(guardia) - inicioDeGuardia(guardia)) / MS_POR_HORA;
}

/**
 * ¿Estas dos guardias se pisan?
 *
 * Se tocan por el borde no cuenta: una que termina 14:00 y otra que empieza 14:00 no se
 * superponen. Por eso las comparaciones son estrictas.
 */
export function seSuperponen(a, b) {
  return inicioDeGuardia(a) < finDeGuardia(b) && inicioDeGuardia(b) < finDeGuardia(a);
}

/** Horas de descanso entre el fin de una guardia y el inicio de otra. Negativo = se pisan. */
export function horasDeDescansoEntre(anterior, siguiente) {
  return (inicioDeGuardia(siguiente) - finDeGuardia(anterior)) / MS_POR_HORA;
}

/** La fecha de hoy en el formato en que la guarda la base: `2026-08-01`. */
export function hoyISO() {
  const ahora = new Date();
  const corrida = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60000);
  return corrida.toISOString().slice(0, 10);
}

/** Suma (o resta, con número negativo) días a una fecha `2026-08-01`. */
export function sumarDias(fechaISO, dias) {
  const f = new Date(`${fechaISO}T00:00:00`);
  f.setDate(f.getDate() + dias);
  const corrida = new Date(f.getTime() - f.getTimezoneOffset() * 60000);
  return corrida.toISOString().slice(0, 10);
}

/**
 * La hora de reloj de un momento guardado (`2026-09-09T14:19:03Z` → `14:19`), en el huso del
 * aparato que lo muestra.
 *
 * RELOJ DE 24 HORAS EN LOS TRES IDIOMAS, a propósito. El horario de una guardia sale de la base
 * escrito así —`08:00` a `16:00`— y no hay forma de escribirlo de otra manera. Dejar que el
 * idioma elija pondría «Llegó a las 08:03 a. m.» justo debajo de «08:00 - 16:00»: dos relojes
 * distintos en la misma tarjeta, que es lo que hace dudar de si llegó tarde o no.
 *
 * Devuelve cadena vacía cuando no hay momento. Un momento que falta no se dibuja como `—` acá:
 * quien llama decide qué dice cuando no hay dato, porque «no se sabe» y «no pasó» son cosas
 * distintas y esta función no puede saber cuál es.
 */
export function horaDelMomento(momento, locale) {
  if (!momento) return '';
  const fecha = new Date(momento);
  if (Number.isNaN(fecha.getTime())) return '';
  return fecha.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Corre una hora de reloj una cantidad de minutos, dando la vuelta al día si hace falta.
 * `correrHora('23:30', 60)` → `'00:30'`. La usa la acción de "correr el horario" de a muchas.
 */
export function correrHora(hora, minutos) {
  const [h, m] = hora.split(':').map(Number);
  const total = (((h * 60 + m + minutos) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
