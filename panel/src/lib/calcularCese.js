import { obtenerValorEscala, obtenerFormulaVigente } from './escalasLegales';

// Causales que nunca calculan un monto automático — quedan siempre para el abogado.
// Ver docs/PRD_02B_Gestion_Personal.md sección "Fuera de alcance". A diferencia de las
// causales de `formulas_cese`, estas no dependen de la ley de un país en particular —
// nunca van a tener fila en esa tabla, en ninguna jurisdicción.
const CAUSALES_SIN_CALCULO_AUTOMATICO = new Set([
  'incapacidad_absoluta', 'jubilacion', 'fin_contrato_comercial', 'muerte_persona_cuidada',
]);

// --- Aritmética común, no legal — "cómo se prorratea un día/mes" no varía por país,
// por eso queda en código en vez de en `formulas_cese` (ver plan pendiente #72). Lo que sí
// varía por país (qué componentes existen, en qué orden, con qué escalas) es dato puro,
// interpretado más abajo por ejecutarPaso/ejecutarDefinicion.

function aniosCompletos(fechaAlta, fechaHecho, escalasResueltas, escalaUmbral) {
  const alta = new Date(fechaAlta);
  const hecho = new Date(fechaHecho);
  let anios = hecho.getFullYear() - alta.getFullYear();
  const cumpleEsteAnio = new Date(alta);
  cumpleEsteAnio.setFullYear(alta.getFullYear() + anios);
  if (cumpleEsteAnio > hecho) anios -= 1;

  const umbralDias = escalaUmbral
    ? obtenerValorEscala(escalasResueltas, escalaUmbral.tipo, escalaUmbral.categoria)
    : null;
  if (umbralDias !== null) {
    const proximoAniversario = new Date(alta);
    proximoAniversario.setFullYear(alta.getFullYear() + anios + 1);
    const diasHastaProximo = (proximoAniversario - hecho) / (1000 * 60 * 60 * 24);
    const diasDelAnio = (proximoAniversario - cumpleEsteAnio) / (1000 * 60 * 60 * 24);
    if (diasDelAnio - diasHastaProximo > umbralDias) anios += 1;
  }

  return Math.max(anios, 0);
}

function mesesDeAntiguedad(fechaAlta, fechaHecho) {
  const alta = new Date(fechaAlta);
  const hecho = new Date(fechaHecho);
  return (hecho.getFullYear() - alta.getFullYear()) * 12 + (hecho.getMonth() - alta.getMonth());
}

function mejorRemuneracion(asistente) {
  if (asistente.tipo_vinculo === 'dependencia' && asistente.sueldo_basico) {
    return Number(asistente.sueldo_basico);
  }
  if (asistente.valor_hora && asistente.horas_semanales) {
    return Number(asistente.valor_hora) * Number(asistente.horas_semanales) * 4.33;
  }
  return 0;
}

function diasHastaFinDeMes(fechaHecho) {
  const hecho = new Date(fechaHecho);
  const finDeMes = new Date(hecho.getFullYear(), hecho.getMonth() + 1, 0);
  return Math.max(0, (finDeMes - hecho) / (1000 * 60 * 60 * 24));
}

function buscarPaso(definicion, id) {
  return (definicion.pasos ?? []).find((p) => p.id === id);
}

function aplicarRenombrar(detalle, renombrar) {
  if (!renombrar) return detalle;
  const resultado = {};
  for (const [clave, valor] of Object.entries(detalle)) {
    resultado[renombrar[clave] ?? clave] = valor;
  }
  return resultado;
}

// --- Vocabulario cerrado de "tipo" de paso — cada uno es la implementación pura de un
// verbo que antes vivía hardcodeado en el switch(causal). Lo que compone estos pasos
// (orden, parámetros, qué causal usa cuáles) es dato en `formulas_cese.definicion`.

function ejecutarPreavisoProrrateado(parametros, { asistente, fechaCese, escalasLegales, advertencias }) {
  const meses = mesesDeAntiguedad(asistente.fecha_alta, fechaCese);
  const ref = meses < 12 ? parametros.escala_menos_1_anio : parametros.escala_mas_1_anio;
  const dias = obtenerValorEscala(escalasLegales, ref.tipo, ref.categoria);
  if (dias === null) {
    advertencias.push('Falta escala vigente para preaviso_dias — no se pudo calcular el sustitutivo de preaviso.');
    return { monto: null, detalle: { diasPreaviso: null, sustitutivoPreaviso: null } };
  }
  const monto = (mejorRemuneracion(asistente) / 30) * dias;
  return { monto, detalle: { diasPreaviso: dias, sustitutivoPreaviso: monto } };
}

