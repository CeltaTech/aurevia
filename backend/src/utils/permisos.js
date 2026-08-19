import { supabase } from '../db/connection.js';

// Quién, además de un administrador, puede hacer cada una de las acciones que la Prestadora
// puede reservar.
//
// ACÁ NO SE DECIDE NADA. La decisión está programada una sola vez y está en la base, en la
// función `tiene_permiso_de`; este archivo solamente la consulta. Antes no era así: el motor
// tenía su propia copia de la lista de acciones reservadas, la pantalla de configuración
// tenía otra, y la base una tercera — las tres decían cosas distintas, y la pantalla llegaba
// a mostrarle a la Prestadora un estado que el motor no aplicaba (pendiente #127).
//
// Por qué la lista vive en la base y no en un archivo de este proyecto, como sí pasa con
// `catalogoVisibilidad.js` y `catalogoAvisos.js`: porque esta decisión no la consulta
// solamente el motor. La consultan también las reglas de acceso de la propia base, que están
// escritas en SQL y no pueden leer un archivo de JavaScript. Cuando los dos lados que
// comparten una decisión no pueden compartir código, el punto único de verdad es una función
// de la base — es lo que manda la regla 12 del §7 de CLAUDE.md para este caso exacto.

// El catálogo cambia con una migración, o sea junto con una versión nueva del motor, así que
// alcanza con leerlo una vez por arranque.
let catalogoEnMemoria = null;

export async function accionesDePermisos() {
  if (catalogoEnMemoria) return catalogoEnMemoria;
  const { data, error } = await supabase
    .from('catalogo_acciones_permisos')
    .select('accion, default_solo_admin')
    .order('orden');
  if (error) throw error;
  catalogoEnMemoria = data || [];
  return catalogoEnMemoria;
}

export async function tienePermiso({ accion, usuarioId }) {
  const { data, error } = await supabase.rpc('tiene_permiso_de', {
    p_usuario: usuarioId ?? null,
    p_accion: accion,
  });
  // Ante la duda, no. Un permiso que no se pudo comprobar no es un permiso otorgado.
  if (error) return false;
  return data === true;
}

// Las respuestas de todas las acciones de una sola vez, para cuando el Panel necesita saber
// qué botones mostrar. Una consulta en vez de una por acción.
export async function permisosEfectivos(usuarioId) {
  const { data, error } = await supabase.rpc('permisos_efectivos_de', { p_usuario: usuarioId ?? null });
  if (error) throw error;
  return data || {};
}
