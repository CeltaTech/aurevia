// ---------------------------------------------------------------------------
// domicilioEscrito.js — el domicilio en un renglón, armado una sola vez
//
// QUÉ RESUELVE
// El domicilio se guarda partido —calle, número, piso, unidad y el lugar elegido
// de la lista de la Prestadora—, porque partido se puede buscar, comparar y
// agrupar. Pero mostrarlo partido no sirve: quien lo lee necesita el renglón
// entero, y el servicio que lo ubica en el mapa también lo recibe así.
//
// Entonces el renglón se arma al mostrarlo y NO SE GUARDA. Guardarlo sería la
// misma verdad en dos lugares: el día que alguien corrige el número, el renglón
// guardado sigue diciendo el anterior y nadie sabe cuál vale.
//
// POR QUÉ ACÁ Y NO EN CADA PANTALLA
// Lo arman el motor —para las dos aplicaciones de teléfono y para ubicar la
// dirección en el mapa— y el Panel, para mostrarlo. Escrito dos veces, una
// pondría la coma donde la otra no y el mismo domicilio se leería distinto según
// dónde se lo mire. El original vive acá y la copia del Panel se mantiene sola
// (scripts/copias_entre_apps.mjs).
//
// EL DOMICILIO ES DATO SENSIBLE: no se escribe en registros, ni en direcciones
// web, ni en mensajes de error, ni siquiera para depurar (CLAUDE.md §6).
// ---------------------------------------------------------------------------

function limpio(valor) {
  return String(valor ?? '').trim();
}

/**
 * El domicilio en un renglón, para mostrar y para buscar la dirección en el mapa.
 *
 * Recibe las partes tal como salen de la base, más el nombre del lugar elegido —que vive en otra
 * tabla y por eso llega aparte—. Lo que falta no deja hueco: un domicilio sin piso se lee igual
 * que uno con piso, sin comas sueltas ni palabras colgadas.
 *
 * Devuelve cadena vacía cuando no hay nada que mostrar, nunca `null`: quien llama la pone en
 * pantalla, y comparar contra vacío es una comprobación menos.
 */
export function domicilioEscrito({ calle, numero, piso, unidad, lugar } = {}, textos = {}) {
  const calleYNumero = [limpio(calle), limpio(numero)].filter(Boolean).join(' ');

  // El piso y la unidad se nombran, porque «4 B» suelto no dice cuál es cuál. Las palabras salen
  // de las traducciones de quien llama: es texto visible (CLAUDE.md §7).
  const partes = [
    calleYNumero,
    limpio(piso) && `${textos.piso ?? 'piso'} ${limpio(piso)}`,
    limpio(unidad) && `${textos.unidad ?? 'unidad'} ${limpio(unidad)}`,
    limpio(lugar),
  ];

  return partes.filter(Boolean).join(', ');
}

/** Si esa ficha tiene algo cargado en el domicilio. Un domicilio sin calle no se puede ubicar. */
export function hayDomicilio(partes) {
  return Boolean(domicilioEscrito(partes));
}

/**
 * Las cuatro partes y el lugar, tal como se escriben en las columnas de la base.
 *
 * Lo vacío vuelve a ser nulo. Guardar cadena vacía y nulo mezclados haría que dos fichas sin piso
 * se vieran distintas al compararlas, y la clave foránea del lugar rechaza una cadena que no apunta
 * a ninguno. Toma solamente estos cinco campos: lo demás que venga en el pedido no se escribe.
 */
export function partesDelDomicilio(partes) {
  const oNulo = (valor) => limpio(valor) || null;
  return {
    calle: oNulo(partes?.calle),
    numero: oNulo(partes?.numero),
    piso: oNulo(partes?.piso),
    unidad: oNulo(partes?.unidad),
    lugar_id: oNulo(partes?.lugar_id ?? partes?.lugarId),
  };
}
