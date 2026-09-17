// ---------------------------------------------------------------------------
// calcularLiquidacion.js — cuánto se le paga a un Asistente por un período
//
// EL PERÍODO YA NO ES SIEMPRE UN MES. Desde qué día hasta qué día va lo decide
// `frecuenciaDePago.js`, porque con cada persona se arregla distinto: los viernes, cada quince
// días, el mes cerrado. Acá eso llega hecho y esta cuenta no se entera de dónde salieron los
// bordes. Quien no cambió nada sigue liquidando el mes calendario, exactamente igual que antes.
//
// POR QUÉ EXISTE ESTE ARCHIVO. Esta cuenta vivía adentro de la ruta del motor que genera las
// liquidaciones, que era el único lugar que la necesitaba. Dejó de serlo: el Simulador de
// Vínculo compara lo que cuesta por mes la misma persona bajo monotributo y bajo dependencia,
// y esa comparación es exactamente esta cuenta hecha dos veces. Escrita de nuevo del lado del
// Panel serían dos cuentas que empiezan iguales y se separan el día que alguien corrija una
// sola, y entonces la liquidación de marzo y la proyección que la anunció dirían cosas
// distintas.
//
// Por eso vive acá, del lado del Panel, y el motor usa una copia generada
// (`backend/src/utils/calcularLiquidacion.js`, ver `scripts/copias_entre_apps.mjs`). Es la
// misma forma que ya tiene `escalasLegales.js`, que decide qué escala rige a una fecha.
//
// LO ÚNICO QUE IMPORTA ES A SU HERMANO COPIADO. `formaDePago.js` también vive en las dos
// carpetas y con el mismo nombre, así que la ruta relativa vale igual de los dos lados. Fuera
// de eso no entra nada: lo que se copia al motor no puede traerse medio Panel atrás.
//
// LO QUE NO ES: un comprobante fiscal. El producto no emite facturas ni notas y no está
// previsto que lo haga. Esto es la cuenta interna de qué se le paga a quién.
//
// LO QUE TAMPOCO HACE: inventar un número. Ningún porcentaje ni monto legal está escrito acá
// adentro. Los conceptos los arma cada Prestadora, y el que responde a una escala legal se
// resuelve contra `escalas_legales` a la fecha del período; si esa escala no está, el concepto
// queda afuera y se avisa, nunca se estima.
// ---------------------------------------------------------------------------

import {
  COLUMNA_DEL_VALOR,
  diasCubiertos,
  diasEntre,
  reglaDePagoDe,
  unidadDeMedicionDe,
  unidadesDelPeriodo,
  valorDeLaHoraExtra,
  valorDeLaUnidad,
} from './formaDePago.js';
import { diasDelMesDelPeriodo } from './frecuenciaDePago.js';

const ES_UN_DIA = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Un período puede venir de dos formas, y las dos son válidas.
 *
 * Como texto `AAAA-MM` es el mes calendario entero, que es lo que el sistema hizo siempre y lo
 * que sigue haciendo quien no cambió nada. Como `{ desde, hasta }` es cualquier tramo, que es lo
 * que arma `frecuenciaDePago.js` cuando a alguien se le paga los viernes o cada quince días.
 */
export function esPeriodoValido(periodo) {
  if (periodo && typeof periodo === 'object') {
    if (!ES_UN_DIA.test(periodo.desde ?? '') || !ES_UN_DIA.test(periodo.hasta ?? '')) return false;
    return periodo.desde <= periodo.hasta;
  }
  if (typeof periodo !== 'string' || !/^\d{4}-\d{2}$/.test(periodo)) return false;
  const mes = Number(periodo.slice(5, 7));
  return mes >= 1 && mes <= 12;
}

/**
 * Desde qué día hasta qué día va el período, y cómo se lo nombra.
 *
 * La etiqueta es para los avisos que lee una persona, y por eso dice el mes cuando el período es
 * un mes: «no hay escala vigente durante todo 2026-03» se entiende, y «durante todo 2026-03-01 a
 * 2026-03-31» dice lo mismo con más ruido.
 */
