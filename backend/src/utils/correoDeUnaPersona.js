import { supabase } from '../db/connection.js';

// EL CORREO DE UNA PERSONA NO ESTÁ EN `usuarios`.
// ============================================================================
//
// La ficha de `usuarios` tiene el nombre, el rol, el teléfono y la Prestadora. El correo no: vive
// en la tabla de cuentas, del lado de la autenticación, y se pide por ahí.
//
// POR QUÉ ESTE ARCHIVO EXISTE. Porque eso no se ve, y pedirle `email` a `usuarios` no falla de
// manera ruidosa: la consulta vuelve con un error de columna desconocida, el código lo lee como
// «esa persona no está» y el aviso no sale, en silencio. Así estuvo el aviso al Coordinador de
// respaldo hasta el 2026-09-17: la escalada no llegaba nunca y nada lo decía.
//
// SIN CORREO, EL AVISO NO SALE PARA ESA PERSONA, pero el proceso sigue: los demás tienen que
// enterarse igual.

/** El correo de una persona, o nulo si no tiene cuenta o la cuenta no tiene correo. */
export async function correoDe(usuarioId) {
  if (!usuarioId) return null;
  const { data, error } = await supabase.auth.admin.getUserById(usuarioId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

/**
 * Los correos de varias personas, sin repetidos y sin los que no tienen.
 *
 * Se piden de a uno porque la tabla de cuentas no deja pedir por lista. El orden de la lista que
 * entra se conserva.
 */
export async function correosDe(usuarioIds) {
  const correos = [];
  for (const id of usuarioIds ?? []) {
    const correo = await correoDe(id);
    if (correo) correos.push(correo);
  }
  return [...new Set(correos)];
}
