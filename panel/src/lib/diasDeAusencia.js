// Cuántos días duró una ausencia.
//
// La columna `ausencias.dias_computados` existe desde el primer día, la constancia de ausencia la
// imprime (`generarDocumentoCese.js:195`) y no la escribía nadie: el documento que se le entrega a
// una persona salía sin el único número que le importa.
//
// ES UN HECHO, NO UNA INTERPRETACIÓN LEGAL. Acá se cuenta cuánto duró la ausencia, y nada más.
// Cuántos de esos días paga la Prestadora, cuántos descuentan licencia y a partir de cuál se cae
// en otra escala son decisiones de la ley de cada jurisdicción: viven en las escalas legales, que
// se cargan como configuración, y nunca en esta cuenta.

/**
 * Los días que duró una ausencia, con las dos puntas adentro: del 10 al 10 es un día, y del 10 al
 * 16 son siete. Quien falta un día falta un día, y una cuenta que diera cero ahí estaría
 * describiendo a alguien que no faltó.
 *
 * Una ausencia sin fecha de fin todavía está corriendo y devuelve `null` —que no es cero: no se
 * sabe cuánto va a durar—. Se cuenta el día que se le cargue el cierre.
 *
 * Las fechas se restan como el texto `AAAA-MM-DD` que guarda la base, leído a medianoche en tiempo
 * universal las dos. Es la misma cuenta a los dos lados, así que la diferencia en días sale exacta
 * y no la mueve el huso de quien mira la pantalla.
 */
export function diasComputados(ausencia) {
  const desde = ausencia?.fecha_inicio;
  const hasta = ausencia?.fecha_fin;
  if (!desde || !hasta) return null;
  const inicio = Date.parse(`${desde}T00:00:00Z`);
  const fin = Date.parse(`${hasta}T00:00:00Z`);
  if (Number.isNaN(inicio) || Number.isNaN(fin)) return null;
  // Una fecha de fin anterior al inicio es un dato mal cargado, no una ausencia de días negativos.
  if (fin < inicio) return null;
  return Math.round((fin - inicio) / (24 * 60 * 60 * 1000)) + 1;
}