function ejecutarIndemnizacionPorAnio(parametros, { asistente, fechaCese, escalasLegales, advertencias }) {
  const anios = aniosCompletos(asistente.fecha_alta, fechaCese, escalasLegales, parametros.escala_umbral_fraccion);
  const mesesPorAnio = obtenerValorEscala(escalasLegales, parametros.escala_meses_por_anio.tipo, parametros.escala_meses_por_anio.categoria);
  const tope = obtenerValorEscala(escalasLegales, parametros.escala_tope.tipo, parametros.escala_tope.categoria);
  const pisoMeses = obtenerValorEscala(escalasLegales, parametros.escala_piso_meses.tipo, parametros.escala_piso_meses.categoria);

  if (mesesPorAnio === null) {
    advertencias.push('Falta escala vigente para indemnizacion_antiguedad — no se pudo calcular.');
    return { monto: null, detalle: { aniosAntiguedad: anios, indemnizacionAntiguedad: null, topeIndemnizatorioAplicado: false } };
  }

  const base = mejorRemuneracion(asistente);
  let monto = base * mesesPorAnio * Math.max(anios, 1);

  // El piso mínimo protege montos muy bajos, pero nunca debe hacer que el resultado
  // supere el tope indemnizatorio — el tope siempre es el techo final.
  if (pisoMeses !== null) {
    const piso = base * pisoMeses;
    if (monto < piso) monto = piso;
  }

  let topeAplicado = false;
  if (tope !== null && monto > tope) {
    monto = tope;
    topeAplicado = true;
  }

  return { monto, detalle: { aniosAntiguedad: anios, indemnizacionAntiguedad: monto, topeIndemnizatorioAplicado: topeAplicado } };
}

function ejecutarIntegracionMesDespido(_parametros, { fechaCese, asistente }) {
  const diasIntegracion = diasHastaFinDeMes(fechaCese);
  const montoIntegracion = (mejorRemuneracion(asistente) / 30) * diasIntegracion;
  return {
    monto: Number(montoIntegracion.toFixed(2)),
    detalle: {
      diasIntegracionMesDespido: Number(diasIntegracion.toFixed(1)),
      integracionMesDespido: Number(montoIntegracion.toFixed(2)),
    },
  };
}

function ejecutarMultiplicadorFijo(parametros, { asistente, escalasLegales, advertencias }) {
  const multiplicador = obtenerValorEscala(escalasLegales, parametros.escala.tipo, parametros.escala.categoria);
  if (multiplicador === null) {
    advertencias.push(`Falta escala vigente para ${parametros.escala.tipo} — no se pudo calcular el agravamiento.`);
    return { monto: null, detalle: { mesesAgravado: null, indemnizacionAgravada: null } };
  }
  const monto = Number((mejorRemuneracion(asistente) * multiplicador).toFixed(2));
  return { monto, detalle: { mesesAgravado: multiplicador, indemnizacionAgravada: monto } };
}

function ejecutarMitadDeComponente(parametros, { pasosResueltos }) {
  const referencia = pasosResueltos.get(parametros.referencia);
  const monto = referencia.monto !== null ? Number((referencia.monto / 2).toFixed(2)) : null;
  return { monto, detalle: { ...referencia.detalle, indemnizacionReducida: 'Mitad de la indemnización por antigüedad' } };
}

function ejecutarVerificarPeriodoPrueba(parametros, { asistente, fechaCese, escalasLegales, advertencias }) {
  const diasPrueba = obtenerValorEscala(escalasLegales, parametros.escala_dias_prueba.tipo, parametros.escala_dias_prueba.categoria);
  const diasTranscurridos = mesesDeAntiguedad(asistente.fecha_alta, fechaCese) * 30;
  const dentroDelPeriodo = diasPrueba !== null && diasTranscurridos <= diasPrueba;
  if (!dentroDelPeriodo) {
    advertencias.push('La antigüedad excede el período de prueba vigente — revisar si corresponde otra causal.');
  }
  return {
    monto: dentroDelPeriodo ? 0 : null,
    detalle: { diasPeriodoPrueba: diasPrueba, diasTranscurridos },
    requiereRevisionAbogadoOverride: !dentroDelPeriodo,
  };
}

