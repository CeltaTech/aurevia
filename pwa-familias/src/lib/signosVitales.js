// Éste es el original de los signos vitales: cuáles se toman, cuáles quedaron de los reportes
// viejos, y cuándo un valor se salió del rango de referencia.
//
// Antes la lista estaba escrita a mano adentro de Configuracion.jsx, y después volvió a
// aparecer escrita a mano en cada aplicación. Una lista repetida no se desactualiza de golpe:
// se desactualiza de a una pantalla por vez, y nadie se entera hasta que dos partes del
// producto muestran cosas distintas de la misma persona. Por eso toda pantalla que muestre o
// edite signos vitales consume estas constantes en vez de volver a escribirlas.
//
// Las aplicaciones de Familias y de Asistentes se despliegan cada una por su cuenta y no
// pueden importar este archivo. Tienen entonces una copia idéntica, que se genera desde acá
// con scripts/sincronizar_copias.mjs y que scripts/verificar_identidad.mjs vuelve a comparar,
// cortando el build si alguna se despegó. Es el punto único de verdad entre carpetas que se
// despliegan por separado, el mismo mecanismo que ya usa identidadProducto.js.
//
// Nunca se edita una copia: se edita este archivo y se regeneran.

export const SIGNOS_VITALES = ['presion_sistolica', 'presion_diastolica', 'temperatura', 'saturacion', 'glucemia'];

// Reportes viejos, anteriores a la separación de la presión en sistólica y diastólica.
// Se siguen mostrando tal cual quedaron guardados, sin rango de referencia.
export const SIGNOS_VITALES_LEGADO = ['presion', 'temperatura', 'saturacion', 'glucemia'];

/**
 * Devuelve 'normal', 'alerta' o null (null = no hay con qué comparar).
 * Mismo criterio en las tres pantallas: dentro del rango es normal, fuera es alerta.
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
 * Devuelve una función: rangoDe(pacienteId, signo) -> { min, max, unidad } | null
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
