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
 * Manda `dias_hasta_el_fin`, que dice cuántos días después de `fecha` termina el turno: 0 el
 * mismo día, 1 al siguiente, 2 dos días después. Es lo que hace posibles las guardias de 24, 48
 * y 72 horas que cubre una sola Asistente.
 *
 * Cuando ese dato no viene se cae en la regla anterior: si la hora de fin es menor o igual a la
 * de inicio, la guardia cruza la medianoche y termina al día siguiente. Esa regla cubre la
 * guardia de noche y no sabe de nada más largo, así que es sólo la red para los turnos cargados
 * antes de que la duración se escribiera.
 */
export function finDeGuardia(guardia) {
  const inicio = inicioDeGuardia(guardia);
  const fin = new Date(`${guardia.fecha}T${guardia.hora_fin}`);
  const dias = Number(guardia?.dias_hasta_el_fin);
  if (Number.isFinite(dias) && dias >= 0) {
    fin.setDate(fin.getDate() + dias);
    return fin;
  }
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
 * El día de un momento guardado, en el huso del aparato que lo muestra. Una fecha que ya viene
 * escrita como día (`2026-08-01`) se devuelve tal cual: no tiene hora, así que no hay huso que
 * aplicarle, y pasarla por `new Date` la correría un día en los husos de menos de cero.
 */
export function diaDelMomento(momento) {
  if (!momento) return null;
  if (typeof momento === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(momento.slice(0, 10)) && !momento.includes('T')) {
    return momento.slice(0, 10);
  }
  const fecha = new Date(momento);
  if (Number.isNaN(fecha.getTime())) return null;
  const corrida = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60000);
  return corrida.toISOString().slice(0, 10);
}

/**
 * Cuántos días hace que algo está esperando. Es sólo para mostrar: cuánto tiempo lleva abierto
 * es lo que dice cuál mirar primero, y por eso se cuenta en días enteros y nunca da negativo
 * —algo anotado con fecha de mañana lleva esperando cero días, no menos uno—.
 *
 * Se cuenta de día a día y no de hora a hora a propósito: quien mira la pantalla piensa en
 * «hace tres días», no en «hace 67 horas», y contar las horas haría que la misma fila diga dos
 * y tres según a qué hora se la mire.
 */
export function diasDeEspera(desde, hasta = hoyISO()) {
  const inicio = diaDelMomento(desde);
  const fin = diaDelMomento(hasta);
  if (!inicio || !fin) return null;
  const unDia = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.round((Date.parse(`${fin}T00:00:00`) - Date.parse(`${inicio}T00:00:00`)) / unDia));
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
