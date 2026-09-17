// ---------------------------------------------------------------------------
// facturacionDeFamilias.js — el plazo de pago acordado, y qué se corrige de una factura
//
// POR QUÉ EXISTE ESTE ARCHIVO. La fecha de vencimiento de las facturas se escribía a mano cada
// vez que se generaba una tanda, y salía igual para todas las Familias. Hasta cuándo tiene para
// pagar cada una es parte de lo que se acordó con ella, y además es uno de los tres datos que
// Careonys le manda al software de facturación —cuántas unidades, a qué precio, y a qué plazo—.
//
// NO HAY VALOR DE FÁBRICA, Y ES A PROPÓSITO. Una factura sin vencimiento no se puede reclamar, y
// una con un vencimiento que inventó el sistema se vería vencida sin que nadie lo haya acordado.
// Mientras no haya plazo configurado, la pantalla sigue pidiendo la fecha como hasta ahora.
//
// QUIÉN EMITE Y QUIÉN SIGUE. Careonys no emite comprobantes: manda a facturar y guarda lo que el
// software de facturación le informa —el monto y el vencimiento—. Cómo se llama cada comprobante
// depende del país y lo decide ese software; acá su nombre es texto que se guarda y no se
// interpreta. De una corrección, lo único que Careonys mira es para qué lado mueve el saldo y por
// cuánto.
//
// NO IMPORTA NADA A PROPÓSITO. Este archivo lo usa el Panel y el motor usa una copia generada
// (`backend/src/utils/facturacionDeFamilias.js`, ver `scripts/copias_entre_apps.mjs`).
// ---------------------------------------------------------------------------

/** Para qué lado mueve el saldo una corrección. Son identificadores guardados: no se renombran. */
export const SENTIDOS_DE_CORRECCION = {
  RESTA: 'resta',
  SUMA: 'suma',
};

export const SENTIDOS_POSIBLES = Object.values(SENTIDOS_DE_CORRECCION);

const MILISEGUNDOS_DE_UN_DIA = 86400000;

/**
 * Cuántos días como máximo puede durar un plazo de pago.
 *
 * Un tope hace falta por lo mismo que en el pago a los Asistentes: un cero de más mandaría el
 * vencimiento a diez años y nadie lo notaría hasta que alguien reclame. Un año es plazo largo
 * hasta para el peor de los casos.
 */
export const PLAZO_MAXIMO_EN_DIAS = 365;

/** Si un plazo se puede guardar. Vacío vale: quiere decir que no se acordó ninguno. */
export function plazoQueSePuedeGuardar(dias) {
  if (dias === null || dias === undefined || dias === '') return { ok: true, valor: null };
  const numero = Number(dias);
  if (!Number.isInteger(numero) || numero < 0 || numero > PLAZO_MAXIMO_EN_DIAS) {
    return { ok: false, valor: null };
  }
  return { ok: true, valor: numero };
}

/**
 * El plazo que rige para esta Familia, en días, o `null` si no se acordó ninguno.
 *
 * Dos capas, de la más general a la más particular: lo que configuró la Prestadora y lo que se
 * acordó con esta Familia. No hay capa de fábrica, porque un plazo inventado por el sistema
 * pondría facturas en mora sin que nadie lo haya decidido.
 *
 * Un valor fuera de borde se ignora en vez de romper, igual que en el pago a los Asistentes: una
 * factura que no se puede generar es peor que una que sale con el plazo de la capa de arriba.
 */
export function plazoDePagoDe(deLaPrestadora, deLaFamilia) {
  let plazo = null;
  for (const capa of [deLaPrestadora, deLaFamilia]) {
    const revisado = plazoQueSePuedeGuardar(capa);
    if (revisado.ok && revisado.valor !== null) plazo = revisado.valor;
  }
  return plazo;
}

/** El día en que vence una factura emitida en esta fecha, con este plazo. En texto. */
export function vencimientoDe(fechaDeEmision, plazoEnDias) {
  if (plazoEnDias === null || plazoEnDias === undefined) return null;
  const [anio, mes, dia] = String(fechaDeEmision).split('-').map(Number);
  const emision = Date.UTC(anio, mes - 1, dia);
  return new Date(emision + plazoEnDias * MILISEGUNDOS_DE_UN_DIA).toISOString().slice(0, 10);
}

