import crypto from 'node:crypto';
import { supabase } from '../db/connection.js';

// QUÉ ES UN EQUIPO NUEVO. Un aparato que no tiene llave guardada y desde el que nunca se entró.
// Nada más que eso: no se reconoce el navegador, no se mira desde dónde se conecta y no se guarda
// ningún dato del aparato. Lo único que hay es una marca al azar que emite el motor, que el
// navegador conserva, y de la que acá queda la huella.
//
// POR QUÉ NO ALCANZA `llaves_de_dispositivo`. Ésa es la llave de huella o cara de las dos
// aplicaciones de teléfono, y el Panel no la tiene. Además prueba quién es; ésta sólo contesta si
// desde este aparato ya se entró antes.
//
// LA MARCA NO ES UNA CREDENCIAL. Sola no deja entrar a nadie: se mira **después** de que la sesión
// ya está hecha, y lo único que decide es si hace falta pedir el segundo factor. Robarla no abre
// ninguna puerta; lo más que consigue es ahorrarse un código teniendo además la clave.

export function marcaNueva() {
  return crypto.randomBytes(32).toString('base64url');
}

export function huellaDeLaMarca(marca) {
  const texto = String(marca ?? '').trim();
  if (!texto) return null;
  return crypto.createHash('sha256').update(texto).digest('hex');
}

/** La fila de este aparato, si existe y no está revocada. Falla cerrado: ante cualquier duda, null. */
export async function equipoConocido({ usuarioId, marca }) {
  const huella = huellaDeLaMarca(marca);
  if (!usuarioId || !huella) return null;

  const { data, error } = await supabase
    .from('equipos_conocidos')
    .select('id, usuario_id, revocado_en')
    .eq('usuario_id', usuarioId)
    .eq('marca_huella', huella)
    .is('revocado_en', null)
    .maybeSingle();

  if (error) {
    console.error('equiposConocidos: no se pudo resolver el equipo:', error.message);
    return null;
  }
  return data ?? null;
}

/**
 * Deja anotado que desde este aparato se entró, y devuelve la marca que el navegador tiene que
 * guardar. Si no venía ninguna —el caso corriente de la primera vez— se emite una.
 */
export async function anotarEquipo({ usuario, marca = null }) {
  if (!usuario?.id || !usuario?.prestadora_id) return null;

  const laMarca = String(marca ?? '').trim() || marcaNueva();
  const huella = huellaDeLaMarca(laMarca);
  const ahora = new Date().toISOString();

  const { error } = await supabase
    .from('equipos_conocidos')
    .upsert(
      {
        prestadora_id: usuario.prestadora_id,
        usuario_id: usuario.id,
        marca_huella: huella,
        ultima_entrada_en: ahora,
        revocado_en: null,
      },
      { onConflict: 'usuario_id,marca_huella' },
    );

  if (error) {
    console.error('equiposConocidos: no se pudo anotar el equipo:', error.message);
    return null;
  }
  return laMarca;
}

/**
 * Cierra la sesión en todos los aparatos: se revocan las marcas, se revocan las llaves de las dos
 * aplicaciones de teléfono y se cierran las sesiones abiertas del servicio de acceso.
 *
 * ES LO PRIMERO QUE NECESITA ALGUIEN A QUIEN LE ROBARON EL TELÉFONO, y hasta acá no existía.
 * Cambiar la clave no alcanzaba: las sesiones ya abiertas seguían vivas.
 */
export async function cerrarSesionEnTodosLosEquipos(usuarioId) {
  if (!usuarioId) return;

  const ahora = new Date().toISOString();

  await supabase
    .from('equipos_conocidos')
    .update({ revocado_en: ahora })
    .eq('usuario_id', usuarioId)
    .is('revocado_en', null);

  // Las llaves de las dos aplicaciones de teléfono. Se borran y no se marcan: la tabla no lleva
  // columna de revocación, y una llave que no está es una llave que no sirve.
  const { error: errorLlaves } = await supabase
    .from('llaves_de_dispositivo')
    .delete()
    .eq('usuario_id', usuarioId);
  if (errorLlaves) console.error('equiposConocidos: no se pudieron revocar las llaves:', errorLlaves.message);

  // Y las sesiones que ya estaban abiertas. Sin esto lo anterior no sirve: quien tiene el aparato
  // en la mano sigue adentro hasta que su pase venza solo.
  const { error } = await supabase.auth.admin.signOut(usuarioId, 'global');
  if (error) console.error('equiposConocidos: no se pudieron cerrar las sesiones:', error.message);
}

/** Los aparatos desde los que esta persona entró, para que pueda verlos antes de cerrarlos todos. */
export async function equiposDe(usuarioId) {
  if (!usuarioId) return [];

  const { data, error } = await supabase
    .from('equipos_conocidos')
    .select('id, primera_entrada_en, ultima_entrada_en')
    .eq('usuario_id', usuarioId)
    .is('revocado_en', null)
    .order('ultima_entrada_en', { ascending: false });

  if (error) {
    console.error('equiposConocidos: no se pudieron listar los equipos:', error.message);
    return [];
  }
  return data ?? [];
}
