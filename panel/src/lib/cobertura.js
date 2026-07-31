// Punto único de verdad de la cobertura de una guardia dentro del Panel
// (regla 12 de CLAUDE.md §7).
//
// "Cobertura" responde una sola pregunta: ¿esta guardia tiene a alguien que la haga?
// Es una pregunta distinta de `guardias.estado` (programada / activa / completada /
// cancelada / ausente), que responde en qué momento de su vida está la guardia. Las dos
// conviven: una guardia puede estar programada y sin cubrir al mismo tiempo.
//
// Se decidió NO agregar un valor 'sin_cubrir' a `estado` justamente por eso: serían dos
// datos que dicen lo mismo y que pueden contradecirse. La cobertura se deriva siempre de
// `asistente_id` y `ofrecida_at`, que son los datos reales, y este archivo es el único
// lugar donde esa derivación está escrita.
//
// Ver la migración 20260731170000_guardia_sin_cubrir_y_ofrecida.sql, que sostiene la misma
// regla del lado de la base con restricciones CHECK.

/** Los tres valores posibles. No hay un cuarto. */
export const COBERTURA = {
  CUBIERTA: 'cubierta',
  OFRECIDA: 'ofrecida',
  SIN_CUBRIR: 'sin_cubrir',
};

/**
 * Estado de cobertura de una guardia.
 *
 * - 'cubierta'   → hay un Asistente asignado.
 * - 'ofrecida'   → no hay nadie, y la Prestadora ya la publicó para que alguien la tome.
 * - 'sin_cubrir' → no hay nadie y todavía no se publicó: es un hueco de la agenda.
 */
export function coberturaDeGuardia(guardia) {
  if (guardia?.asistente_id) return COBERTURA.CUBIERTA;
  return guardia?.ofrecida_at ? COBERTURA.OFRECIDA : COBERTURA.SIN_CUBRIR;
}

/** ¿Es un hueco? Sirve tanto la que nadie miró como la que ya se publicó y nadie tomó. */
export function estaSinCubrir(guardia) {
  return coberturaDeGuardia(guardia) !== COBERTURA.CUBIERTA;
}

/**
 * Clave de traducción del estado de cobertura, dentro de t.guardias.
 * Se devuelve la clave y no el texto para que este archivo no dependa del idioma.
 */
export function claveTextoCobertura(guardia) {
  return `cobertura_${coberturaDeGuardia(guardia)}`;
}

/**
 * Clase CSS del sistema de diseño para pintar el estado de cobertura.
 * Los colores viven en index.css; acá solo se elige cuál.
 */
export function claseCobertura(guardia) {
  return `panel-cobertura-${coberturaDeGuardia(guardia)}`;
}

/**
 * Identificador de la fila de la grilla a la que pertenece la guardia.
 *
 * La grilla agrupa por Asistente. Las guardias sin cubrir no tienen a quién agruparse, así
 * que van todas juntas a una fila propia. Se usa una cadena y no `null` porque `null` como
 * clave de Map se confunde con "todavía no cargó el nombre".
 */
export const FILA_SIN_CUBRIR = 'sin-cubrir';

export function filaDeGuardia(guardia) {
  return guardia?.asistente_id ?? FILA_SIN_CUBRIR;
}