/**
 * Cuánto se le reclama a la Familia por esta factura.
 *
 * Es lo que el software de facturación informó haber emitido, más y menos lo que las
 * correcciones hayan movido. Mientras no se haya facturado, lo que se mandó a facturar es la
 * mejor referencia que hay, y es lo que se venía mostrando.
 */
export function montoQueSeReclama(factura, correcciones = []) {
  const emitido = factura?.monto_facturado ?? factura?.monto_total ?? 0;
  const movido = correcciones.reduce((acc, c) => {
    const monto = Number(c?.monto) || 0;
    return c?.sentido === SENTIDOS_DE_CORRECCION.RESTA ? acc - monto : acc + monto;
  }, 0);
  return aDosDecimales(Number(emitido) + movido);
}

/**
 * Si el seguimiento de la cobranza es de este sistema o de otro software.
 *
 * Lo decide la Prestadora. Encendido es lo que se viene haciendo: mandar la factura a quien tiene
 * que pagarla, seguir el saldo y anotar los pagos. Apagado quiere decir que de eso se ocupa otro
 * software de créditos y cobranzas, y que de ahí adentro sólo entra el aviso de si a una Familia
 * hay que ponerle alguna restricción.
 *
 * Sin nada configurado queda encendido, porque es lo que hacen hoy todas las Prestadoras
 * cargadas. Apagarlo es una decisión que se toma.
 */
export function sigueLaCobranza(regla) {
  return regla?.sigue_la_cobranza !== false;
}

/** A quién se le puede reclamar una factura. Son identificadores guardados: no se renombran. */
export const FINANCIADORES = {
  FAMILIA: 'familia',
  OBRA_SOCIAL: 'obra_social',
  OTRO: 'otro',
};

export const FINANCIADORES_POSIBLES = Object.values(FINANCIADORES);

/**
 * Lo más corto que puede medir el secreto con el que ese otro software firma sus avisos.
 *
 * Treinta y dos caracteres es lo que genera solo cualquier software que los arme; más corto que
 * eso se adivina probando, y entonces la puerta firmada deja de estar firmada.
 */
export const LARGO_MINIMO_DEL_SECRETO_DEL_AVISO = 32;

/** Cuántos días de atraso como máximo se admiten en un aviso. Diez años es más que suficiente. */
export const DIAS_DE_ATRASO_MAXIMOS = 3650;

/** Cuánto puede medir el saldo que informa el otro software, para lado y lado. */
export const SALDO_MAXIMO_DEL_AVISO = 999999999999.99;

/** Si un texto tiene forma de fecha de calendario. */
function tieneFormaDeFecha(valor) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(valor));
}

/**
 * Qué está mal en el estado de cuenta que viene adentro de un aviso, o `null` si está bien.
 *
 * Son obligatorios el saldo, su moneda y si está atrasada: sin cualquiera de los tres el dato no
 * se puede mostrar sin inventar la parte que falta, y acá no se inventa nada. Lo demás —cuántos
 * días de atraso, desde qué vencimiento, de qué día es la foto— es opcional, porque hay software
 * que no lo lleva, y exigirlo lo dejaría afuera.
 *
 * El saldo admite negativo a propósito: una Familia que pagó de más tiene saldo a favor.
 */
