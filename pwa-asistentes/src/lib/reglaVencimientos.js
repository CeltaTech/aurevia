// ---------------------------------------------------------------------------
// reglaVencimientos.js — cuándo un papel está por vencer, decidido una sola vez
//
// POR QUÉ EXISTE
// La misma pregunta —"¿este papel está vencido, está por vencer o está bien?"—
// la hacían siete lugares distintos, cada uno con su propia cuenta y con el
// número 30 escrito a mano: el Estado actual, la pantalla de Documentación, el
// tablero, el buscador de candidatos, la solapa de Matrículas, la pantalla del
// Asistente en el teléfono y el aviso diario por correo. Siete cuentas para una
// sola pregunta terminan siempre igual: una pantalla dice "vence en 5 días" y
// la de al lado no muestra nada. Acá se decide una vez (regla 12 de CLAUDE.md §7).
//
// ESTE ARCHIVO EXISTE TRES VECES
// El original es este. Las copias viven en la aplicación del Asistente y en el
// motor, porque cada carpeta se publica por su cuenta y no puede importar
// código de las otras. La lista está en `scripts/copias_entre_apps.mjs`,
// `scripts/sincronizar_copias.mjs` las vuelve a copiar y
// `scripts/verificar_identidad.mjs` corta el build si alguna se despegó.
// Nunca se edita una copia a mano.
// ---------------------------------------------------------------------------

/**
 * Cuántos días antes se empieza a avisar, cuando la Prestadora no configuró el suyo.
 *
 * Es un valor de arranque, no una regla escrita en piedra: cada Prestadora lo cambia desde
 * Configuración (`prestadoras.dias_aviso_vencimiento_documentos`, que nace con este mismo 30).
 * Está acá solo para el caso en que ese dato todavía no llegó o no se pudo pedir.
 */
export const DIAS_AVISO_POR_DEFECTO = 30;

/**
 * A partir de qué momento el aviso pasa de "conviene" a "urgente".
 *
 * Es el último tercio de la ventana de aviso: con 30 días de ventana, aprieta en los últimos 10.
 * Se calcula a partir del número que la Prestadora ya configuró en vez de pedirle un segundo
 * número, porque dos interruptores para la misma decisión terminan siempre desalineadas.
 */
export const PROPORCION_URGENTE = 1 / 3;

/** Qué tan apurado es un vencimiento. */
export const URGENCIA = {
  NINGUNA: 'ninguna',
  AVISO: 'aviso',
  URGENTE: 'urgente',
  VENCIDA: 'vencida',
};

/**
 * Las tres palabras con las que las listas muestran un vencimiento.
 *
 * Son menos que las cuatro urgencias a propósito: en una tabla de papeles, "conviene renovar" y
 * "renovalo ya" se pintan del mismo color y se filtran juntos, así que se muestran igual. La
 * diferencia entre esos dos sigue existiendo donde sí sirve: en el cartel de una sola Matrícula.
 */
export const ESTADO_VENCIMIENTO = {
  VIGENTE: 'vigente',
  POR_VENCER: 'por_vencer',
  VENCIDO: 'vencido',
};

/** Una fecha —Date o texto— en el formato de día que usa la base: `AAAA-MM-DD`. */
export function diaISO(momento) {
  if (!momento) return null;
  if (typeof momento === 'string') return momento.slice(0, 10);
  if (momento instanceof Date && !Number.isNaN(momento.getTime())) {
    const anio = momento.getFullYear();
    const mes = String(momento.getMonth() + 1).padStart(2, '0');
    const dia = String(momento.getDate()).padStart(2, '0');
    return `${anio}-${mes}-${dia}`;
  }
  return null;
}

/**
 * La ventana de aviso que se va a usar de verdad.
 *
 * Existe porque el número llega de muchos lados —del servidor, de la base, de una consulta que
 * falló— y puede venir vacío, en cero o como texto. Un cero significaría "no avisar nunca", que
 * no es lo que nadie quiso configurar: en ese caso vale el valor de arranque.
 */
export function ventanaDeAviso(diasAviso = DIAS_AVISO_POR_DEFECTO) {
  const numero = Number(diasAviso);
  return Number.isFinite(numero) && numero > 0 ? numero : DIAS_AVISO_POR_DEFECTO;
}

/**
 * Cuántos días faltan para que venza algo. `null` si no vence o no hay fecha.
 *
 * Se cuenta en días de calendario, no en horas: a nadie le sirve "vence en 0,3 días".
 */
export function diasParaVencer(fechaVencimiento, desde = new Date()) {
  if (!fechaVencimiento) return null;
  const hoy = diaISO(desde);
  const vence = diaISO(fechaVencimiento);
  if (!hoy || !vence) return null;
  const unDia = 24 * 60 * 60 * 1000;
  return Math.round((Date.parse(`${vence}T00:00:00`) - Date.parse(`${hoy}T00:00:00`)) / unDia);
}

/**
 * Hasta qué día hay que mirar para traer todo lo que vence dentro de la ventana de aviso.
 *
 * Sirve para pedirle a la base solo lo que interesa, en vez de traer todos los papeles y
 * descartarlos después. Devuelve el día en `AAAA-MM-DD`, listo para comparar contra la base.
 */
export function fechaLimiteDeAviso(diasAviso = DIAS_AVISO_POR_DEFECTO, desde = new Date()) {
  const dia = diaISO(desde);
  if (!dia) return null;
  const limite = new Date(`${dia}T00:00:00`);
  limite.setDate(limite.getDate() + ventanaDeAviso(diasAviso));
  return diaISO(limite);
}

/**
 * Qué tan apurado es el vencimiento: `ninguna`, `aviso`, `urgente` o `vencida`.
 *
 * @param dias        cuántos días faltan (lo que devuelve `diasParaVencer`).
 * @param diasAviso   la ventana que configuró la Prestadora.
 */
export function urgenciaDeVencimiento(dias, diasAviso = DIAS_AVISO_POR_DEFECTO) {
  if (dias === null || dias === undefined) return URGENCIA.NINGUNA;
  if (dias < 0) return URGENCIA.VENCIDA;
  const ventana = ventanaDeAviso(diasAviso);
  if (dias > ventana) return URGENCIA.NINGUNA;
  if (dias <= Math.ceil(ventana * PROPORCION_URGENTE)) return URGENCIA.URGENTE;
  return URGENCIA.AVISO;
}

/**
 * Lo mismo que `urgenciaDeVencimiento`, dicho con las tres palabras de las listas.
 *
 * Es la misma decisión, no otra: se apoya en la de arriba y junta "conviene" con "urgente".
 * Está acá y no en cada pantalla porque son dos las que arman esa lista —Documentación y el
 * Estado actual— y el día que una empiece a contar distinto de la otra, nadie lo va a notar.
 */
export function estadoDeVencimiento(dias, diasAviso = DIAS_AVISO_POR_DEFECTO) {
  const urgencia = urgenciaDeVencimiento(dias, diasAviso);
  if (urgencia === URGENCIA.VENCIDA) return ESTADO_VENCIMIENTO.VENCIDO;
  if (urgencia === URGENCIA.NINGUNA) return ESTADO_VENCIMIENTO.VIGENTE;
  return ESTADO_VENCIMIENTO.POR_VENCER;
}
