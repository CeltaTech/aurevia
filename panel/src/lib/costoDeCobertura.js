// ---------------------------------------------------------------------------
// costoDeCobertura.js — cuánto cuesta por mes cubrir las ausencias de una persona
//
// POR QUÉ EXISTE. El Simulador de Vínculo compara lo que sale por mes la misma persona bajo
// monotributo y bajo dependencia, pero esa comparación deja afuera un costo que existe igual:
// los días que falta, alguien la cubre, y a ese alguien se le paga aparte. Está previsto en
// `docs/PRD_02B_Gestion_Personal.md:154`.
//
// NO ES UNA PROYECCIÓN: ES LO QUE YA PASÓ. No se estima cuánto va a faltar esta persona ni se
// aplica ningún índice de ausentismo. Se mira lo que la Prestadora ya pagó para cubrirla y se
// reparte por mes. Si nunca faltó, el costo es cero y eso es un dato, no un hueco.
//
// POR QUÉ DA LO MISMO BAJO LOS DOS VÍNCULOS. El Simulador calcula el mes entero para los dos
// —el sueldo de dependencia no se mueve con las guardias, y al monotributista se le cuenta la
// semana completa—, así que en los dos casos la cobertura es plata que sale además de lo que
// se le paga a la persona. Por eso la cifra es la misma en las dos columnas: es un costo que
// existe con cualquier vínculo y no inclina la comparación hacia ninguno.
// ---------------------------------------------------------------------------
import { redondear } from './calcularLiquidacion';

// Cuánto hacia atrás se mira. Un solo mes haría que una ausencia larga pareciera lo normal, y
// mirar todo el vínculo haría que una de hace cuatro años siguiera pesando hoy.
export const MESES_OBSERVADOS = 12;

// Cuántos meses de calendario hay entre dos fechas escritas como `AAAA-MM-DD`. Se cuenta sobre
// el texto y no sobre un `Date`: una fecha sin hora se lee como medianoche UTC, y en un huso
// al oeste eso cae el día anterior, que a fin o principio de mes cambia el mes entero.
function mesesEntre(desde, hasta) {
  const [anioA, mesA] = desde.split('-').map(Number);
  const [anioB, mesB] = hasta.split('-').map(Number);
  return (anioB - anioA) * 12 + (mesB - mesA);
}

/**
 * Desde qué día se mira y sobre cuántos meses se reparte.
 *
 * Nunca desde antes de que la persona entrara: repartir lo que costó cubrir seis meses de
 * vínculo entre doce daría la mitad del costo real.
 */
export function ventanaDeCobertura(hoy, fechaAlta) {
  // El mismo día, doce meses antes. Se arma con `Date.UTC` para que no intervenga el huso de
  // quien está mirando; el día 0 del mes siguiente acota el 31 en un mes que no lo tiene.
  const [anio, mes, dia] = hoy.split('-').map(Number);
  const mesesDesdeElAnioCero = anio * 12 + (mes - 1) - MESES_OBSERVADOS;
  const anioVentana = Math.floor(mesesDesdeElAnioCero / 12);
  const mesVentana = mesesDesdeElAnioCero % 12;
  const ultimoDelMes = new Date(Date.UTC(anioVentana, mesVentana + 1, 0)).getUTCDate();
  const desdeVentana = new Date(Date.UTC(anioVentana, mesVentana, Math.min(dia, ultimoDelMes)))
    .toISOString().slice(0, 10);
  const desde = fechaAlta && fechaAlta > desdeVentana ? fechaAlta : desdeVentana;
  // Un mes recién empezado ya es un mes: dividir por una fracción inflaría el promedio.
  const meses = Math.max(1, Math.min(MESES_OBSERVADOS, mesesEntre(desde, hoy) || 1));
  return { desde, meses };
}

/**
 * Lo que cuesta por mes cubrir a esta persona, según lo que ya costó.
 *
 * Un importe en otra moneda no se convierte —convertirlo obligaría a guardar una cotización y
 * una fecha, y eso es decisión de la Prestadora, no del sistema—: queda afuera y se cuenta
 * aparte, para que la pantalla pueda decir que el número está incompleto en vez de mostrarlo
 * como si estuviera entero.
 *
 * Una cobertura sin costo cargado cuenta como cero: el Coordinador puede asignar un sustituto
 * sin saber todavía cuánto va a costar, y eso no es un error.
 */
export function costoMensualDeCobertura({ coberturas, moneda, desde, meses }) {
  let total = 0;
  let cubiertas = 0;
  let enOtraMoneda = 0;

  for (const fila of coberturas) {
    if (fila.fecha && fila.fecha < desde) continue;
    if (fila.moneda && fila.moneda !== moneda) {
      enOtraMoneda += 1;
      continue;
    }
    cubiertas += 1;
    total += Number(fila.costo_adicional ?? 0);
  }

  return {
    total: redondear(total),
    porMes: redondear(total / meses),
    cubiertas,
    enOtraMoneda,
    meses,
  };
}