export function bordesDelPeriodo(periodo) {
  if (periodo && typeof periodo === 'object') {
    return { desde: periodo.desde, hasta: periodo.hasta, etiqueta: `${periodo.desde} a ${periodo.hasta}` };
  }
  return { desde: primerDia(periodo), hasta: ultimoDia(periodo), etiqueta: periodo };
}

export function primerDia(periodo) {
  return `${periodo}-01`;
}

export function ultimoDia(periodo) {
  const [anio, mes] = periodo.split('-').map(Number);
  // El día 0 del mes siguiente es el último del mes pedido, sin tener que saber cuáles
  // tienen 30, 31 o 28 días.
  return new Date(Date.UTC(anio, mes, 0)).toISOString().slice(0, 10);
}

// Los importes se guardan con dos decimales. Se redondea al escribir cada renglón y no al
// final, para que la suma de los renglones dé exactamente el total y nadie tenga que
// explicar un centavo de diferencia.
export function redondear(numero) {
  return Math.round((numero + Number.EPSILON) * 100) / 100;
}

/**
 * La liquidación de un Asistente en un período, con sus renglones.
 *
 * Devuelve `{ faltaBase: true }` cuando la ficha no tiene el valor con el que se paga. No se
 * estima, no se completa con el de otro, no se pone cero: un cero se lee como "no se le paga
 * nada", que es una afirmación distinta de "no sabemos cuánto".
 *
 * `sinEscala` sale con los conceptos que quedaron afuera por no tener escala utilizable.
 */
