// Cuándo una guardia "quedó sin cerrar".
//
// Cerrar la guardia dejó de venir pegado al envío del reporte y pasó a ser un acto propio. Eso
// abrió un caso que antes no existía: el Asistente termina, se va, no marca la salida, y la
// guardia queda en curso para siempre. Una guardia de un día que ya pasó y que sigue en curso
// no está pasando: es una guardia que nadie cerró.
//
// Ojo con no confundirla con el aviso del semáforo (`semaforoGuardia.js`), que se enciende a las
// pocas horas de terminado el horario. Ese pregunta otra cosa: "¿esta guardia seguirá pasando
// ahora mismo?", y la respuesta puede ser que sí. Acá el día entero ya pasó, así que no hay duda.
// Por eso el Panel solo ofrece cerrar las de este archivo: cerrar una guardia que quizás sigue en
// curso sería apagar algo que está vivo.
//
// La regla vive escrita una sola vez porque la usan dos aplicaciones: la del Asistente, para
// marcarle en su lista las que dejó abiertas, y el Panel, para que el Coordinador las vea y las
// cierre. Si cada una tuviera su copia a mano, tarde o temprano dirían cosas distintas sobre la
// misma guardia (`CLAUDE.md` §7, regla 12). Este archivo es el original; la copia está listada en
// `scripts/copias_entre_apps.mjs` y la máquina las compara en cada subida — nunca se edita una
// copia a mano.

import { hoyISO } from './horarios';

// El estado en el que queda una guardia mientras está pasando. Está acá, y no suelto en cada
// pantalla, para que la consulta a la base y la comprobación en memoria pregunten lo mismo.
export const ESTADO_EN_CURSO = 'activa';

/**
 * ¿Esta guardia quedó sin cerrar?
 *
 * Las tres condiciones, juntas: sigue en curso, no tiene marcada la hora de salida, y es de un
 * día anterior a hoy. El día se compara en la fecha local de quien mira, no en la del servidor:
 * una guardia de hoy nunca se considera olvidada, aunque su horario ya haya terminado.
 *
 * @param {{ estado?: string, checkout_at?: string|null, fecha?: string }} guardia
 * @param {string} [hoy] fecha de hoy como `2026-08-21`; se pasa solo en las pruebas.
 */
export function quedoSinCerrar(guardia, hoy = hoyISO()) {
  if (!guardia) return false;
  if (guardia.estado !== ESTADO_EN_CURSO) return false;
  if (guardia.checkout_at) return false;
  if (!guardia.fecha) return false;
  return guardia.fecha < hoy;
}

/**
 * De una lista de guardias, las que quedaron sin cerrar, de la más vieja a la más nueva: la que
 * más tiempo lleva olvidada es la que más urge mirar.
 *
 * @param {Array} guardias
 * @param {string} [hoy] fecha de hoy como `2026-08-21`; se pasa solo en las pruebas.
 */
export function guardiasSinCerrar(guardias, hoy = hoyISO()) {
  return (guardias ?? [])
    .filter((g) => quedoSinCerrar(g, hoy))
    .sort((a, b) => {
      if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
      return (a.hora_inicio ?? '') < (b.hora_inicio ?? '') ? -1 : 1;
    });
}
