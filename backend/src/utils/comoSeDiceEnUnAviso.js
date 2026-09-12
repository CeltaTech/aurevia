/* Cómo se dicen una fecha y un importe adentro de un aviso que sale del motor.
   ============================================================================

   POR QUÉ EXISTE. Dos avisos del Marketplace —el previo al primer cobro y el del cobro que no
   entró— nombran una fecha y un importe, y cada uno se lo escribía solo. Dos copias de la misma
   decisión es una que se corrige y otra que queda como estaba (`celtatech\CLAUDE.md` §8, ningún
   patrón repetido sin punto único de verdad).

   LA FECHA SE ARMA A MANO, y no con el formateador del sistema operativo: el motor corre en un
   servidor cuya configuración no es la de quien lee el aviso.

   Y EL IMPORTE NUNCA VA SOLO. Todo importe se muestra con su moneda. */

/** Una fecha del calendario dicha como se dice en el día a día: `2026-10-07` → `7/10/2026`. */
export function enDia(fechaISO) {
  const [anio, mes, dia] = String(fechaISO).slice(0, 10).split('-');
  return `${Number(dia)}/${Number(mes)}/${anio}`;
}

/** Un importe con su moneda: `{ importe: '4500.00', moneda: 'ARS' }` → `4500.00 ARS`. */
export function importeConMoneda({ importe, moneda }) {
  const numero = Number(importe);
  return [Number.isFinite(numero) ? numero.toFixed(2) : importe, moneda].filter(Boolean).join(' ');
}
