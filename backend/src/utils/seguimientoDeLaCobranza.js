// ---------------------------------------------------------------------------
// seguimientoDeLaCobranza.js — quién lleva la cobranza de esta Prestadora
//
// POR QUÉ EXISTE ESTE ARCHIVO. La misma pregunta —¿el seguimiento de la cobranza lo lleva este
// sistema o lo lleva otro software?— se hace antes de entregar cualquier número calculado, y se
// hacía en un solo lugar: las rutas del Panel. La ventanilla de la Familia mostraba la resta de
// este lado sin preguntar nada, así que con un software de cobranzas conectado había dos números
// distintos para la misma pregunta, y el segundo lo veía justamente quien paga. La pregunta pasa
// a vivir acá, una sola vez, y la hacen las dos ventanillas.
//
// QUÉ DEVUELVE CUANDO LA LLEVA OTRO. Nada. Careonys deja de calcular, y lo que corresponde es no
// tener el dato: un cero, un guion o una resta hecha con lo poco que haya anotado de este lado se
// leen como si fueran ciertos. La ausencia del dato es la respuesta.
//
// FALLA CERRADO. Un error de la base sube como error y la ruta lo contesta como cualquier otro:
// no se decide «entonces lo lleva este sistema», porque esa suposición es la que termina
// entregando el número que no había que entregar.
// ---------------------------------------------------------------------------

import { supabase } from '../db/connection.js';
import { sigueLaCobranza } from './facturacionDeFamilias.js';

/**
 * Si el seguimiento de la cobranza de esta Prestadora lo lleva otro software.
 *
 * Sin nada configurado devuelve `false`: lo que se viene haciendo es seguirla acá, y apagarlo es
 * una decisión que se toma.
 */
export async function laCobranzaLaLlevaOtroSoftware(prestadoraId) {
  const { data, error } = await supabase
    .from('configuracion_facturacion_familias')
    .select('regla')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return !sigueLaCobranza(data?.regla);
}

/**
 * Las columnas de `saldos_familia` que son una cuenta hecha acá.
 *
 * `monto_total` y `monto_facturado` no están en la lista a propósito: son lo que se mandó a
 * facturar y lo que el software de facturación informó haber emitido, o sea datos guardados, no
 * una resta de este lado.
 */
export const LO_QUE_SE_CALCULA_ACA = ['cobrado', 'saldo', 'estado', 'monto_a_cobrar', 'correcciones_neto'];

/**
 * La misma fila, sin los números que este sistema calcula.
 *
 * Se quitan, no se ponen en cero ni en `null`: un cero dice que no debe nada, y eso es una
 * afirmación que acá ya no se puede hacer.
 */
export function sinLoQueSeCalculaAca(fila) {
  if (!fila) return fila;
  const limpia = { ...fila };
  for (const columna of LO_QUE_SE_CALCULA_ACA) delete limpia[columna];
  return limpia;
}
