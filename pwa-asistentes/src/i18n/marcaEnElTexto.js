// El nombre de la Prestadora adentro del texto visible: el marcador `{{prestadora}}`.
// ============================================================================
//
// Los textos ya podían nombrar al producto sin escribirlo: se pone `{{producto}}` y
// `config/identidadProducto.js` lo resuelve. Lo que no se podía era nombrar a la Prestadora, y
// hace falta por la misma razón por la que hace falta lo otro, sólo que más seguido: quien usa
// las dos aplicaciones contrató a su Prestadora y nunca escuchó el nombre del producto, así que
// las frases que le hablan de frente —«Bienvenido a», «Un mensaje de»— tienen que decir el
// nombre de ella. Escrito a mano no puede estar: hay una Prestadora distinta por sesión.
//
// CÓMO SE USA. Igual que el otro marcador y en el mismo lugar: se escribe `{{prestadora}}` en la
// traducción, en los tres idiomas, y `i18n/LocaleContext.jsx` lo resuelve una vez por nombre
// antes de entregar el árbol. Ningún punto de consumo cambia.
//
// DE DÓNDE SALE EL NOMBRE. De donde ya estaba: en las dos aplicaciones, de `/perfil` a través de
// `context/PerfilContext.jsx`; en el Panel, de la configuración propia de la Prestadora a través
// de `context/EmpresaContext.jsx`. Ninguno de los dos puede pasárselo al proveedor de idioma
// como propiedad, porque los dos cuelgan de él y no al revés, así que lo dejan anotado acá y el
// proveedor se entera. Es un solo dato y un solo escritor por vez.
//
// QUÉ PASA CUANDO TODAVÍA NO HAY NOMBRE ANOTADO. Se resuelve al nombre del producto. No es un
// parche: hay un instante entre que la pantalla arranca y que llega el nombre, y también el caso
// de una dirección que no corresponde a ninguna Prestadora. En los dos, el nombre del producto es
// la respuesta correcta y no un hueco. Las frases se escriben con el marcador puesto y no les
// importa cuál de los dos casos es.
//
// LO QUE ESTO NO TRAE. El logotipo de la Prestadora no entra acá. Un marcador se reemplaza
// dentro de un texto y una imagen no es texto: pedirle a esta pieza que además resuelva una ruta
// de archivo la convertiría en dos cosas. La marca dibujada sigue saliendo de `useMarca()`.
//
// ESTE ARCHIVO ES UN ORIGINAL CON COPIAS DECLARADAS en `scripts/copias_entre_apps.mjs`: el
// original es `panel/src/i18n/marcaEnElTexto.js`. Se edita el original y se corre
// `node scripts/sincronizar_copias.mjs`.

import { IDENTIDAD } from '../config/identidadProducto.js';

const MARCADOR = '{{prestadora}}';

// ---------------------------------------------------------------------------
// El nombre anotado
// ---------------------------------------------------------------------------

let nombreAnotado = null;
const oyentes = new Set();

/**
 * Anota con qué nombre se presenta la Prestadora de esta sesión.
 *
 * Lo llaman los contextos que reciben ese dato del motor. Un nombre vacío vuelve al estado de
 * «todavía no se sabe», que es lo que corresponde al salir de la sesión: el nombre de la
 * Prestadora anterior no puede quedar colgado en la pantalla de ingreso de la siguiente.
 *
 * @param {string|null|undefined} nombre
 */
export function anotarNombreDeLaPrestadora(nombre) {
  const limpio = typeof nombre === 'string' && nombre.trim() ? nombre.trim() : null;
  if (limpio === nombreAnotado) return;
  nombreAnotado = limpio;
  for (const oyente of oyentes) oyente();
}

/** Con qué nombre se presenta la Prestadora de esta sesión, o nulo si todavía no se sabe. */
export function nombreDeLaPrestadora() {
  return nombreAnotado;
}

/**
 * Avisa cuando el nombre cambia. Devuelve cómo darse de baja.
 *
 * @param {() => void} oyente
 * @returns {() => void}
 */
export function alCambiarElNombre(oyente) {
  oyentes.add(oyente);
  return () => oyentes.delete(oyente);
}

// ---------------------------------------------------------------------------
// La sustitución
// ---------------------------------------------------------------------------

/** Con qué se reemplaza el marcador: el nombre de la Prestadora, o el del producto si no se sabe. */
function conQueSeReemplaza(nombre) {
  return nombre ?? IDENTIDAD.nombre;
}

/**
 * Reemplaza el marcador en un texto suelto.
 *
 * @param {*} texto
 * @param {string|null} nombre
 */
export function aplicarPrestadora(texto, nombre) {
  if (typeof texto !== 'string' || !texto.includes(MARCADOR)) return texto;
  return texto.split(MARCADOR).join(conQueSeReemplaza(nombre));
}

// Lo ya resuelto, por nombre. El árbol de un idioma tiene decenas de miles de frases y se
// recorrería entero en cada dibujo si no se guardara el resultado.
const resueltos = new WeakMap();

function recorrer(valor, nombre) {
  if (typeof valor === 'string') return aplicarPrestadora(valor, nombre);
  if (valor === null || typeof valor !== 'object') return valor;

  // Se devuelve el mismo objeto cuando ninguna de sus frases tenía el marcador. Con esto, un
  // árbol que no nombra a ninguna Prestadora —que es el caso de casi todo— no se copia: se
  // recorre y se devuelve tal cual estaba.
  let cambio = false;
  const entradas = Object.entries(valor).map(([clave, v]) => {
    const resuelto = recorrer(v, nombre);
    if (resuelto !== v) cambio = true;
    return [clave, resuelto];
  });
  if (!cambio) return valor;

  return Array.isArray(valor) ? entradas.map(([, v]) => v) : Object.fromEntries(entradas);
}

/**
 * Recorre el árbol de traducciones y devuelve uno con el marcador ya resuelto.
 *
 * @param {*} arbol   el árbol de un idioma, con los marcadores del producto ya resueltos
 * @param {string|null} nombre  el nombre de la Prestadora, o nulo si todavía no se sabe
 */
export function sustituirPrestadoraProfundo(arbol, nombre) {
  const porNombre = resueltos.get(arbol) ?? new Map();
  if (!resueltos.has(arbol)) resueltos.set(arbol, porNombre);

  const clave = nombre ?? '';
  if (porNombre.has(clave)) return porNombre.get(clave);

  const resuelto = recorrer(arbol, nombre);
  porNombre.set(clave, resuelto);
  return resuelto;
}
