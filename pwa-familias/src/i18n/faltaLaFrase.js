// Una frase que falta avisa, en vez de dibujarse como un hueco en blanco.
// ============================================================================
//
// Los textos se consumen como objeto plano —`t.asistentes.titulo`—, así que una clave que no
// existe da `undefined`, y React dibuja `undefined` como nada. El resultado es un título que no
// está, un botón sin palabra adentro o una etiqueta vacía arriba de un casillero: la pantalla se
// ve entera, no rompe nada, y nadie se entera de que falta una traducción hasta que la ve un
// cliente. Peor todavía con tres idiomas: la frase existe en castellano, falta en portugués, y
// el hueco sólo aparece para quien lee portugués.
//
// ACÁ EL HUECO AVISA. El árbol de traducciones se envuelve, y una clave que no existe devuelve
// una marca visible en vez de nada, y deja el aviso en la consola con la ruta completa de lo que
// falta, para que quien lo vea sepa qué clave escribir y en qué idioma.
//
// QUÉ SE MUESTRA, Y POR QUÉ NO ES LO MISMO EN LOS DOS LADOS. Mientras se desarrolla, la ruta de
// la clave que falta —`[falta: asistentes.titulo]`—, que es la información que sirve. Ya
// publicado, una raya: el nombre de una clave interna en la pantalla de un cliente no le dice
// nada a él y sí dice de más. Es exactamente el mismo reparto que hace `i18n/valores.js` con los
// valores guardados en la base, y se hace igual a propósito.
//
// LO QUE ESTO NO ES: un control que deje pasar traducciones faltantes. La comprobación que las
// caza antes de publicar es otra y corre aparte. Esto es la red de abajo, para lo que se le
// escape.
//
// ESTE ARCHIVO ES UN ORIGINAL CON COPIAS DECLARADAS en `scripts/copias_entre_apps.mjs`: el
// original es `panel/src/i18n/faltaLaFrase.js`. Se edita el original y se corre
// `node scripts/sincronizar_copias.mjs`.

// Nombres que pregunta la maquinaria —React, el serializador de JSON, `await`— sobre cualquier
// objeto que le llega, sin que nadie los haya escrito como clave de traducción. Si se les
// contestara con la marca de faltante, React creería que un objeto de textos es un elemento
// dibujable y `await` creería que es una promesa. No existen como frase, así que contestan que
// no existen.
const PREGUNTAS_DE_LA_MAQUINARIA = new Set(['$$typeof', 'toJSON', 'then', 'nodeType']);

/** Lo que se ve en el lugar de la frase que falta. */
function marcaDeFaltante(ruta) {
  const enDesarrollo = typeof import.meta !== 'undefined' && import.meta.env?.DEV;
  return enDesarrollo ? `[falta: ${ruta}]` : '—';
}

const yaAvisado = new Set();

function avisar(ruta) {
  if (yaAvisado.has(ruta)) return;
  yaAvisado.add(ruta);
  console.warn(`Falta la traducción: ${ruta}`);
}

/**
 * Envuelve el árbol de traducciones para que una clave inexistente avise en vez de dar nada.
 *
 * Lo que existe pasa igual que antes y con el mismo valor, así que ningún punto de consumo
 * cambia. Lo que no existe devuelve la marca.
 *
 * @param {*} arbol   el árbol de un idioma, con los marcadores ya resueltos
 * @param {string} camino  sólo para armar la ruta del aviso; no se pasa desde afuera
 * @returns {*}
 */
// Cada objeto del árbol se envuelve una sola vez. Sin esto, cada lectura de `t.asistentes`
// devolvería una envoltura nueva, y una pantalla que la pusiera entre las dependencias de un
// `useMemo` se recalcularía en cada dibujo, para siempre.
const envueltos = new WeakMap();

export function avisandoLoQueFalta(arbol, camino = '') {
  if (arbol === null || typeof arbol !== 'object') return arbol;

  const hecho = envueltos.get(arbol);
  if (hecho !== undefined) return hecho;

  const envoltura = new Proxy(arbol, {
    get(destino, clave, receptor) {
      // Lo que está —propio o heredado, que es como llegan `map`, `length` o `toString`— se
      // devuelve tal cual, envolviendo sólo los objetos para que la red siga abajo.
      if (clave in destino) {
        const valor = Reflect.get(destino, clave, receptor);
        if (typeof valor === 'function') return valor.bind(destino);
        return avisandoLoQueFalta(valor, camino ? `${camino}.${String(clave)}` : String(clave));
      }

      if (typeof clave === 'symbol' || PREGUNTAS_DE_LA_MAQUINARIA.has(clave)) return undefined;

      const ruta = camino ? `${camino}.${clave}` : clave;
      avisar(ruta);
      return marcaDeFaltante(ruta);
    },
  });

  envueltos.set(arbol, envoltura);
  return envoltura;
}
