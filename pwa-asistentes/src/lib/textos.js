// Rellenar los huecos de un texto traducido.
// ============================================================================
//
// Los textos viven en los tres idiomas y algunos tienen huecos:
//
//   "Vence en {dias} días"
//
// Esta función recibe el texto y un objeto con los valores, y los reemplaza de una. Si un valor
// no vino, deja el hueco a la vista a propósito: un `{dias}` en la pantalla es feo, pero avisa
// que falta un dato. Borrarlo en silencio escondería el error.
//
// Es la misma función que el Panel tiene en `panel/src/lib/textos.js`. Está copiada y no
// importada porque cada aplicación se publica sola, sin acceso al código de las otras — el
// mismo motivo por el que `identidadProducto.js` existe cuatro veces (CLAUDE.md §7.1).

/**
 * Rellena los huecos `{clave}` de un texto con los valores que le pasan.
 *
 *   con('Vence en {dias} días', { dias: 4 })  →  'Vence en 4 días'
 *
 * @param plantilla  el texto traducido, tal como sale de `t.*`
 * @param valores    objeto `{ clave: valor }`. Puede faltar o venir vacío.
 */
export function con(plantilla, valores) {
  if (typeof plantilla !== 'string') return '';
  if (!valores) return plantilla;
  return Object.entries(valores).reduce(
    (texto, [clave, valor]) => texto.split(`{${clave}}`).join(String(valor ?? '')),
    plantilla
  );
}