export function loQueEstaMalEnElEstadoDeCuenta(estado) {
  const saldo = Number(estado?.saldo);
  if (estado?.saldo === null || estado?.saldo === undefined || estado?.saldo === ''
      || !Number.isFinite(saldo) || Math.abs(saldo) > SALDO_MAXIMO_DEL_AVISO) return 'saldo';
  if (!/^[A-Z]{3}$/.test(String(estado?.moneda ?? ''))) return 'moneda';
  if (typeof estado?.atrasado !== 'boolean') return 'atrasado';
  if (estado?.dias_de_atraso !== undefined && estado?.dias_de_atraso !== null) {
    const dias = Number(estado.dias_de_atraso);
    if (!Number.isInteger(dias) || dias < 0 || dias > DIAS_DE_ATRASO_MAXIMOS) return 'dias_de_atraso';
  }
  if (estado?.vencimiento_mas_antiguo !== undefined && estado?.vencimiento_mas_antiguo !== null
      && !tieneFormaDeFecha(estado.vencimiento_mas_antiguo)) return 'vencimiento_mas_antiguo';
  if (estado?.fecha_del_estado !== undefined && estado?.fecha_del_estado !== null
      && !tieneFormaDeFecha(estado.fecha_del_estado)) return 'fecha_del_estado';
  return null;
}

/**
 * Qué está mal en un aviso del software que lleva la cobranza, o `null` si está bien.
 *
 * Un aviso trae siempre de qué Familia se trata, y además **al menos una** de las dos cosas que
 * ese software puede informar: si hay que ponerle alguna restricción, y cómo está su cuenta. Las
 * dos juntas también valen. Quien hoy manda sólo la restricción sigue entrando igual, sin
 * cambiarle nada.
 *
 * El motivo no es obligatorio: el otro software puede no tener ninguno que dar, y trabarlo dejaría
 * el aviso afuera.
 */
export function loQueEstaMalEnElAviso(aviso) {
  if (!String(aviso?.familia_id ?? '').trim()) return 'familia_id';

  const traeRestriccion = aviso?.restringida !== undefined && aviso?.restringida !== null;
  const traeEstado = aviso?.estado_de_cuenta !== undefined && aviso?.estado_de_cuenta !== null;
  if (!traeRestriccion && !traeEstado) return 'aviso_vacio';

  if (traeRestriccion && typeof aviso.restringida !== 'boolean') return 'restringida';
  if (traeEstado) {
    const malo = loQueEstaMalEnElEstadoDeCuenta(aviso.estado_de_cuenta);
    if (malo) return `estado_de_cuenta.${malo}`;
  }
  return null;
}

/** Dos decimales sin arrastrar el error del punto flotante. */
export function aDosDecimales(numero) {
  return Math.round((Number(numero) + Number.EPSILON) * 100) / 100;
}

/**
 * Qué está mal en una corrección que se quiere anotar, o `null` si está bien.
 *
 * Devuelve la clave del dato, no una frase: el texto visible sale de las traducciones.
 *
 * El tipo de comprobante es texto libre obligatorio y no se compara contra ninguna lista. Quién
 * emite decide cómo se llama lo que emitió, y eso cambia de país en país.
 */
export function loQueEstaMalEnLaCorreccion(correccion) {
  const monto = Number(correccion?.monto);
  if (!Number.isFinite(monto) || monto <= 0) return 'monto';
  if (!SENTIDOS_POSIBLES.includes(correccion?.sentido)) return 'sentido';
  if (!String(correccion?.comprobante_tipo ?? '').trim()) return 'comprobante_tipo';
  if (!String(correccion?.motivo ?? '').trim()) return 'motivo';
  if (correccion?.fecha !== undefined && correccion?.fecha !== null
      && !/^\d{4}-\d{2}-\d{2}$/.test(String(correccion.fecha))) return 'fecha';
  return null;
}

/**
 * Qué está mal en lo que informó el software de facturación, o `null` si está bien.
 *
 * El número de comprobante no es obligatorio: hay formas de facturar que no lo devuelven, y
 * trabarlo dejaría a esa Prestadora sin poder anotar lo que sí emitió.
 */
export function loQueEstaMalEnLoFacturado(facturado) {
  const monto = Number(facturado?.monto_facturado);
  if (!Number.isFinite(monto) || monto < 0) return 'monto_facturado';
  if (!String(facturado?.comprobante_tipo ?? '').trim()) return 'comprobante_tipo';
  if (facturado?.fecha_vencimiento !== undefined && facturado?.fecha_vencimiento !== null
      && !/^\d{4}-\d{2}-\d{2}$/.test(String(facturado.fecha_vencimiento))) return 'fecha_vencimiento';
  return null;
}
