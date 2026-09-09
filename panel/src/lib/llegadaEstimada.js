// ---------------------------------------------------------------------------
// llegadaEstimada.js — a qué hora se estima que alguien llega, y a partir de
// cuántos minutos de atraso eso se convierte en un aviso.
//
// QUÉ ES Y QUÉ NO ES. Esto es una estimación, no un pronóstico. Se arma con dos
// datos que el sistema sí tiene —desde qué punto salió la persona y a qué hora—
// y con la distancia en línea recta hasta el domicilio. No hay recorrido de
// calles, ni tránsito, ni frecuencia de colectivo. Por eso todas las funciones
// de acá devuelven `null` cuando no alcanzan los datos: una hora inventada es
// peor que ninguna hora, porque parece confiable y nadie la vuelve a revisar
// (el mismo criterio que ya está escrito en `panel/src/lib/candidatos.js`).
//
// POR QUÉ LA VELOCIDAD ES UNA SOLA Y NO UNA POR MEDIO DE TRANSPORTE.
// `guardias.medio_transporte` es texto libre —lo escribe quien registra la
// salida, «colectivo», «auto propio», «a pie»—, así que no hay ninguna lista
// contra la cual traducirlo a una velocidad. Inventar esa tabla sería adivinar
// dos veces. Se usa una velocidad media urbana única, y el margen que la
// Prestadora configura es el que absorbe la imprecisión.
//
// QUIÉN DECIDE LOS MINUTOS. La Prestadora, en `configuracion_escalada_relevo`.
// El número de acá abajo es solamente con lo que arranca quien todavía no
// configuró nada, igual que `METROS_TOLERANCIA_POR_OMISION` en
// `toleranciaCheckin.js`. No es una regla del producto.
//
// Este archivo existe dos veces y las dos son idénticas: el original es
// `panel/src/lib/llegadaEstimada.js` y la copia del motor la mantiene
// `scripts/sincronizar_copias.mjs`; `scripts/verificar_identidad.mjs` corta el
// build si se despegó. Nunca se edita la copia a mano.
// ---------------------------------------------------------------------------

/**
 * Minutos de atraso a partir de los cuales una llegada tarde deja de ser un
 * detalle y pasa a ser un aviso. Es el valor de arranque: cada Prestadora
 * escribe el suyo en `configuracion_escalada_relevo.minutos_demora`.
 */
export const MINUTOS_DEMORA_POR_OMISION = 10;

/** Velocidad media de un viaje urbano, en kilómetros por hora. */
export const VELOCIDAD_MEDIA_KM_H = 20;

/**
 * Cuánto más largo es el camino real que la línea recta. Las calles no van en
 * diagonal y casi ningún viaje es directo.
 */
export const FACTOR_RECORRIDO = 1.3;

/**
 * Los minutos de demora que tolera una Prestadora, sacados de sus niveles de
 * escalada.
 *
 * Se toma el menor de los configurados: los niveles son escalones de una misma
 * escalada, y el primero es el que dice a partir de cuándo hay algo que avisar.
 * Un nivel sin número no aporta nada y se saltea, en vez de arrastrar la lista
 * entera a cero.
 *
 * @param {Array<{minutos_demora?: number|null}>|null|undefined} niveles
 * @returns {number} siempre un número usable
 */
export function minutosDeDemoraTolerados(niveles) {
  const configurados = (niveles ?? [])
    .map((nivel) => nivel?.minutos_demora)
    .filter((minutos) => Number.isFinite(minutos) && minutos > 0);
  if (configurados.length === 0) return MINUTOS_DEMORA_POR_OMISION;
  return Math.min(...configurados);
}

/**
 * Cuántos minutos lleva recorrer una distancia, redondeado hacia arriba.
 *
 * @param {number|null|undefined} metros distancia en línea recta
 * @returns {number|null} `null` cuando la distancia no se pudo medir
 */
export function minutosDeViaje(metros) {
  if (!Number.isFinite(metros) || metros < 0) return null;
  const km = (metros / 1000) * FACTOR_RECORRIDO;
  return Math.ceil((km / VELOCIDAD_MEDIA_KM_H) * 60);
}

/**
 * La hora estimada de llegada de quien ya salió.
 *
 * @param {object} datos
 * @param {string|Date|null|undefined} datos.salidaAt cuándo se registró la salida
 * @param {number|null|undefined} datos.metros distancia hasta el domicilio
 * @returns {Date|null} `null` cuando falta la salida o la distancia
 */
export function horaEstimadaDeLlegada({ salidaAt, metros }) {
  if (!salidaAt) return null;
  const salida = salidaAt instanceof Date ? salidaAt : new Date(salidaAt);
  if (Number.isNaN(salida.getTime())) return null;
  const minutos = minutosDeViaje(metros);
  if (minutos === null) return null;
  return new Date(salida.getTime() + minutos * 60_000);
}

/**
 * ¿La cuenta dice que no va a llegar a horario?
 *
 * Devuelve `true`, `false` o `null`. El `null` es el caso en que no se sabe
 * —falta la estimación o falta la hora de inicio— y no significa que llegue
 * bien: significa que no hay con qué contestar. Quien llama tiene que
 * distinguir los tres, nunca leer `null` como un no.
 *
 * @param {object} datos
 * @param {Date|null} datos.llegadaEstimada
 * @param {Date|null} datos.inicio hora de inicio de la guardia
 * @param {number} datos.minutosTolerados margen que decidió la Prestadora
 * @returns {boolean|null}
 */
export function llegaTarde({ llegadaEstimada, inicio, minutosTolerados }) {
  if (!(llegadaEstimada instanceof Date) || Number.isNaN(llegadaEstimada.getTime())) return null;
  if (!(inicio instanceof Date) || Number.isNaN(inicio.getTime())) return null;
  const margen = Number.isFinite(minutosTolerados) && minutosTolerados > 0
    ? minutosTolerados
    : MINUTOS_DEMORA_POR_OMISION;
  return llegadaEstimada.getTime() > inicio.getTime() + margen * 60_000;
}
