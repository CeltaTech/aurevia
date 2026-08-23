// Punto único de verdad para RELLENAR LOS HUECOS DE UN TEXTO TRADUCIDO (regla 12 §7).
// ============================================================================
//
// Los textos viven en los tres idiomas y muchos tienen huecos:
//
//   "Vence en {dias} días"
//   "La guardia va de {desde} a {hasta}"
//
// Sin esta función cada pantalla los rellenaría con `.replace('{dias}', valor)` encadenado.
// Funciona, pero tiene dos problemas que se pagan más adelante: con dos o tres huecos la línea
// se vuelve ilegible, y —más grave— si alguien se olvida de un `.replace`, el `{dias}` aparece
// tal cual en la pantalla y nadie se entera hasta que un cliente lo ve.
//
// Esta función recibe el texto y un objeto con todos los valores, y los reemplaza de una. Si un
// valor no vino, deja el hueco a la vista a propósito: un `{dias}` en la pantalla es feo, pero
// avisa que falta un dato. Borrarlo en silencio escondería el error.
//
// ESTE ARCHIVO ES UN ORIGINAL CON COPIAS DECLARADAS en `scripts/copias_entre_apps.mjs`: el
// original es `panel/src/lib/textos.js`. Está copiado y no importado porque cada unidad se
// despliega sola, sin acceso al código de las otras — el mismo motivo por el que
// `identidadProducto.js` existe cinco veces (CLAUDE.md §7.1). Se edita siempre el original y
// después se corre `node scripts/sincronizar_copias.mjs`. Una copia editada a mano la pisa la
// próxima corrida, y mientras tanto `scripts/verificar_identidad.mjs` falla el build.

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