function ejecutarPaso(paso, ctx) {
  switch (paso.tipo) {
    case 'preaviso_prorrateado': return ejecutarPreavisoProrrateado(paso.parametros, ctx);
    case 'indemnizacion_por_anio_con_tope_y_piso': return ejecutarIndemnizacionPorAnio(paso.parametros, ctx);
    case 'integracion_mes_despido': return ejecutarIntegracionMesDespido(paso.parametros, ctx);
    case 'multiplicador_fijo_sobre_remuneracion': return ejecutarMultiplicadorFijo(paso.parametros, ctx);
    case 'mitad_de_componente': return ejecutarMitadDeComponente(paso.parametros, ctx);
    case 'verificar_periodo_prueba': return ejecutarVerificarPeriodoPrueba(paso.parametros, ctx);
    default:
      throw new Error(`Tipo de paso de fórmula de cese no reconocido: "${paso.tipo}"`);
  }
}

function fusionarDetalles(ids, pasosResueltos, definicion) {
  return ids.reduce((acc, id) => {
    const paso = buscarPaso(definicion, id);
    const detalle = aplicarRenombrar(pasosResueltos.get(id).detalle, paso?.renombrar);
    return { ...acc, ...detalle };
  }, {});
}

function aplicarAdvertenciaUmbralAntiguedad(refEscala, ctx) {
  const { asistente, fechaCese, escalasLegales, advertencias } = ctx;
  const umbralDias = obtenerValorEscala(escalasLegales, refEscala.tipo, refEscala.categoria);
  const umbralMeses = umbralDias !== null ? umbralDias / 30 : 3;
  const anios = aniosCompletos(asistente.fecha_alta, fechaCese, escalasLegales, refEscala);
  if (anios < 1 || mesesDeAntiguedad(asistente.fecha_alta, fechaCese) < umbralMeses) {
    advertencias.push(`Antigüedad menor a ${umbralMeses} meses, verificar período de prueba.`);
  }
}

