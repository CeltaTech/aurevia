// ---------------------------------------------------------------------------
// totalesDePostulaciones.js — cuántas postulaciones hay y en qué situación está cada una
//
// QUÉ PROBLEMA RESUELVE
// La lista de postulaciones contesta "quién se postuló" pero no "cuánto trabajo hay encima": para
// saber cuántas están esperando una primera mirada había que filtrar por cada estado, uno por uno,
// y acordarse del número anterior.
//
// LOS TOTALES SON DE TODAS, NO DE LO FILTRADO
// Se cuentan sobre las filas traídas y no sobre las que quedaron después de los filtros. Contadas
// sobre lo filtrado, elegir "aprobado" dejaría los otros cuatro números en cero: dirían lo mismo
// que el filtro que se acaba de tocar, y no habría forma de ver el panorama para volver.
//
// SE CUENTA LO QUE SE TRAJO
// Recibe las filas ya cargadas y no consulta nada. Si la pantalla trajo las de una Prestadora, los
// números son de esa Prestadora.
// ---------------------------------------------------------------------------

/**
 * Cuántas hay en total y cuántas en cada situación.
 *
 * Una fila con una situación que no está en la lista pedida se cuenta en el total y en ninguna otra
 * parte: el total es cuántas postulaciones hay, y eso no depende de que se sepa clasificarlas.
 *
 * @param filas    filas de `postulaciones`, con su columna `estado`.
 * @param estados  las situaciones a contar, en el orden en que se van a mostrar.
 * @returns `{ total, porEstado }`, donde `porEstado` tiene una entrada por cada situación pedida,
 *          en cero si no hay ninguna.
 */
export function totalesDePostulaciones(filas, estados) {
  const lista = Array.isArray(filas) ? filas : [];
  const buscados = Array.isArray(estados) ? estados : [];
  const porEstado = Object.fromEntries(buscados.map((estado) => [estado, 0]));

  for (const fila of lista) {
    const estado = fila?.estado;
    // `Object.hasOwn` y no `in`: con `in`, un estado que se llamara como algo del prototipo de
    // cualquier objeto —`constructor`, por ejemplo— entraría a sumar en un casillero que no existe.
    if (Object.hasOwn(porEstado, estado)) porEstado[estado] += 1;
  }

  return { total: lista.length, porEstado };
}
