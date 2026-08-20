// ---------------------------------------------------------------------------
// dinero.js — cómo se muestra un importe, decidido una sola vez
//
// POR QUÉ EXISTE
// El peso argentino estaba escrito a mano en seis pantallas distintas: tres con
// `currency: 'ARS'` y tres con el signo `$` pegado adelante del número. El
// producto se vende en más de un país desde el día uno, así que un saldo de una
// Prestadora brasileña se mostraba en pesos argentinos. Acá se decide una vez
// (regla 12 de CLAUDE.md §7) y el importe se muestra en la moneda que trae.
//
// DE DÓNDE SALE LA MONEDA
// De la fila misma: desde la regla 14, toda tabla con importes tiene su columna
// `moneda`. Solo cuando el importe todavía no está guardado —una proyección, una
// cuenta hecha en el momento— se usa la de la Prestadora, que viaja en el usuario.
// ---------------------------------------------------------------------------

/**
 * Un importe con su moneda, escrito como lo escribe el país de quien lee.
 *
 * @param monto   el número, o `null` si no hay.
 * @param moneda  el código de tres letras que trae la fila (`ARS`, `BRL`, `UYU`).
 * @param locale  el idioma elegido en el Panel, para el separador de miles.
 */
export function formatearImporte(monto, moneda, locale) {
  if (monto === null || monto === undefined || monto === '') return '—';

  const numero = Number(monto);
  if (!Number.isFinite(numero)) return '—';

  // Sin moneda no se inventa ninguna: se muestra el número solo. Un símbolo puesto
  // por descarte es peor que ninguno, porque se lee como si fuera cierto.
  if (!moneda) return numero.toLocaleString(locale);

  return numero.toLocaleString(locale, { style: 'currency', currency: moneda });
}
