// En qué idioma se le abre la pantalla a quien entra por primera vez.
// ============================================================================
//
// Hasta acá había una sola respuesta: castellano. Quien entraba con el navegador en inglés o en
// portugués veía todo en castellano y tenía que ir a buscar el selector de idioma —en una
// pantalla escrita en un idioma que no lee— para arreglarlo. El producto habla tres idiomas
// desde el día uno; lo que faltaba era usarlos sin que nadie los pidiera.
//
// SE MIRAN TRES COSAS, EN ESTE ORDEN, Y GANA LA PRIMERA QUE CONTESTE:
//
//   1. Lo que la persona eligió alguna vez. Una elección hecha a mano no la pisa nada.
//   2. La dirección por la que entró. Una dirección terminada en el código de un país es una
//      declaración deliberada de dónde se está entrando, y vale más que la configuración del
//      aparato: en una computadora prestada el idioma del navegador es el de otro.
//   3. El idioma del navegador.
//
// Y si ninguna contesta, el de por defecto.
//
// SE COMPARA SÓLO LA PRIMERA PARTE DE LA ETIQUETA. El navegador dice `pt-PT`, `en-GB`, `es-ES`,
// y el producto tiene `pt-BR`, `en` y `es-AR`. Comparadas enteras no coincide ninguna, y quien
// lee portugués de Portugal terminaría leyendo castellano teniendo el portugués al lado. Se
// compara `pt` con `pt`, y portugués de Portugal cae en portugués de Brasil.
//
// LO ELEGIDO ACÁ NO SE GUARDA, a propósito: es una respuesta a lo que se ve hoy, no una
// decisión de la persona. Recién cuando alguien toca el selector se guarda, y a partir de ahí
// manda eso. Si se guardara la deducción, un navegador que cambia de idioma dejaría de
// notarse para siempre.
//
// ESTE ARCHIVO ES UN ORIGINAL CON COPIAS DECLARADAS en `scripts/copias_entre_apps.mjs`: el
// original es `panel/src/i18n/idiomaInicial.js`. Se edita el original y se corre
// `node scripts/sincronizar_copias.mjs`.

import { IDIOMAS_SOPORTADOS, IDIOMA_POR_DEFECTO, idiomaDePaisSiSeSabe } from './idiomas.js';

// Los pocos remates de dirección que no coinciden con el código ISO del país. Se nombran los que
// existen de verdad; el resto de los remates de dos letras ya son el código del país.
const PAIS_DEL_REMATE = {
  uk: 'GB',
};

/** La primera parte de una etiqueta de idioma: `pt-BR` → `pt`, `en` → `en`. */
function primeraParte(etiqueta) {
  return String(etiqueta ?? '').trim().toLowerCase().split('-')[0];
}

/**
 * El idioma del producto que empieza igual que la etiqueta pedida, o nulo si no hay ninguno.
 *
 * @param {string|null|undefined} etiqueta  lo que dice el navegador: `pt-PT`, `en-GB`, `es`
 * @returns {string|null}
 */
export function idiomaQueEmpiezaIgual(etiqueta) {
  const parte = primeraParte(etiqueta);
  if (!parte) return null;
  return IDIOMAS_SOPORTADOS.find((idioma) => primeraParte(idioma) === parte) ?? null;
}

/**
 * El idioma que declara la dirección por la que se entró, o nulo si no declara ninguno.
 *
 * Se mira el remate de la dirección. Si son dos letras, es el código de un país; de ahí sale el
 * idioma. Una dirección terminada en `.com`, en `localhost` o en un número no dice nada de
 * ningún país, y tampoco lo dice el remate de un país donde el producto todavía no se vendió:
 * en los tres casos contesta nulo y decide el navegador.
 *
 * @param {string|null|undefined} direccion  el nombre del equipo, tal como está en la barra
 * @returns {string|null}
 */
export function idiomaDeLaDireccion(direccion) {
  const partes = String(direccion ?? '').trim().toLowerCase().split('.');
  const remate = partes[partes.length - 1];
  if (!/^[a-z]{2}$/.test(remate)) return null;
  return idiomaDePaisSiSeSabe(PAIS_DEL_REMATE[remate] ?? remate);
}

/**
 * El idioma del navegador: el primero de los que la persona configuró que el producto hable.
 *
 * Se recorren en orden y no se toma sólo el primero, porque quien configuró `pt-PT, en, es` está
 * diciendo que si no hay portugués prefiere inglés, y quedarse con el primero que no coincide
 * tiraría esa preferencia a la basura.
 *
 * @param {string[]|null|undefined} etiquetas
 * @returns {string|null}
 */
export function idiomaDelNavegador(etiquetas) {
  for (const etiqueta of etiquetas ?? []) {
    const idioma = idiomaQueEmpiezaIgual(etiqueta);
    if (idioma) return idioma;
  }
  return null;
}

/**
 * En qué idioma se abre la pantalla.
 *
 * Recibe las tres señales en vez de ir a buscarlas para poder probarse sin navegador. Quien la
 * llama de verdad es `LocaleContext`, que las junta con `loQueDiceElNavegador`.
 *
 * @param {object} señales
 * @param {string|null|undefined} señales.guardado   el idioma que la persona eligió alguna vez
 * @param {string|null|undefined} señales.direccion  el nombre del equipo de la barra de direcciones
 * @param {string[]|null|undefined} señales.etiquetas  los idiomas configurados en el navegador
 * @returns {string}
 */
export function idiomaInicial({ guardado, direccion, etiquetas } = {}) {
  if (IDIOMAS_SOPORTADOS.includes(guardado)) return guardado;
  return idiomaDeLaDireccion(direccion) ?? idiomaDelNavegador(etiquetas) ?? IDIOMA_POR_DEFECTO;
}

/**
 * Las dos señales que pone el navegador, leídas de forma que no rompan si no hay navegador.
 *
 * `navigator.languages` es la lista completa y ordenada por preferencia; `navigator.language` es
 * sólo la primera y existe en navegadores donde la otra no. Se usa la lista cuando está.
 *
 * @returns {{ direccion: string|null, etiquetas: string[] }}
 */
export function loQueDiceElNavegador() {
  if (typeof window === 'undefined') return { direccion: null, etiquetas: [] };
  const idiomas = window.navigator?.languages;
  const etiquetas = Array.isArray(idiomas) && idiomas.length > 0
    ? idiomas
    : [window.navigator?.language].filter(Boolean);
  return { direccion: window.location?.hostname ?? null, etiquetas };
}
