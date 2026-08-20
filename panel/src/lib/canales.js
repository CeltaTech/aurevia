// ---------------------------------------------------------------------------
// canales.js — en qué canal trabaja cada Asistente, decidido una sola vez
//
// QUÉ ES UN CANAL
// La forma en que el Asistente recibe el trabajo, y son dos cosas distintas:
//   * `directa`      — la Prestadora le dirige el trabajo y le asigna las guardias.
//   * `marketplace`  — el Asistente elige qué toma y mantiene su independencia
//                      operativa (CLAUDE.md §3).
// No es un detalle administrativo: es la línea que separa dos regímenes de
// trabajo. Ofrecerle una guardia de marketplace a alguien contratado en directa
// —o al revés— es cruzar esa línea.
//
// Nunca existe un tercer canal para una persona. La subcontratación es trabajo de
// otra empresa, y su gente no está en nuestra base ni la contratamos nosotros
// (decisión del Desarrollador, 2026-08-19).
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
// ---------------------------------------------------------------------------

/** Los dos canales en que puede trabajar una persona. */
export const CANAL = {
  DIRECTA: 'directa',
  MARKETPLACE: 'marketplace',
};

export const CANALES = [CANAL.DIRECTA, CANAL.MARKETPLACE];

const lista = (x) => (Array.isArray(x) ? x : []);

/**
 * Los canales que la Prestadora puede darle a un Asistente, a partir de las
 * modalidades que tenga activas.
 *
 * Si no tiene ninguna —una Prestadora recién creada, antes de configurarse— vale
 * la directa, que es el modo de trabajo con el que arranca cualquiera. Es la misma
 * cuenta que hace `canales_habilitados_de_prestadora` en la base: si un día cambia,
 * cambia en los dos lados.
 */
export function canalesHabilitados(modalidades) {
  const habilitados = CANALES.filter((c) => lista(modalidades).includes(c));
  return habilitados.length ? habilitados : [CANAL.DIRECTA];
}

/** Si este Asistente trabaja en ese canal. */
export function trabajaEnCanal(asistente, canal) {
  if (!canal) return true; // sin canal no hay nada que cruzar
  return lista(asistente?.canales).includes(canal);
}

/**
 * Traduce el rechazo de la base a un motivo, o `null` si el error es otra cosa.
 *
 * Los disparadores levantan un mensaje con esta forma exacta:
 *
 *     canal_bloquea:marketplace:
 *     canal_no_habilitado:marketplace:
 *
 * Ese texto no puede llegar nunca a la pantalla: no está traducido y para quien lo
 * lee es un error de sistema, no una explicación. Acá se lo abre y la pantalla arma
 * la frase. Mismo criterio que `lib/matricula.js`, que resuelve lo suyo igual.
 *
 * @returns `{ motivo: 'bloquea' | 'no_habilitado', canal: 'directa' }` o `null`.
 */
export function motivoDeCanalDelError(error) {
  const texto =
    typeof error === 'string' ? error : (error?.message ?? error?.error_description ?? '');
  if (!texto) return null;

  const encontrado = /canal_(bloquea|no_habilitado):([a-z_]+)/.exec(texto);
  if (!encontrado) return null;

  const [, motivo, canal] = encontrado;
  return CANALES.includes(canal) ? { motivo, canal } : null;
}

/**
 * La frase que se le muestra a la persona cuando la base frenó la operación por el
 * canal, o `null` si el error no era de canal y la pantalla lo trata como siempre.
 *
 * Está acá y no en cada pantalla porque son varias las que pueden chocarse con la
 * misma pared —cubrir una vacante, invitar, reasignar, editar la ficha— y el texto
 * tiene que ser el mismo en todas (regla 12 de CLAUDE.md §7).
 *
 * @param error  lo que devolvió la base.
 * @param tc     el bloque de textos ya traducido: `t.canales`.
 */
export function mensajeDeCanal(error, tc) {
  const encontrado = motivoDeCanalDelError(error);
  if (!encontrado || !tc) return null;

  const nombre = tc[encontrado.canal] ?? encontrado.canal;
  const plantilla =
    encontrado.motivo === 'no_habilitado' ? tc.error_no_habilitado : tc.error_bloquea;
  return String(plantilla ?? '').replace('{canal}', nombre);
}
