import { supabase } from '../db/connection.js';

// EL CORREO DE UNA PERSONA ESTÁ EN `usuarios`, Y NO DEL LADO DEL ACCESO.
// ============================================================================
//
// Del lado del acceso lo que queda escrito no es el correo: es un resumen del correo junto con la
// Prestadora, porque la misma persona tiene una cuenta por cada Prestadora donde trabaja y el
// servicio de acceso exige que no se repita ninguno (ver `config/correoDeAcceso.js`). Pedirle el
// correo a ese lado devuelve una dirección que no existe y a la que no llega nadie.
//
// POR QUÉ ESTE ARCHIVO EXISTE. Porque eso no se ve. Un aviso mandado a la dirección equivocada no
// falla: se manda, y no llega. Con el correo en un solo lugar, ninguna parte del motor tiene que
// acordarse de cuál de los dos lados preguntar.
//
// SIN CORREO, EL AVISO NO SALE PARA ESA PERSONA, pero el proceso sigue: los demás tienen que
// enterarse igual.

/** El correo de una persona, o nulo si no tiene cuenta o la cuenta no tiene correo. */
export async function correoDe(usuarioId) {
  if (!usuarioId) return null;
  const { data, error } = await supabase
    .from('usuarios')
    .select('email')
    .eq('id', usuarioId)
    .maybeSingle();
  if (error || !data?.email) return null;
  return data.email;
}

/**
 * Los correos de varias personas, sin repetidos y sin los que no tienen.
 *
 * El orden de la lista que entra se conserva.
 */
export async function correosDe(usuarioIds) {
  const ids = (usuarioIds ?? []).filter(Boolean);
  if (ids.length === 0) return [];

  const { data, error } = await supabase.from('usuarios').select('id, email').in('id', ids);
  if (error) return [];

  const porId = new Map((data ?? []).map((fila) => [fila.id, fila.email]));
  const correos = ids.map((id) => porId.get(id)).filter(Boolean);
  return [...new Set(correos)];
}
