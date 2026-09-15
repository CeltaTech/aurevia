// La única cuenta que contesta "¿este Asistente está de licencia el día de esta guardia?".
//
// POR QUÉ VIVE EN UN ARCHIVO PROPIO. La pregunta se hace en dos lados que no se pueden
// importar entre sí: el Panel, cuando arma la lista de quién puede cubrir un hueco
// (`lib/candidatos.js`), y el motor, cuando el Asistente marca la llegada y hay que saber si
// esa guardia quedó sin nadie. Escrita dos veces, las dos versiones se separan el día que
// alguien corrija una sola —y la que quede vieja va a dar por trabajando a quien está de
// licencia (regla «ningún patrón repetido sin punto único de verdad», CeltaTech §8)—. El
// original es éste y la copia la mantiene `scripts/sincronizar_copias.mjs`.

import { finDeGuardia, diaDelMomento } from './horarios.js';

const lista = (x) => (Array.isArray(x) ? x : []);

/**
 * El último día que ocupa una guardia, en el formato de la base: `2026-08-01`.
 *
 * Casi siempre es el mismo día en que empieza, pero la de noche arranca a las 22:00 y termina
 * a las 06:00 del día siguiente, así que "el día de la guardia" en realidad son dos. Todo lo
 * que mire el almanaque —una licencia, una Matrícula— tiene que llegar hasta el final y no
 * quedarse en el comienzo.
 */
export function ultimoDiaDeLaGuardia(guardia) {
  return diaDelMomento(finDeGuardia(guardia));
}

/**
 * La ausencia registrada del Asistente que tapa esta guardia, o `null` si no hay ninguna.
 *
 * Estar de licencia pesa exactamente lo mismo que tener otra guardia encima: los dos casos
 * contestan que esa persona no está ese día. Por eso bloquea y no descuenta puntos.
 *
 * Se compara contra los **dos** días que puede ocupar la guardia, el primero y el último: la de
 * noche arranca a las 22:00 y termina a las 06:00 del día siguiente, y una licencia que empieza
 * ese día siguiente igual la parte al medio.
 *
 * Una ausencia sin `fecha_fin` es una que sigue abierta, no una que terminó: cuenta desde su
 * inicio y hacia adelante sin límite. Tratarla como cerrada sería dar por trabajando a quien
 * está de licencia y todavía no tiene fecha de vuelta, que es el caso más común de todos.
 *
 * **El tipo de ausencia no entra acá, a propósito.** Una licencia por enfermedad o por accidente
 * es información de salud (CLAUDE.md §6) y no tiene por qué salir del legajo, ni viajar hasta
 * una lista de candidatos, ni terminar en un renglón de pantalla. Y no hace ninguna falta: las
 * cuatro clases que admite la tabla contestan lo mismo a la única pregunta de acá —ese día esa
 * persona no está—, así que distinguirlas agregaría un dato sensible sin cambiar ninguna
 * decisión. Quien llama tampoco lo trae en su consulta.
 */
export function ausenciaQueTapa(asistenteId, ausencias, primerDia, ultimoDia) {
  return (
    lista(ausencias).find(
      (a) =>
        a.asistente_id === asistenteId &&
        a.fecha_inicio &&
        a.fecha_inicio <= ultimoDia &&
        (!a.fecha_fin || a.fecha_fin >= primerDia)
    ) ?? null
  );
}

/**
 * ¿Hay una ausencia registrada que tape esta guardia entera, de punta a punta?
 *
 * Es la misma pregunta de arriba, hecha desde el otro lado: quien llama tiene la guardia y no
 * los dos días sueltos. Existe para que ninguno de los dos que la usan tenga que acordarse de
 * que la guardia de noche ocupa dos días.
 */
export function ausenciaQueTapaLaGuardia(guardia, ausencias) {
  if (!guardia?.asistente_id || !guardia?.fecha) return null;
  return ausenciaQueTapa(guardia.asistente_id, ausencias, guardia.fecha, ultimoDiaDeLaGuardia(guardia));
}
