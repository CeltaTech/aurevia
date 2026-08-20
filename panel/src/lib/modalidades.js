// ---------------------------------------------------------------------------
// modalidades.js — en qué modalidad de trabajo está cada Asistente, decidido
// una sola vez
//
// QUÉ ES UNA MODALIDAD DE TRABAJO
// Cómo el Asistente recibe el trabajo, y son dos cosas distintas:
//   * `directa`      — la Prestadora le dirige el trabajo y le asigna las guardias.
//   * `marketplace`  — el Asistente elige qué toma y mantiene su independencia
//                      operativa (CLAUDE.md §3).
// No es un detalle administrativo: es la línea que separa dos regímenes de
// trabajo. Ofrecerle una guardia de marketplace a alguien contratado en directa
// —o al revés— es cruzar esa línea.
//
// Es la misma palabra que ya usa la Prestadora para decir cómo trabaja ella
// (glosario, §4: *"la tercera modalidad de trabajo de una Prestadora, junto con
// prestación directa y marketplace"*). Una cosa, un nombre. **No se dice "canal"**:
// en este producto un canal es por dónde sale un aviso —WhatsApp, correo,
// notificación— y usar la misma palabra para las dos cosas obliga a adivinar cuál
// de las dos se está nombrando.
//
// Nunca existe una tercera modalidad para una persona. La subcontratación es
// trabajo de otra empresa, y su gente no está en nuestra base ni la contratamos
// nosotros (decisión del Desarrollador, 2026-08-19).
//
// QUIÉN DECIDE
// Las dos partes, una arriba de la otra:
//   * la Prestadora pone el techo con las modalidades que tenga activas;
//   * dentro de ese techo, la ficha de cada Asistente.
//
// DÓNDE SE HACE CUMPLIR
// En la base, que es la única que no se puede saltear: frena la asignación, la
// serie y la invitación. Este archivo es la misma regla del lado de la pantalla,
// para que el motivo se vea **antes** de chocarse con la pared, y para traducir el
// rechazo de la base a una frase que se pueda leer.
//
// LA COLUMNA SE SIGUE LLAMANDO `canales`
// Es un nombre guardado, y un nombre guardado no se renombra (regla 13). Se lee
// acá, en un solo lugar, y de este archivo para afuera la cosa se llama modalidad.
// ---------------------------------------------------------------------------

/** Las dos modalidades en que puede trabajar una persona. */
export const MODALIDAD = {
  DIRECTA: 'directa',
  MARKETPLACE: 'marketplace',
};

export const MODALIDADES_DE_ASISTENTE = [MODALIDAD.DIRECTA, MODALIDAD.MARKETPLACE];

const lista = (x) => (Array.isArray(x) ? x : []);

/** En qué modalidades trabaja este Asistente. Único lugar que toca la columna vieja. */
export function modalidadesDelAsistente(asistente) {
  return lista(asistente?.canales);
}

/**
 * Las modalidades que la Prestadora puede darle a un Asistente, a partir de las
 * que tenga activas.
 *
 * Si no tiene ninguna —una Prestadora recién creada, antes de configurarse— vale
 * la directa, que es el modo de trabajo con el que arranca cualquiera. Es la misma
 * cuenta que hace `modalidades_habilitadas_de_prestadora` en la base: si un día
 * cambia, cambia en los dos lados.
 */
export function modalidadesHabilitadas(modalidades) {
  const habilitadas = MODALIDADES_DE_ASISTENTE.filter((m) => lista(modalidades).includes(m));
  return habilitadas.length ? habilitadas : [MODALIDAD.DIRECTA];
}

/** Si este Asistente trabaja en esa modalidad. */
export function trabajaEnModalidad(asistente, modalidad) {
  if (!modalidad) return true; // sin modalidad no hay nada que cruzar
  return modalidadesDelAsistente(asistente).includes(modalidad);
}

/**
 * Traduce el rechazo de la base a un motivo, o `null` si el error es otra cosa.
 *
 * Los disparadores levantan un mensaje con esta forma exacta:
 *
 *     modalidad_bloquea:marketplace:
 *     modalidad_no_habilitada:marketplace:
 *
 * Ese texto no puede llegar nunca a la pantalla: no está traducido y para quien lo
 * lee es un error de sistema, no una explicación. Acá se lo abre y la pantalla arma
 * la frase. Mismo criterio que `lib/matricula.js`, que resuelve lo suyo igual.
 *
 * @returns `{ motivo: 'bloquea' | 'no_habilitada', modalidad: 'directa' }` o `null`.
 */
export function motivoDeModalidadDelError(error) {
  const texto =
    typeof error === 'string' ? error : (error?.message ?? error?.error_description ?? '');
  if (!texto) return null;

  const encontrado = /modalidad_(bloquea|no_habilitada):([a-z_]+)/.exec(texto);
  if (!encontrado) return null;

  const [, motivo, modalidad] = encontrado;
  return MODALIDADES_DE_ASISTENTE.includes(modalidad) ? { motivo, modalidad } : null;
}

/**
 * La frase que se le muestra a la persona cuando la base frenó la operación por la
 * modalidad, o `null` si el error era otra cosa y la pantalla lo trata como siempre.
 *
 * Está acá y no en cada pantalla porque son varias las que pueden chocarse con la
 * misma pared —cubrir una vacante, invitar, reasignar, editar la ficha— y el texto
 * tiene que ser el mismo en todas (regla 12 de CLAUDE.md §7).
 *
 * @param error  lo que devolvió la base.
 * @param tm     el bloque de textos ya traducido: `t.modalidades`.
 */
export function mensajeDeModalidad(error, tm) {
  const encontrado = motivoDeModalidadDelError(error);
  if (!encontrado || !tm) return null;

  const nombre = tm[encontrado.modalidad] ?? encontrado.modalidad;
  const plantilla =
    encontrado.motivo === 'no_habilitada' ? tm.error_no_habilitada : tm.error_bloquea;
  return String(plantilla ?? '').replace('{modalidad}', nombre);
}
