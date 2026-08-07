// Cuándo toca volver a avisar algo que sigue sin resolverse.
//
// Todos los procesos de aviso de este backend corren cada cinco minutos y todos tienen el
// mismo problema: si mandaran el aviso en cada corrida, el Coordinador recibiría el mismo
// mensaje doce veces por hora y a la tercera armaría un filtro en su casilla. La respuesta
// es siempre la misma cuenta —"¿ya pasó el intervalo desde la última vez?"— y por eso vive
// escrita una sola vez acá (regla 12 de CLAUDE.md §7) en vez de repetida en cada proceso.
//
// La escribió primero revisarNotificacionesCoordinador.js; cuando se sumó el aviso de
// guardia sin cubrir hubiera quedado copiada en dos lugares, así que se mudó a este archivo
// y los dos la importan.

/**
 * ¿Corresponde avisar ahora?
 *
 * Sin aviso previo, siempre sí. Con aviso previo, solo cuando ya pasó el intervalo.
 *
 * @param {string|null} ultimaNotificacionAt fecha del último aviso, o null si nunca se avisó
 * @param {number} intervaloMinutos cuánto hay que esperar entre un aviso y el siguiente
 * @param {Date} ahora el momento contra el que se compara
 */
export function necesitaNotificar({ ultimaNotificacionAt, intervaloMinutos, ahora }) {
  if (!ultimaNotificacionAt) return true;
  const proxima = new Date(ultimaNotificacionAt).getTime() + intervaloMinutos * 60_000;
  return ahora.getTime() >= proxima;
}
