// Una fecha guardada, dicha en el idioma de quien mira.
//
// No es texto de la aplicación y por eso no vive en el archivo de traducciones: los nombres de
// los días y de los meses ya los sabe el teléfono, y escribirlos a mano sería escribirlos tres
// veces y corregirlos tres veces.
//
// LA HORA DEL MEDIO NO ES UN DETALLE. Una fecha sola —`2026-08-20`— se entiende como medianoche
// en Londres, y en Buenos Aires eso todavía es el 19. Sin el `T00:00:00`, una guardia y un
// vencimiento se muestran corridos un día, que en una factura es la diferencia entre estar al día
// y estar vencido.

/** La fecha `AAAA-MM-DD` escrita en palabras, con las opciones que pida quien la muestra. */
export function enPalabras(fechaISO, locale, opciones) {
  if (!fechaISO) return '—';
  return new Date(`${fechaISO}T00:00:00`).toLocaleDateString(locale, opciones);
}

/** El período de una factura: el mes y el año, sin el día, que siempre es el primero. */
export function periodoEnPalabras(fechaISO, locale) {
  return enPalabras(fechaISO, locale, { month: 'long', year: 'numeric' });
}

/** El día de un hecho: cuándo se emitió, cuándo vence, cuándo entró un pago. */
export function diaEnPalabras(fechaISO, locale) {
  return enPalabras(fechaISO, locale, { day: 'numeric', month: 'long', year: 'numeric' });
}
