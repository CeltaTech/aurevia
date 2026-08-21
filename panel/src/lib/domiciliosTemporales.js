// El único lugar que traduce un rechazo de la base sobre domicilios temporales a un motivo
// que la pantalla pueda explicar (regla 12 de CLAUDE.md §7).
//
// La base tiene dos restricciones que frenan una carga mal hecha, y las dos suben un error
// escrito para quien programa: `conflicting key value violates exclusion constraint
// "domicilios_temp_sin_superposicion"`. Eso no puede llegar a la pantalla (regla 1: un
// mensaje de error también es texto visible).
//
// Cómo encaja con `lib/errores.js`: ese archivo ya sabe mostrar un **motivo** —un código con
// el que se dice exactamente qué pasó— y busca su frase en las traducciones, en los tres
// idiomas. Acá solamente se reconoce cuál de las dos restricciones se rompió y se le cuelga
// al error el motivo que le corresponde; el resto lo hace `mensajeDeError` como con
// cualquier otro error del sistema.

// Qué restricción de la base corresponde a qué motivo. Las claves son los nombres reales de
// las restricciones, tal como los creó la migración; el nombre viaja adentro del texto del
// error, que es la única forma de distinguir una restricción de otra.
export const MOTIVO_POR_RESTRICCION = {
  domicilios_temp_sin_superposicion: 'domicilio_temporal_pisado',
  domicilios_temp_fechas_coherentes: 'domicilio_temporal_fechas_al_reves',
};

/**
 * Devuelve el mismo error con su `motivo` puesto, cuando lo que lo causó fue una de las dos
 * restricciones de la base. Si no reconoce ninguna, devuelve el error tal cual: de ahí en
 * más lo explica `mensajeDeError` con una de sus ocho situaciones genéricas.
 *
 * @param error lo que devolvió Supabase en `.error`.
 */
export function conMotivoDeDomicilioTemporal(error) {
  if (!error || typeof error !== 'object') return error;

  const texto = [error.message, error.details, error.hint, error.constraint]
    .filter(Boolean)
    .join(' ');

  for (const [restriccion, motivo] of Object.entries(MOTIVO_POR_RESTRICCION)) {
    if (texto.includes(restriccion)) {
      return {
        code: error.code,
        status: error.status,
        message: error.message,
        details: error.details,
        motivo,
      };
    }
  }

  return error;
}
