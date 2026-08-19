/**
 * Lo que cobra un Asistente vive en `remuneraciones_asistente`, no en su ficha.
 *
 * Está separado a propósito: las reglas de acceso de la base filtran filas, no columnas, así
 * que mientras los importes estaban dentro de `asistentes` cualquiera que podía ver la ficha
 * podía leerlos. En su propia tabla, la base exige el permiso `ver_pagos_asistente` antes de
 * contestar.
 *
 * Para las pantallas eso es un detalle de dónde está guardado el dato, no una forma nueva de
 * leerlo: se pide junto con la ficha y estas dos funciones lo vuelven a dejar donde el resto
 * del código lo espera, en `asistente.valor_hora` y `asistente.sueldo_basico`. Quien no tenga
 * el permiso recibe los tres campos en `null`, que es lo mismo que recibía cuando el dato no
 * estaba cargado.
 */

/** Lo que hay que agregar al `select` para que la base traiga también los importes. */
export const CAMPOS_REMUNERACION = 'remuneraciones_asistente(valor_hora, sueldo_basico, categoria_cct)';

/** Deja los importes al mismo nivel que el resto de la ficha. */
export function conRemuneracion(asistente) {
  if (!asistente) return asistente;
  const { remuneraciones_asistente: adjunto, ...ficha } = asistente;
  const pago = Array.isArray(adjunto) ? adjunto[0] : adjunto;
  return {
    ...ficha,
    valor_hora: pago?.valor_hora ?? null,
    sueldo_basico: pago?.sueldo_basico ?? null,
    categoria_cct: pago?.categoria_cct ?? null,
  };
}
