// ---------------------------------------------------------------------------
// calcularLiquidacion.js — cuánto se le paga a un Asistente por un mes
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
// NO IMPORTA NADA A PROPÓSITO. Lo que se copia al motor no puede traerse medio Panel atrás.
//
// LO QUE NO ES: un comprobante fiscal. El producto no emite facturas ni notas y no está
// previsto que lo haga. Esto es la cuenta interna de qué se le paga a quién.
//
// LO QUE TAMPOCO HACE: inventar un número. Ningún porcentaje ni monto legal está escrito acá
// adentro. Los conceptos los arma cada Prestadora, y el que responde a una escala legal se
// resuelve contra `escalas_legales` a la fecha del período; si esa escala no está, el concepto
// queda afuera y se avisa, nunca se estima.
// ---------------------------------------------------------------------------

export function esPeriodoValido(periodo) {
  if (typeof periodo !== 'string' || !/^\d{4}-\d{2}$/.test(periodo)) return false;
  const mes = Number(periodo.slice(5, 7));
  return mes >= 1 && mes <= 12;
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
export function calcularLiquidacion({ asistente, acumulado, conceptos, escalasPorTipo, moneda, jurisdiccion, periodo }) {
  const esDependencia = asistente.tipo_vinculo === 'dependencia';
  const baseUnidad = esDependencia ? 'sueldo_basico' : 'valor_hora';
  const baseCruda = esDependencia ? asistente.sueldo_basico : asistente.valor_hora;
  if (baseCruda === null || baseCruda === undefined) return { faltaBase: true };

  const baseValor = Number(baseCruda);
  const horas = redondear(acumulado.horas);
  // Quien está en relación de dependencia cobra su sueldo, que no se mueve con las guardias
  // que haya hecho; para esa persona las horas son un control, no la cuenta.
  const bruto = redondear(esDependencia ? baseValor : acumulado.horas * baseValor);

  // El renglón de la base va primero y no viene de ningún concepto. La descripción se escribe
  // con datos y no con una frase: la etiqueta que lee la Coordinadora sale de `base_unidad`,
  // que la pantalla traduce a los tres idiomas, mientras que esto es el detalle que permite
  // volver a explicar el importe años después sin depender del idioma en que se generó.
  const descripcionBase = esDependencia
    ? `sueldo_basico = ${baseValor.toFixed(2)}`
    : `valor_hora ${baseValor.toFixed(2)} × ${horas.toFixed(2)} h`;

  const items = [
    {
      concepto_id: null,
      descripcion: descripcionBase,
      signo: 'suma',
      unidad: 'base',
      valor_aplicado: baseValor,
      monto: bruto,
      orden: 0,
    },
  ];

  const sinEscala = [];
  let totalSumas = 0;
  let totalRestas = 0;

  for (const concepto of conceptos) {
    if (concepto.aplica_a !== 'todos' && concepto.aplica_a !== asistente.tipo_vinculo) continue;

    let valorAplicado;
    if (concepto.origen_valor === 'escala_legal') {
      const escala = escalasPorTipo.get(concepto.escala_tipo);
      if (!escala) {
        sinEscala.push(`${concepto.nombre}: no hay una escala «${concepto.escala_tipo}» vigente en ${jurisdiccion} durante todo ${periodo}`);
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
      periodo: primerDia(periodo),
      tipo_vinculo: asistente.tipo_vinculo,
      base_unidad: baseUnidad,
      base_valor: baseValor,
      horas,
      guardias_contadas: acumulado.guardias,
      bruto,
      total_sumas: totalSumas,
      total_restas: totalRestas,
      neto: redondear(bruto + totalSumas - totalRestas),
    },
    items,
    sinEscala,
  };
}