export function calcularLiquidacion({ asistente, acumulado, conceptos, escalasPorTipo, moneda, jurisdiccion, periodo, reglaDePago }) {
  const regla = reglaDePagoDe(reglaDePago);
  const unidad = unidadDeMedicionDe(asistente);
  const baseUnidad = COLUMNA_DEL_VALOR[unidad];
  const baseValor = valorDeLaUnidad(asistente, unidad);
  if (baseValor === null) return { faltaBase: true };

  const horas = redondear(acumulado.horas);
  const { desde, hasta, etiqueta } = bordesDelPeriodo(periodo);
  const cuantas = unidadesDelPeriodo({
    unidad,
    acumulado,
    diasDelPeriodo: diasEntre(desde, hasta),
    // El sueldo mensual se reparte sobre los días del mes y no sobre los del período: si no, a
    // quien cobra los viernes se le pagaría el sueldo entero cada viernes.
    diasDelMes: diasDelMesDelPeriodo({ desde, hasta }),
    diasDeLaPersona: diasCubiertos({
      desde,
      hasta,
      fechaAlta: asistente.fecha_alta,
      fechaBaja: asistente.fecha_baja,
      prorratear: regla.prorratear_monto_fijo,
    }),
  });
  const montoBase = redondear(cuantas * baseValor);

  // El renglón de la base va primero y no viene de ningún concepto. La descripción se escribe
  // con datos y no con una frase: la etiqueta que lee la Coordinadora sale de `base_unidad`,
  // que la pantalla traduce a los tres idiomas, mientras que esto es el detalle que permite
  // volver a explicar el importe años después sin depender del idioma en que se generó.
  const items = [
    {
      concepto_id: null,
      descripcion: `${baseUnidad} ${baseValor.toFixed(2)} × ${cuantas.toFixed(2)} ${unidad}`,
      signo: 'suma',
      unidad: 'base',
      valor_aplicado: baseValor,
      monto: montoBase,
      orden: 0,
    },
  ];

  // Las horas de más son remuneración, así que entran al bruto: un concepto que se calcula
  // como porcentaje del bruto tiene que verlas. Y si nadie cargó cuánto vale la hora extra,
  // no se estiman con el valor hora normal ni se pagan a cero: quedan afuera y se avisa, que
  // es lo mismo que ya se hace con un concepto sin escala vigente.
  const horasExtra = redondear(acumulado.horasExtra ?? 0);
  const valorHoraExtra = valorDeLaHoraExtra(asistente);
  const sinEscala = [];
  let importeHorasExtra = 0;

  if (horasExtra > 0 && valorHoraExtra === null) {
    sinEscala.push(`horas extra: hay ${horasExtra.toFixed(2)} h anotadas y la ficha no tiene cargado el valor de la hora extra`);
  } else if (horasExtra > 0) {
    importeHorasExtra = redondear(horasExtra * valorHoraExtra);
    items.push({
      concepto_id: null,
      descripcion: `valor_hora_extra ${valorHoraExtra.toFixed(2)} × ${horasExtra.toFixed(2)} h`,
      signo: 'suma',
      unidad: 'horas_extra',
      valor_aplicado: valorHoraExtra,
      monto: importeHorasExtra,
      orden: 1,
    });
  }

  const bruto = redondear(montoBase + importeHorasExtra);

  let totalSumas = 0;
  let totalRestas = 0;

  for (const concepto of conceptos) {
    if (concepto.aplica_a !== 'todos' && concepto.aplica_a !== asistente.tipo_vinculo) continue;

    let valorAplicado;
    if (concepto.origen_valor === 'escala_legal') {
      const escala = escalasPorTipo.get(concepto.escala_tipo);
      if (!escala) {
        sinEscala.push(`${concepto.nombre}: no hay una escala «${concepto.escala_tipo}» vigente en ${jurisdiccion} durante todo ${etiqueta}`);
        continue;
      }
      // La escala dice el número y también en qué unidad está. Si no habla de lo mismo que el
      // concepto —un valor en días aplicado como porcentaje, por ejemplo— el importe que
      // saldría no significaría nada, así que no se calcula.
      if (escala.unidad !== concepto.unidad) {
        sinEscala.push(`${concepto.nombre}: la escala «${concepto.escala_tipo}» está en ${escala.unidad} y el concepto en ${concepto.unidad}`);
        continue;
      }
      // Un importe en otra moneda no se convierte: convertirlo obligaría a guardar una
      // cotización y una fecha, y eso es una decisión de la Prestadora, no del sistema.
      // Un porcentaje no es plata y no trae moneda: ahí no hay nada que comparar.
      if (escala.moneda && escala.moneda !== moneda) {
        sinEscala.push(`${concepto.nombre}: la escala «${concepto.escala_tipo}» está en ${escala.moneda} y la liquidación en ${moneda}`);
        continue;
      }
      valorAplicado = Number(escala.valor);
    } else {
      valorAplicado = Number(concepto.valor);
    }

    let monto;
    if (concepto.unidad === 'porcentaje') monto = (bruto * valorAplicado) / 100;
    else if (concepto.unidad === 'monto_por_hora') monto = acumulado.horas * valorAplicado;
    else monto = valorAplicado;
    monto = redondear(monto);

    if (concepto.signo === 'resta') totalRestas += monto;
    else totalSumas += monto;

    items.push({
      concepto_id: concepto.id,
      // El nombre se copia, no se busca: si mañana la Prestadora le cambia el nombre al
      // concepto, el mes de marzo tiene que seguir diciendo lo que decía en marzo.
      descripcion: concepto.nombre,
      signo: concepto.signo,
      unidad: concepto.unidad,
      valor_aplicado: valorAplicado,
      monto,
      // El orden es la posición en el renglón, no el `orden` del catálogo: dos conceptos
      // pueden tener el mismo número ahí y los renglones quedarían empatados.
      orden: items.length,
    });
  }

  totalSumas = redondear(totalSumas);
  totalRestas = redondear(totalRestas);

  return {
    liquidacion: {
      asistente_id: asistente.id,
      // `periodo` es el día en que el período empieza, y con período mensual eso es el primero
      // del mes, igual que siempre. Los dos bordes van aparte y son los que mandan.
      periodo: desde,
      periodo_desde: desde,
      periodo_hasta: hasta,
      tipo_vinculo: asistente.tipo_vinculo,
      base_unidad: baseUnidad,
      base_valor: baseValor,
      horas,
      guardias_contadas: acumulado.guardias,
      horas_extra: horasExtra,
      // El valor con el que se pagaron va en la foto: sin él, el importe no se puede volver a
      // explicar. Sin horas extra no hay valor que guardar, y guardar el de la ficha diría que
      // se pagó algo que no se pagó.
      valor_hora_extra: importeHorasExtra > 0 ? valorHoraExtra : null,
      importe_horas_extra: importeHorasExtra,
      bruto,
      total_sumas: totalSumas,
      total_restas: totalRestas,
      neto: redondear(bruto + totalSumas - totalRestas),
    },
    items,
    sinEscala,
  };
}
