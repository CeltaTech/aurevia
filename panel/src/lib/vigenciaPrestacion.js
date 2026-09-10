import { hoyISO } from './horarios';

/**
 * ¿Esta prestación corre —y por lo tanto se cobra— el día que se le pregunte?
 *
 * Existe porque la respuesta sale de dos cosas a la vez y no de una: `estado`, que dice si se
 * dio de baja, y el par `vigente_desde` / `vigente_hasta`, que dice qué período se pactó.
 * Escrita en cada pantalla que la necesita, tarde o temprano una mira una sola de las dos y la
 * misma prestación queda cobrada en la factura y dada de baja en la ficha.
 *
 * `vigente_hasta` es el último día que corre, incluido, y vacío quiere decir que sigue abierta.
 * Es la misma forma que ya usan las matrículas, las series de guardias y las indicaciones de
 * medicación; acá no se inventa ninguna otra.
 */

/** El único valor de `estado` que deja a una prestación en pie. */
export const EN_PIE = 'vigente';

/**
 * Si corre el día pedido. Una prestación pactada para el mes que viene todavía no corre, y una
 * cerrada el mes pasado ya no.
 *
 * Sin `vigente_desde` contesta que no. Es a propósito: la columna es obligatoria en la base, así
 * que llegar acá sin ella significa que la consulta no la pidió, y ante un dato que no se pudo
 * resolver la respuesta es la que no cobra de más.
 */
export function correElDia(prestacion, dia = hoyISO()) {
  if (!prestacion || prestacion.estado !== EN_PIE) return false;
  const desde = prestacion.vigente_desde;
  const hasta = prestacion.vigente_hasta;
  if (!desde) return false;
  if (desde > dia) return false;
  return !hasta || hasta >= dia;
}

/**
 * Las que corren el día pedido, de una lista.
 *
 * Filtrar acá y no en la consulta es a propósito en las pantallas que muestran también las
 * cerradas: la lista se trae entera una vez y cada bloque se queda con lo suyo.
 */
export function lasQueCorrenElDia(prestaciones, dia = hoyISO()) {
  return (prestaciones ?? []).filter((p) => correElDia(p, dia));
}

/**
 * En qué situación está una prestación, para mostrarla. Cuatro respuestas y no dos, porque una
 * prestación en pie que arranca la semana que viene no es lo mismo que una corriendo, y quien
 * mira la ficha necesita distinguirlas:
 *
 *   `corriendo`   — en pie y dentro de su período.
 *   `por_empezar` — en pie, pero arranca más adelante.
 *   `terminada`   — en pie, y su período ya pasó: se cumplió lo pactado, nadie la dio de baja.
 *   `de_baja`     — se cortó antes de tiempo.
 */
export function situacion(prestacion, dia = hoyISO()) {
  if (!prestacion || prestacion.estado !== EN_PIE) return 'de_baja';
  const desde = prestacion.vigente_desde;
  if (!desde) return 'de_baja';
  if (desde > dia) return 'por_empezar';
  const hasta = prestacion.vigente_hasta;
  if (hasta && hasta < dia) return 'terminada';
  return 'corriendo';
}

/**
 * El período en una línea, para la tabla: `2026-03-15 → 2026-07-20`, o `2026-03-15 →` cuando
 * sigue abierta. Devuelve las dos fechas por separado para que la pantalla las muestre en el
 * formato del idioma de quien mira; acá no se elige ninguno.
 */
export function periodo(prestacion) {
  return { desde: prestacion?.vigente_desde ?? null, hasta: prestacion?.vigente_hasta ?? null };
}