// Ejecuta la `definicion` (dato de `formulas_cese`) de una causal ya resuelta por
// vigencia. Puede recursar vía `compone_sobre_causal` (ej. el agravamiento por embarazo
// suma sobre el resultado íntegro de despido_sin_causa de la misma jurisdicción/fecha).
function ejecutarDefinicion(definicion, ctx) {
  const pasosResueltos = new Map();
  const ctxConPasos = { ...ctx, pasosResueltos };
  for (const paso of definicion.pasos ?? []) {
    pasosResueltos.set(paso.id, ejecutarPaso(paso, ctxConPasos));
  }

  if (definicion.advertencia_umbral_antiguedad) {
    aplicarAdvertenciaUmbralAntiguedad(definicion.advertencia_umbral_antiguedad, ctx);
  }
  if (definicion.advertencia_si_no_dependencia && ctx.asistente.tipo_vinculo !== 'dependencia') {
    ctx.advertencias.push(definicion.advertencia_si_no_dependencia);
  }

  const combinar = definicion.combinar;
  let montoTotal = null;
  let detalleCalculo = {};
  let requiereRevisionAbogadoOverride;

  switch (combinar.operacion) {
    case 'sumar': {
      const valores = combinar.pasos.map((id) => pasosResueltos.get(id));
      montoTotal = valores.every((v) => v.monto !== null)
        ? Number(valores.reduce((acc, v) => acc + v.monto, 0).toFixed(2))
        : null;
      detalleCalculo = fusionarDetalles(combinar.pasos, pasosResueltos, definicion);
      break;
    }

    case 'sumar_sobre_base': {
      const base = interpretarFormula({ ...ctx, causal: definicion.compone_sobre_causal });
      const valoresPropios = combinar.pasos.map((id) => pasosResueltos.get(id));
      const propiosCompletos = valoresPropios.every((v) => v.monto !== null);
      montoTotal = (base.montoTotal !== null && propiosCompletos)
        ? Number((base.montoTotal + valoresPropios.reduce((acc, v) => acc + v.monto, 0)).toFixed(2))
        : null;
      detalleCalculo = { ...base.detalleCalculo, ...fusionarDetalles(combinar.pasos, pasosResueltos, definicion) };
      break;
    }

    case 'usar_paso': {
      const resultado = pasosResueltos.get(combinar.paso);
      montoTotal = resultado.monto;
      detalleCalculo = aplicarRenombrar(resultado.detalle, buscarPaso(definicion, combinar.paso)?.renombrar);
      if (resultado.requiereRevisionAbogadoOverride !== undefined) {
        requiereRevisionAbogadoOverride = resultado.requiereRevisionAbogadoOverride;
      }
      break;
    }

    case 'monto_fijo': {
      montoTotal = combinar.valor;
      detalleCalculo = combinar.detalle_de_paso
        ? aplicarRenombrar(pasosResueltos.get(combinar.detalle_de_paso).detalle, buscarPaso(definicion, combinar.detalle_de_paso)?.renombrar)
        : {};
      break;
    }

    case 'monto_fijo_cero': {
      montoTotal = 0;
      detalleCalculo = combinar.motivo ? { motivo: combinar.motivo } : {};
      if (combinar.advertencia) ctx.advertencias.push(combinar.advertencia);
      break;
    }

    case 'sin_calculo_automatico': {
      montoTotal = null;
      detalleCalculo = { motivo: combinar.motivo ?? null };
      break;
    }

    default:
      throw new Error(`Operación de combinación de fórmula de cese no reconocida: "${combinar.operacion}"`);
  }

  if (definicion.requiere_revision_abogado_si_incompleto && requiereRevisionAbogadoOverride === undefined) {
    requiereRevisionAbogadoOverride = montoTotal === null;
  }

  return {
    montoTotal,
    detalleCalculo,
    advertencias: ctx.advertencias,
    requiereRevisionAbogado: requiereRevisionAbogadoOverride !== undefined ? requiereRevisionAbogadoOverride : definicion.requiere_revision_abogado,
  };
}

// Sin fila en `formulas_cese` para esta jurisdicción/causal → fail-closed explícito, nunca
// se aproxima con la fórmula de otro país (mismo principio que advertencias_legales,
// CLAUDE.md §3: "sin fila = sin comportamiento inventado").
function interpretarFormula(ctx) {
  const { causal, formulasLegales, jurisdiccion } = ctx;
  const definicion = obtenerFormulaVigente(formulasLegales, causal);
  if (!definicion) {
    return {
      montoTotal: null,
      detalleCalculo: { motivo: `No hay fórmula de cese cargada para "${jurisdiccion}"/"${causal}".` },
      advertencias: [...ctx.advertencias, 'Jurisdicción sin legislación de cese investigada aún — cálculo manual con asesoría legal local.'],
      requiereRevisionAbogado: true,
    };
  }
  return ejecutarDefinicion(definicion, ctx);
}

// Función pura y testeable — ver checklist de docs/PRD_02B_Gestion_Personal.md.
// No hace consultas de red ni de DB: `escalasLegales` y `formulasLegales` ya vienen
// resueltos para `fechaCese`/`jurisdiccion` vía resolverEscalasVigentes/resolverFormulasVigentes
// (ver escalasLegales.js). La estructura de cálculo por causal vive en `formulas_cese`
// (pendiente #72) — este archivo es un intérprete genérico de esos datos, no un switch por país.
export function calcularCese({ asistente, fechaCese, causal, escalasLegales, jurisdiccion, formulasLegales }) {
  const advertencias = [];

  if (CAUSALES_SIN_CALCULO_AUTOMATICO.has(causal)) {
    return {
      montoTotal: null,
      detalleCalculo: { motivo: 'Causal fuera de alcance del cálculo automático — ver docs/PRD_02B_Gestion_Personal.md.' },
      advertencias: ['Esta causal no calcula un monto automático. El cálculo se hace fuera del sistema.'],
      requiereRevisionAbogado: true,
    };
  }

  return interpretarFormula({ asistente, fechaCese, causal, escalasLegales, jurisdiccion, formulasLegales, advertencias });
}
