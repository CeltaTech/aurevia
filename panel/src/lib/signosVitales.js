// Punto único de verdad de los signos vitales dentro del Panel (regla 12 de CLAUDE.md §7).
// Antes la lista de signos estaba escrita a mano en Configuracion.jsx; toda pantalla nueva
// que muestre o edite signos vitales consume estas constantes, no las vuelve a escribir.
//
// Las PWA de Familias y Asistentes tienen su propia copia porque son unidades desplegables
// separadas, sin acceso a este archivo — el mismo caso ya aceptado de identidadProducto.js.

export const SIGNOS_VITALES = ['presion_sistolica', 'presion_diastolica', 'temperatura', 'saturacion', 'glucemia'];

// Reportes viejos, anteriores a la separación de la presión en sistólica y diastólica.
// Se siguen mostrando tal cual quedaron guardados, sin rango de referencia.
export const SIGNOS_VITALES_LEGADO = ['presion', 'temperatura', 'saturacion', 'glucemia'];

/**
 * Devuelve 'normal', 'alerta' o null (null = no hay con qué comparar).
 * Mismo criterio que usan las dos PWA: dentro del rango es normal, fuera es alerta.
 */
export function colorSigno(valor, rango) {
  if (!rango || valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  if (Number.isNaN(numero)) return null;
  return numero >= rango.min && numero <= rango.max ? 'normal' : 'alerta';
}

/**
 * Arma el buscador de rangos a partir de las filas de rangos_referencia_vitales.
 * Cada Prestadora tiene sus rangos generales (paciente_id nulo) y puede tener rangos
 * propios de un Paciente, que mandan sobre los generales.
 *
 * Devolvés una función: rangoDe(pacienteId, signo) -> { min, max, unidad } | null
 */
export function armarBuscadorDeRangos(filas) {
  const generales = new Map();
  const porPaciente = new Map();

  for (const fila of filas ?? []) {
    const rango = { min: Number(fila.valor_min), max: Number(fila.valor_max), unidad: fila.unidad };
    if (fila.paciente_id) {
      if (!porPaciente.has(fila.paciente_id)) porPaciente.set(fila.paciente_id, new Map());
      porPaciente.get(fila.paciente_id).set(fila.signo, rango);
    } else {
      generales.set(fila.signo, rango);
    }
  }

  return function rangoDe(pacienteId, signo) {
    return porPaciente.get(pacienteId)?.get(signo) ?? generales.get(signo) ?? null;
  };
}

/**
 * ¿Este reporte tiene algún signo vital fuera del rango de referencia de su Paciente?
 * Es la pregunta que ordena la lista de reportes: lo que se salió de lo esperado va primero.
 */
export function tieneSignoFueraDeRango(signosVitales, pacienteId, rangoDe) {
  if (!signosVitales) return false;
  return SIGNOS_VITALES.some((signo) => colorSigno(signosVitales[signo], rangoDe(pacienteId, signo)) === 'alerta');
}
