// ---------------------------------------------------------------------------
// reglaDeClave.js — el único lugar que decide qué clave se acepta
//
// El mínimo estaba escrito a mano en cuatro archivos —la ruta de activación del
// motor y las tres pantallas que fijan una clave—, y la plataforma tenía el suyo,
// más corto. La plataforma es la que manda de verdad: cualquier camino que no
// pase por esos cuatro archivos aceptaba una clave más corta. Ahora el número
// vive acá, las cuatro lo importan, y `scripts/verificar_regla_de_clave.mjs`
// corta la construcción si `supabase/config.toml` dejó de decir lo mismo.
//
// Se comprueba en el servidor aunque la pantalla ya lo haya comprobado: el
// control de la pantalla es una cortesía para quien escribe, no una defensa.
// ---------------------------------------------------------------------------

export const MINIMO_DE_CARACTERES = 8;

// Devuelve true sólo si la clave sirve. Ante cualquier cosa que no sea texto,
// falso: un control que compara contra un valor ausente deja pasar justo el
// caso que no entendió.
export function claveAceptable(clave) {
  if (typeof clave !== 'string') return false;
  return clave.length >= MINIMO_DE_CARACTERES;
}
