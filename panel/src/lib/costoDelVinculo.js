// ---------------------------------------------------------------------------
// costoDelVinculo.js — qué le sale a la Prestadora la misma persona bajo cada vínculo
//
// POR QUÉ EXISTE. El Simulador de Vínculo existe para contestar una pregunta antes de tomar
// una decisión: tener a esta persona como monotributista o en relación de dependencia, cuánto
// cambia. Esa pregunta tiene dos mitades. Una es qué pasa el día que el vínculo se termina, y
// la contesta `calcularCese`. La otra es cuánto cuesta cada mes mientras dura, y es ésta.
//
// LA CUENTA NO SE INVENTA ACÁ. El costo mensual es la liquidación de esa persona, hecha con el
// catálogo de conceptos que cargó la Prestadora: es la misma cuenta que va a salir todos los
// meses, y por eso se hace con la misma función (`calcularLiquidacion.js`). Lo único propio de
// este archivo es armar la persona hipotética bajo el otro vínculo y decir qué parte de esa
// liquidación es costo para quien paga.
//
// NINGÚN COEFICIENTE LEGAL ESTÁ ESCRITO ACÁ. Ni cargas, ni aportes, ni aguinaldo: todo eso son
// conceptos del catálogo de la Prestadora, y los que salen de una escala legal se resuelven
// contra `escalas_legales` por jurisdicción y a la fecha. Si un concepto no se puede resolver,
// sale nombrado en `sinEscala` y el número se muestra diciendo que está incompleto. Nunca se
// estima lo que falta.
// ---------------------------------------------------------------------------
import { calcularLiquidacion, redondear } from './calcularLiquidacion';

// Cuántas semanas tiene un mes. No es un número elegido: son las 52 semanas del año repartidas
// en los 12 meses. Hace falta porque a un monotributista se le paga por hora y la comparación
// es mensual, y porque un sueldo de dependencia que no está cargado se deriva de lo mismo.
export const SEMANAS_POR_MES = 52 / 12;

/**
 * La misma persona, pero con el vínculo que se quiere probar.
 *
 * Nunca se inventa un valor hora ni un sueldo de referencia: si el dato de base no está en el
 * Perfil, la proyección para ese vínculo no se puede hacer y se dice. Lo único que sí se
 * deriva es el sueldo de dependencia a partir del valor hora, porque no es un valor nuevo: es
 * el mismo, contado por mes en vez de por hora.
 */
export function asistenteBajoVinculo(asistenteBase, tipoVinculo) {
  const valorHora = asistenteBase.valor_hora ? Number(asistenteBase.valor_hora) : null;
  const horasSemanales = asistenteBase.horas_semanales ? Number(asistenteBase.horas_semanales) : null;
  const sueldoBasico = asistenteBase.sueldo_basico
    ? Number(asistenteBase.sueldo_basico)
    : (valorHora && horasSemanales ? valorHora * horasSemanales * SEMANAS_POR_MES : null);

  const esMonotributo = tipoVinculo === 'monotributo';
  return {
    ...asistenteBase,
    tipo_vinculo: tipoVinculo,
    valor_hora: esMonotributo ? valorHora : null,
    sueldo_basico: esMonotributo ? null : sueldoBasico,
  };
}

/**
 * Qué escala rige cada tipo a una fecha, para que un concepto la encuentre por su tipo.
 *
 * Las de categoría de convenio quedan afuera: un concepto apunta a un tipo de escala, no a una
 * categoría, y elegirle una sería adivinar. Es el mismo criterio con el que el motor arma esta
 * misma lista para un mes entero (`escalasEstablesDelPeriodo`), y por eso da lo mismo que acá
 * se mire un solo día: una proyección es de hoy, no de un período cerrado.
 */
export function escalasPorTipoALaFecha(escalasResueltas) {
  const porTipo = new Map();
  for (const fila of escalasResueltas.values()) {
    if (fila.categoria) continue;
    porTipo.set(fila.tipo, fila);
  }
  return porTipo;
}

/**
 * Lo que la Prestadora paga por un mes de esta persona bajo este vínculo.
 *
 * QUÉ CUENTA COMO COSTO. Lo que sale de la Prestadora, que no es lo mismo que lo que le llega
 * a la persona: un concepto que resta —una retención— se descuenta de lo que cobra, pero la
 * Prestadora lo paga igual, solamente que a otro. Por eso el costo es el bruto más lo que
 * suma, y las restas se informan aparte en vez de descontarse. Restarlas haría que un vínculo
 * pareciera más barato justo por tener más retenciones.
 *
 * Devuelve `{ faltaDato: true }` cuando no se puede hacer la cuenta, con el nombre del dato que
 * falta. Un cero se leería como "no cuesta nada", que es otra afirmación.
 */
export function costoMensualDelVinculo({
  asistenteBase, tipoVinculo, conceptos, escalasPorTipo, moneda, jurisdiccion, periodo,
}) {
  const asistente = asistenteBajoVinculo(asistenteBase, tipoVinculo);
  const horasSemanales = asistenteBase.horas_semanales ? Number(asistenteBase.horas_semanales) : null;

  // A un monotributista se le paga por hora: sin saber cuántas horas hace por semana no hay
  // mes que calcular, aunque el valor hora esté cargado.
  if (tipoVinculo === 'monotributo' && horasSemanales === null) {
    return { faltaDato: true, dato: 'horas_semanales' };
  }
  const horas = tipoVinculo === 'monotributo' ? horasSemanales * SEMANAS_POR_MES : 0;

  const calculada = calcularLiquidacion({
    asistente,
    acumulado: { guardias: 0, horas },
    conceptos,
    escalasPorTipo,
    moneda,
    jurisdiccion,
    periodo,
  });
  if (calculada.faltaBase) {
    return { faltaDato: true, dato: tipoVinculo === 'monotributo' ? 'valor_hora' : 'sueldo_basico' };
  }

  const { bruto, total_sumas: sumas, total_restas: restas } = calculada.liquidacion;
  return {
    faltaDato: false,
    costo: redondear(bruto + sumas),
    bruto,
    sumas,
    restas,
    horas: calculada.liquidacion.horas,
    items: calculada.items,
    sinEscala: calculada.sinEscala,
  };
}
