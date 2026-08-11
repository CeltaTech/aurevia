/* Los tramos con los que se le insiste al Coordinador, puestos en el orden que el motor
   espera leerlos.

   QUÉ ES UN TRAMO. Una frase: "mientras falten hasta X minutos para que el problema se
   vuelva grave, insistile al Coordinador cada Y minutos". El último tramo no lleva un "hasta"
   —su `maximo_minutos` es nulo— y significa "de ahí en adelante".

   POR QUÉ EL ORDEN IMPORTA. Quien los usa es `intervaloParaPremura()`, en
   backend/src/utils/umbralesPremura.js: recorre la lista de arriba hacia
   abajo y se queda con el primer tramo que le sirve. O sea que un tramo que quedó después de
   otro más ancho no se alcanza nunca, y un tramo puesto después del abierto tampoco. No es
   que "se vea feo": es material muerto que igual se guarda. Por eso la lista se ordena y se
   limpia antes de mandarla, y el servidor además la rechaza si no llega ordenada.

   VIVE ACÁ, EN lib/, y no adentro de la pantalla, porque es una regla que se puede probar
   sola, sin abrir un navegador (CLAUDE.md §7 regla 12). */

const esAbierto = (tramo) => tramo.maximo_minutos === null
  || tramo.maximo_minutos === undefined
  || tramo.maximo_minutos === '';

/**
 * Devuelve los tramos ordenados de menor a mayor, con un único tramo abierto al final.
 *
 * @param {Array<{maximo_minutos: number|null, intervalo_minutos: number}>} tramos
 * @returns {Array<{maximo_minutos: number|null, intervalo_minutos: number}>} una lista nueva;
 *          la que se le pasó no se toca.
 */
export function ordenarTramosPremura(tramos) {
  const lista = (Array.isArray(tramos) ? tramos : []).filter((tramo) => tramo && typeof tramo === 'object');

  const cerrados = lista
    .filter((tramo) => !esAbierto(tramo))
    .map((tramo) => ({
      maximo_minutos: Number(tramo.maximo_minutos),
      intervalo_minutos: Number(tramo.intervalo_minutos),
    }))
    .sort((a, b) => a.maximo_minutos - b.maximo_minutos);

  // De todos los tramos abiertos que hubiera, solo el primero se alcanza; los demás son
  // renglones que nadie va a leer nunca y se van.
  const primerAbierto = lista.find(esAbierto);
  if (primerAbierto) {
    return [...cerrados, { maximo_minutos: null, intervalo_minutos: Number(primerAbierto.intervalo_minutos) }];
  }

  // Sin ningún tramo abierto, la lista dejaría de contestar apenas se pase del último "hasta".
  // El más ancho de todos es el que corresponde abrir: es el que ya cubría el final.
  if (cerrados.length === 0) return [];
  const ultimo = cerrados.pop();
  return [...cerrados, { maximo_minutos: null, intervalo_minutos: ultimo.intervalo_minutos }];
}
