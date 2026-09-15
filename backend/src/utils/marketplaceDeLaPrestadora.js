// ---------------------------------------------------------------------------
// marketplaceDeLaPrestadora.js — dos preguntas que se hacen desde varios lados y
// que tienen que contestarse igual siempre.
//
//   1. ¿Esta Prestadora ofrece la modalidad marketplace?
//   2. ¿Tiene encendida una de las cinco funciones de riesgo legal?
//
// La primera la hace el perfil —para saber si dibujar la vidriera en el menú— y
// la hace cada ruta de la vidriera, que es donde está el candado de verdad. Si
// cada una consultara por su cuenta, alcanzaría con que una se olvidara del
// filtro `activa` para que una Prestadora que apagó la modalidad siguiera
// mostrando su gente.
//
// La segunda decide el orden de la lista, y no se responde con una lista escrita
// en el código: sale de `configuracion_funciones_marketplace`, donde **sin fila
// guardada la función está apagada** — una Prestadora recién creada no necesita
// que nadie le siembre cinco filas para estar en el estado en el que ya está.
// ---------------------------------------------------------------------------

import { supabase } from '../db/connection.js';
import { MODALIDAD, modalidadesHabilitadas } from './modalidades.js';

/** Las modalidades activas de una Prestadora. Sin ninguna configurada vale la directa. */
export async function modalidadesDeLaPrestadora(prestadoraId) {
  if (!prestadoraId) return modalidadesHabilitadas([]);
  const { data } = await supabase
    .from('prestadora_modalidades')
    .select('modalidad')
    .eq('prestadora_id', prestadoraId)
    .eq('activa', true);
  return modalidadesHabilitadas((data || []).map((f) => f.modalidad));
}

/** Si esta Prestadora ofrece marketplace. Es la puerta de toda la vidriera. */
export async function ofreceMarketplace(prestadoraId) {
  const modalidades = await modalidadesDeLaPrestadora(prestadoraId);
  return modalidades.includes(MODALIDAD.MARKETPLACE);
}

/**
 * Si una de las cinco funciones de riesgo está encendida.
 *
 * Falla cerrado a propósito: si la consulta no contesta, la función se da por apagada. Con una
 * función de riesgo legal, el error de leer de menos es que la lista salga mezclada; el de leer
 * de más es que la Prestadora use una función que nunca encendió y sin el aviso que le
 * corresponde.
 */
export async function funcionDeRiesgoEncendida(prestadoraId, clave) {
  if (!prestadoraId || !clave) return false;
  const { data, error } = await supabase
    .from('configuracion_funciones_marketplace')
    .select('activa')
    .eq('prestadora_id', prestadoraId)
    .eq('funcion_clave', clave)
    .maybeSingle();
  if (error) return false;
  return Boolean(data?.activa);
}
