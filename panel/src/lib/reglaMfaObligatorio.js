// ---------------------------------------------------------------------------
// reglaMfaObligatorio.js — quién tiene que entrar con segundo factor, decidido
// una sola vez
//
// POR QUÉ EXISTE
// La misma pregunta —"¿esta persona está obligada a entrar con segundo factor?"—
// la contestaban dos lugares por separado: el motor, cuando revisa cada pedido
// que entra, y el Panel, cuando decide si te manda a la pantalla del segundo
// factor. Dos respuestas para una sola pregunta, con la lista de roles escrita a
// mano en cada lado (regla 12 de CLAUDE.md §7).
//
// Y había algo peor que la repetición. Los dos leían la fila única de
// `configuracion_plataforma` y tiraban el error a la basura: si la lectura
// fallaba —o si la fila no existía, que es lo que pasaba en toda base armada
// desde cero, ver la migración
// `supabase/migrations/20260815202500_la_fila_de_configuracion_de_plataforma_siempre_existe.sql`—
// el resultado era "no hace falta segundo factor", en silencio y sin registro.
// Una protección que se apaga sola y no avisa es peor que no tenerla, porque
// nadie la va a extrañar.
//
// LA REGLA, EN UNA LÍNEA: si no se puede saber, se exige igual. Ante la duda se
// pide de más, nunca de menos, y queda anotado en la consola para que el
// problema de fondo se pueda encontrar (CLAUDE.md §6).
//
// ESTE ARCHIVO EXISTE DOS VECES
// El original es este. La copia vive en el motor, porque cada carpeta se publica
// por su cuenta y no puede importar código de la otra. La lista está en
// `scripts/copias_entre_apps.mjs`, `scripts/sincronizar_copias.mjs` la vuelve a
// copiar y `scripts/verificar_identidad.mjs` corta el build si se despegó.
// Nunca se edita la copia a mano.
// ---------------------------------------------------------------------------

/**
 * Los roles a los que les puede tocar el segundo factor.
 *
 * Hoy es uno solo: Superadmin, el rol técnico de CeltaTech, que es el que tiene la llave de
 * la infraestructura (CLAUDE.md §5). Los roles de una Prestadora no entran acá.
 */
export const ROLES_CON_SEGUNDO_FACTOR = ['superadmin'];

/** ¿A este rol le puede tocar el segundo factor? */
export function elRolUsaSegundoFactor(rol) {
  return ROLES_CON_SEGUNDO_FACTOR.includes(rol);
}

/**
 * ¿Está encendida la obligación de entrar con segundo factor?
 *
 * Recibe el resultado tal cual lo devuelve la consulta a `configuracion_plataforma`
 * (`{ data, error }`), no el valor ya desarmado: justamente porque lo que hay que mirar es el
 * error, que es lo que antes se tiraba.
 *
 * - Fila leída: manda lo que diga la fila. Encendido es encendido, apagado es apagado.
 * - Error, o ninguna fila: se exige el segundo factor igual, y queda registrado.
 */
export function elSegundoFactorEsObligatorio(lectura) {
  const fila = lectura?.data ?? null;
  const error = lectura?.error ?? null;

  if (error || !fila) {
    const motivo = error?.message ?? 'la consulta no devolvió ninguna fila';
    console.error(
      `No se pudo leer la configuración de la plataforma para saber si el segundo factor es obligatorio (${motivo}). ` +
        'Se exige de todos modos. Revisar que exista la fila única de configuracion_plataforma.'
    );
    return true;
  }

  return fila.mfa_admin_obligatorio === true;
}
