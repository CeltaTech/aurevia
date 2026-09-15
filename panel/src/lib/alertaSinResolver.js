// Cuándo una alerta de la IA "sigue sin resolver", y cuál de ellas es la que no puede esperar.
//
// Las alertas las escribe la IA Nivel 2 (`backend/src/utils/revisarAlertasIA.js`) cuando lee los
// últimos reportes de un Paciente y encuentra un patrón preocupante. Quedan abiertas hasta que
// alguien del Panel las mira y las da por resueltas: no se cierran solas ni se vencen, porque lo
// que las cierra es que una persona haya hecho algo al respecto.
//
// La regla está escrita una sola vez porque la preguntan tres pantallas —la lista de Alertas, la
// ficha de una Familia y el resumen del mes— y de dos maneras distintas: dos filtran filas que ya
// tienen en la mano y la otra se lo pide a la base, que es la que no trae ninguna fila. Si cada
// una escribiera su versión, el día que "sin resolver" signifique algo más que esta columna las
// tres dirían cosas distintas sobre la misma alerta (`celtatech/CLAUDE.md` §8, «ningún patrón
// repetido sin punto único de verdad»).

// La columna que guarda si alguien ya la atendió. Está acá, y no suelta en cada consulta, para
// que la pregunta a la base y la comprobación en memoria miren exactamente lo mismo.
const COLUMNA_RESUELTA = 'resuelta';

// El nivel de las que no pueden esperar. Los otros dos —amarilla y verde— también se resuelven,
// pero no interrumpen a nadie.
export const NIVEL_CRITICO = 'roja';

/**
 * ¿Esta alerta sigue esperando que alguien la mire?
 *
 * @param {{ resuelta?: boolean }} alerta
 */
export function sigueSinResolver(alerta) {
  return !alerta?.[COLUMNA_RESUELTA];
}

/**
 * ¿Y es de las que no pueden esperar?
 *
 * @param {{ resuelta?: boolean, nivel?: string }} alerta
 */
export function sigueSinResolverYEsCritica(alerta) {
  return sigueSinResolver(alerta) && alerta?.nivel === NIVEL_CRITICO;
}

/**
 * La misma pregunta, hecha del lado de la base: agrega el filtro a una consulta ya armada y la
 * devuelve para seguir encadenando. Se usa cuando no hace falta traer las filas —contarlas, por
 * ejemplo—, o cuando traerlas todas para descartar la mayoría sería pasear datos de más por el
 * navegador.
 *
 * @template T
 * @param {T} consulta consulta de Supabase a la tabla `alertas`
 * @returns {T}
 */
export function soloSinResolver(consulta) {
  return consulta.eq(COLUMNA_RESUELTA, false);
}
