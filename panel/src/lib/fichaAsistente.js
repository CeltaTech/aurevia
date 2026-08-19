/**
 * Dos partes de la ficha del Asistente viven en tablas aparte, no en `asistentes`.
 *
 * Están separadas a propósito: las reglas de acceso de la base filtran filas, no columnas, así
 * que mientras esos datos estaban dentro de `asistentes` cualquiera que podía ver la ficha
 * podía leerlos. En su propia tabla, la base exige un permiso antes de contestar:
 *
 *   - `remuneraciones_asistente` — lo que cobra. Permiso `ver_pagos_asistente`.
 *   - `datos_reservados_asistente` — por qué se lo dio de baja, su puntaje de riesgo con los
 *     motivos que lo forman, y por qué quedó excluido de recibir trabajo. Permiso
 *     `ver_datos_reservados_asistente`.
 *
 * Para las pantallas eso es un detalle de dónde está guardado el dato, no una forma nueva de
 * leerlo: se piden junto con la ficha y `conDatosAparte` los vuelve a dejar donde el resto del
 * código los espera, en `asistente.valor_hora`, `asistente.causal_baja` y demás. Quien no tenga
 * el permiso recibe esos campos en `null`, que es lo mismo que recibía cuando el dato no estaba
 * cargado.
 */

/** Lo que hay que agregar al `select` para que la base traiga también los importes. */
export const CAMPOS_PAGO = 'remuneraciones_asistente(valor_hora, sueldo_basico, categoria_cct)';

/** Lo que hay que agregar al `select` para que la base traiga también lo reservado. */
export const CAMPOS_RESERVADOS = 'datos_reservados_asistente(causal_baja, score_riesgo_reclasificacion, indicadores_riesgo, motivo_exclusion_directo, motivo_exclusion_marketplace)';

/** Una tabla adjunta llega como objeto o como arreglo de un solo elemento, según la consulta. */
function primero(adjunto) {
  return (Array.isArray(adjunto) ? adjunto[0] : adjunto) ?? null;
}

/** Deja los datos de las tablas aparte al mismo nivel que el resto de la ficha. */
export function conDatosAparte(asistente) {
  if (!asistente) return asistente;
  const {
    remuneraciones_asistente: adjuntoPago,
    datos_reservados_asistente: adjuntoReservado,
    ...ficha
  } = asistente;
  const pago = primero(adjuntoPago);
  const reservado = primero(adjuntoReservado);
  return {
    ...ficha,
    valor_hora: pago?.valor_hora ?? null,
    sueldo_basico: pago?.sueldo_basico ?? null,
    categoria_cct: pago?.categoria_cct ?? null,
    causal_baja: reservado?.causal_baja ?? null,
    score_riesgo_reclasificacion: reservado?.score_riesgo_reclasificacion ?? null,
    indicadores_riesgo: reservado?.indicadores_riesgo ?? null,
    motivo_exclusion_directo: reservado?.motivo_exclusion_directo ?? null,
    motivo_exclusion_marketplace: reservado?.motivo_exclusion_marketplace ?? null,
  };
}
