// ---------------------------------------------------------------------------
// conceptosLiquidacion.js — qué campos lleva un concepto, y cuáles no
//
// POR QUÉ EXISTE
// Un concepto del catálogo puede armarse de tres maneras, y las tres tienen campos que
// sobran. Un porcentaje no lleva moneda, porque un porcentaje no es plata. Un concepto que
// sale de una escala legal no lleva valor propio, porque el valor no nos corresponde
// fijarlo. Y uno de valor propio no lleva tipo de escala, porque no mira ninguna.
//
// La base ya rechaza las tres combinaciones imposibles, y esa es la palabra final. Pero un
// rechazo de la base llega tarde: aparece después de completar el formulario entero y de
// apretar guardar, y lo que se ve es un error que no explica cuál de los datos sobraba. Acá
// se decide, ANTES, qué campos se muestran y cuáles se mandan vacíos, para que la
// combinación imposible no llegue a existir.
//
// No es la misma regla escrita dos veces: es la de la base traducida a qué se ve en
// pantalla. Si alguna vez las dos dijeran cosas distintas, manda la base.
// ---------------------------------------------------------------------------

/** Si el concepto engorda el número o lo achica. */
export const SIGNOS = ['suma', 'resta'];

/** Cómo se calcula. Son las mismas tres palabras que usan las escalas legales. */
export const UNIDADES = ['monto_fijo_mensual', 'porcentaje', 'monto_por_hora'];

/** De dónde sale el número: de la Prestadora, o de una escala legal vigente. */
export const ORIGENES = ['propio', 'escala_legal'];

/** A quién le corresponde el concepto, según su tipo de vínculo. */
export const ALCANCES = ['todos', 'dependencia', 'monotributo'];

/**
 * Qué campos tienen sentido para un concepto armado así. Los que dan `false` no se muestran
 * y se guardan vacíos.
 */
export function camposDelConcepto({ unidad, origen_valor } = {}) {
  const saleDeUnaEscala = origen_valor === 'escala_legal';
  return {
    valor: !saleDeUnaEscala,
    escala_tipo: saleDeUnaEscala,
    // La moneda acompaña a un importe propio. Cuando el importe sale de una escala legal, la
    // moneda viene con la escala; cuando es un porcentaje, no hay ninguna moneda que poner.
    moneda: !saleDeUnaEscala && unidad !== 'porcentaje',
  };
}

/**
 * Qué le falta a un concepto para poder guardarse. Devuelve los nombres de los campos vacíos
 * —lista vacía cuando está completo—, así el botón de guardar sabe si habilitarse.
 */
export function loQueFaltaDelConcepto(concepto = {}) {
  const campos = camposDelConcepto(concepto);
  const falta = [];

  if (!String(concepto.nombre ?? '').trim()) falta.push('nombre');
  if (!SIGNOS.includes(concepto.signo)) falta.push('signo');
  if (!UNIDADES.includes(concepto.unidad)) falta.push('unidad');
  if (!ORIGENES.includes(concepto.origen_valor)) falta.push('origen_valor');
  if (!ALCANCES.includes(concepto.aplica_a)) falta.push('aplica_a');

  // Un valor en cero no es un dato faltante: es un concepto que hoy no descuenta nada. Por
  // eso se pregunta si el campo está vacío, no si el número da falso.
  if (campos.valor && String(concepto.valor ?? '').trim() === '') falta.push('valor');
  if (campos.escala_tipo && !String(concepto.escala_tipo ?? '').trim()) falta.push('escala_tipo');
  if (campos.moneda && !concepto.moneda) falta.push('moneda');

  return falta;
}

/**
 * El concepto tal como se manda a guardar: los campos que no corresponden viajan vacíos, y
 * los números viajan como números.
 *
 * Vaciarlos explícitamente no es lo mismo que no mandarlos. Al editar un concepto que era de
 * valor propio y pasa a salir de una escala, el valor viejo tiene que borrarse: si se manda
 * solo el tipo de escala, el concepto queda con las dos cosas y la base lo rechaza.
 */
export function conceptoParaGuardar(concepto = {}) {
  const campos = camposDelConcepto(concepto);
  const numero = (valor) => (String(valor ?? '').trim() === '' ? null : Number(valor));

  return {
    nombre: String(concepto.nombre ?? '').trim(),
    signo: concepto.signo,
    unidad: concepto.unidad,
    origen_valor: concepto.origen_valor,
    aplica_a: concepto.aplica_a,
    valor: campos.valor ? numero(concepto.valor) : null,
    escala_tipo: campos.escala_tipo ? String(concepto.escala_tipo).trim() : null,
    moneda: campos.moneda ? concepto.moneda : null,
    orden: numero(concepto.orden) ?? 100,
  };
}
