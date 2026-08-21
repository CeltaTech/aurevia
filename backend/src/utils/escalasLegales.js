// Resuelve, para una fecha del hecho dada, qué fila de `escalas_legales` está vigente
// por cada (tipo, categoria), dentro de una jurisdicción. Regla crítica de
// CLAUDE.md/PRD_02B: siempre por vigencia_desde <= fechaHecho <= vigencia_hasta (o
// vigencia_hasta NULL), nunca por la fecha actual del sistema.
export function resolverEscalasVigentes(filasEscalasLegales, fechaHecho, jurisdiccion) {
  const fecha = new Date(fechaHecho);
  const resueltas = new Map();

  for (const fila of filasEscalasLegales) {
    if (jurisdiccion && fila.jurisdiccion !== jurisdiccion) continue;
    const desde = new Date(fila.vigencia_desde);
    const hasta = fila.vigencia_hasta ? new Date(fila.vigencia_hasta) : null;
    const vigente = desde <= fecha && (!hasta || hasta >= fecha);
    if (!vigente) continue;

    const clave = `${fila.tipo}::${fila.categoria ?? ''}`;
    const actual = resueltas.get(clave);
    if (!actual || new Date(actual.vigencia_desde) < desde) {
      resueltas.set(clave, fila);
    }
  }

  return resueltas;
}

export function obtenerValorEscala(escalasResueltas, tipo, categoria = '') {
  const fila = escalasResueltas.get(`${tipo}::${categoria}`);
  return fila ? Number(fila.valor) : null;
}

// Mismo mecanismo de vigencia que resolverEscalasVigentes, aplicado a formulas_cese
// (una fila por jurisdicción+causal). A diferencia de las escalas, acá la clave es solo
// `causal` porque las filas ya vienen filtradas por jurisdicción antes de llamar a esta
// función (o se pasa `jurisdiccion` para filtrar acá mismo).
export function resolverFormulasVigentes(filasFormulasCese, fechaHecho, jurisdiccion) {
  const fecha = new Date(fechaHecho);
  const resueltas = new Map();

  for (const fila of filasFormulasCese) {
    if (jurisdiccion && fila.jurisdiccion !== jurisdiccion) continue;
    const desde = new Date(fila.vigencia_desde);
    const hasta = fila.vigencia_hasta ? new Date(fila.vigencia_hasta) : null;
    const vigente = desde <= fecha && (!hasta || hasta >= fecha);
    if (!vigente) continue;

    const actual = resueltas.get(fila.causal);
    if (!actual || new Date(actual.vigencia_desde) < desde) {
      resueltas.set(fila.causal, fila);
    }
  }

  return resueltas;
}

export function obtenerFormulaVigente(formulasResueltas, causal) {
  const fila = formulasResueltas.get(causal);
  return fila ? fila.definicion : null;
}
