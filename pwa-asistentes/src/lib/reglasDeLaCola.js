// Las reglas de la cola de lo que no se pudo mandar por falta de señal, escritas sin tocar el
// teléfono: acá no hay IndexedDB, ni sesión, ni red. Son decisiones sobre una lista de objetos, y
// por eso se pueden probar solas.
//
// Tres reglas, y ninguna de las tres es un detalle:
//
// 1. LA COLA ES DE QUIEN TIENE LA SESIÓN ABIERTA. Lo que se anotó con una cuenta no se manda
//    nunca con otra. Cada Prestadora es una cuenta distinta, así que esto además cruza
//    Prestadoras: la llegada que anotó una persona no puede salir firmada por la que entró
//    después en ese mismo teléfono. Lo que quedó de una sesión anterior no se manda: se descarta.
//    Y falla cerrado — sin dueño conocido no se manda nada, ni siquiera lo que no tiene dueño.
//
// 2. HAY UN TOPE DE INTENTOS. Un envío que el motor rechaza por un motivo real no mejora por
//    repetirse: lo único que logra reintentarlo para siempre es tapar el rechazo. Al llegar al
//    tope, el ítem deja de mandarse y se queda a la vista con el motivo por el que no entró.
//
// 3. NO SE BORRA SOLO. Lo que la persona ya hizo no desaparece en silencio aunque se agote: se
//    queda anotado y se muestra. El defecto es del sistema, no de ella.
//
// EL MOTIVO QUE SE GUARDA ES UNA DE LAS OCHO SITUACIONES de `lib/errores.js`, nunca el texto
// crudo del motor: eso describe tablas y columnas y no puede llegar a una pantalla. La frase la
// busca después la pantalla en las traducciones, en el idioma de quien mira.

/**
 * Cuántas veces se intenta mandar un ítem antes de darlo por rechazado.
 *
 * Tres son suficientes para cubrir el caso que importa —la señal que va y viene— sin convertir un
 * rechazo permanente en un intento cada vez que se abre la aplicación.
 */
export const TOPE_DE_INTENTOS = 3;

/** ¿Este ítem ya gastó todos sus intentos? */
export function seAgoto(item) {
  return intentosDe(item) >= TOPE_DE_INTENTOS;
}

/** ¿Este ítem lo anotó quien tiene la sesión abierta ahora mismo? */
export function esDeLaSesion(item, duenoId) {
  if (!duenoId) return false;
  return item?.duenoId === duenoId;
}

/**
 * Lo que se manda: lo de esta sesión que todavía tiene intentos.
 *
 * El orden de creación es el orden de envío, y ese orden es una garantía: los actos de una
 * guardia dependen del anterior.
 */
export function loQueSeManda(cola, duenoId) {
  return (cola ?? [])
    .filter((item) => esDeLaSesion(item, duenoId) && !seAgoto(item))
    .sort((a, b) => (a.creadoEn ?? 0) - (b.creadoEn ?? 0));
}

/**
 * Lo que se muestra: todo lo de esta sesión, agotado o no. Lo agotado también se muestra, porque
 * es justamente lo que hay que contarle a la persona.
 */
export function loQueSeMuestra(cola, duenoId) {
  return (cola ?? [])
    .filter((item) => esDeLaSesion(item, duenoId))
    .sort((a, b) => (a.creadoEn ?? 0) - (b.creadoEn ?? 0));
}

/**
 * Lo que se descarta: todo lo que no es de esta sesión, incluido lo que quedó sin dueño de una
 * versión anterior de la aplicación.
 *
 * Sin dueño conocido no se descarta nada: nadie inició sesión todavía, y borrar la cola de la
 * persona que está por entrar sería perder su trabajo.
 */
export function loQueSeDescarta(cola, duenoId) {
  if (!duenoId) return [];
  return (cola ?? []).filter((item) => !esDeLaSesion(item, duenoId));
}

/** El ítem después de un intento que falló, con el motivo ya clasificado. */
export function conIntentoFallido(item, situacion) {
  return {
    ...item,
    intentos: intentosDe(item) + 1,
    situacion: situacion || 'falla_del_sistema',
    ultimoIntentoEn: Date.now(),
  };
}

/**
 * El motivo que hay que mostrar de este ítem, o cadena vacía si no hay ninguno.
 *
 * Es una clave del catálogo —una de las ocho situaciones—, no una frase: la frase la arma la
 * pantalla con las traducciones.
 */
export function motivoQueSeMuestra(item) {
  return item?.situacion ? String(item.situacion) : '';
}

function intentosDe(item) {
  const intentos = Number(item?.intentos ?? 0);
  return Number.isFinite(intentos) && intentos > 0 ? intentos : 0;
}
