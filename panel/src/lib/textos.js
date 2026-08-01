// Punto único de verdad para RELLENAR LOS HUECOS DE UN TEXTO TRADUCIDO (regla 12 §7).
// ============================================================================
//
// Los textos del Panel viven en los tres idiomas y muchos tienen huecos:
//
//   "Ya atendió a este Paciente {n} veces"
//   "Ese día ya tiene una guardia de {desde} a {hasta}"
//
// Hasta ahora cada pantalla los rellenaba con `.replace('{n}', valor)` encadenado. Funciona,
// pero tiene dos problemas que se pagan más adelante: con dos o tres huecos la línea se vuelve
// ilegible, y —más grave— si alguien se olvida de un `.replace`, el `{n}` aparece tal cual en
// la pantalla del usuario y nadie se entera hasta que un cliente lo ve.
//
// Esta función recibe el texto y un objeto con todos los valores, y los reemplaza de una.
// Si un valor no vino, deja el hueco visible a propósito: un `{n}` en la pantalla es feo,
// pero es una señal de que falta un dato. Borrarlo silenciosamente escondería el error.

/**
 * Rellena los huecos `{clave}` de un texto con los valores que le pasan.
 *
 *   con('Ya atendió {n} veces', { n: 4 })  →  'Ya atendió 4 veces'
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
