// Punto único de verdad de LA MATRÍCULA, del lado de las pantallas (regla 12 de CLAUDE.md §7).
// ============================================================================
//
// La pregunta que contesta. ¿Este Asistente puede atender un día determinado, o hay algo con
// su Matrícula que se lo impide? Y si se lo impide, ¿qué exactamente?
//
// ----------------------------------------------------------------------------
// La regla vive en la base. Acá se la anticipa, no se la decide
// ----------------------------------------------------------------------------
//
// Quien decide de verdad es la base de datos: tiene disparadores que rechazan la operación en
// las cuatro puertas por donde un Asistente puede terminar atendiendo (que se lo asignen a una
// guardia, que lo inviten a cubrir un hueco, que él acepte esa invitación, y que aparezca en
// la lista de candidatos). Esos disparadores son la pared; nadie los esquiva, ni desde el
// Panel, ni desde las aplicaciones de Familias y Asistentes, ni escribiendo directo en la base.
//
// Entonces, ¿para qué existe este archivo? Para que la pared no aparezca de golpe. Sin él, la
// pantalla mostraría a la persona como disponible, alguien la elegiría, apretaría Asignar, y
// recién ahí se enteraría de que no se puede. Este archivo hace la misma cuenta **antes**, para
// que el motivo esté a la vista desde el principio.
//
// Que la misma cuenta esté escrita dos veces —una en SQL y otra acá— es exactamente lo que la
// regla 12 prohíbe, y no hay forma de evitarlo: un disparador de Postgres no puede llamar a una
// función de JavaScript. Lo que sí se puede es que la copia de acá sea **fiel** y que se sepa
// cuál manda. Por eso:
//
//   · el orden de los tres motivos es el mismo, y en el mismo orden;
//   · los datos que hacen falta para decidir (si el tipo de Asistente exige Matrícula, cuál, y
//     si la Prestadora es estricta o flexible) no se calculan acá: se leen de la vista
//     `estado_matricula_asistente`, que los devuelve ya resueltos por la misma base;
//   · si alguna vez las dos versiones dijeran cosas distintas, **gana la base**, y este archivo
//     está mal. Por eso `motivoDelError()` existe: traduce el rechazo de la base para que,
//     aunque la pantalla se haya equivocado, la persona vea el motivo verdadero y no un texto
//     de sistema en inglés.
//
// Lo único que este archivo hace y la vista no puede hacer: mirar **un día futuro**. La vista
// contesta "¿puede trabajar hoy?"; una guardia puede ser dentro de tres semanas, y una
// Matrícula que hoy está viva puede estar vencida ese día. Esa cuenta se hace acá, con las
// Matrículas que la pantalla ya tiene cargadas.
//
// Este archivo no arma texto ni sabe en qué idioma está el Panel: devuelve claves de
// traducción, y la pantalla arma la frase (regla 2 de CLAUDE.md §7).
//
// Lo que acá NO está. Cuánto falta para que algo venza y si eso ya es para avisar no se decide
// acá: es la misma pregunta que se hacen los papeles del Asistente, así que vive una sola vez en
// `lib/reglaVencimientos.js`. Este archivo la usa, no la repite.

import { diaISO } from './reglaVencimientos';

/**
 * Los tres motivos por los que la Matrícula puede frenar a un Asistente.
 *
 * Son las mismas tres palabras que devuelve la función `motivo_bloqueo_matricula` de la base y
 * las mismas que viajan dentro del mensaje de error de los disparadores. No se traducen acá:
 * son el código interno. El texto que se muestra sale de `t.matricula.bloqueo[motivo]`.
 */
export const BLOQUEO = {
  /** El tipo de Asistente exige Matrícula y no hay ninguna cargada. */
  SIN_MATRICULA: 'sin_matricula',
  /** Hay Matrícula, pero no está vigente el día que se mira. */
  VENCIDA: 'vencida',
  /**
   * Está vigente, pero nadie de la Prestadora la comprobó todavía. Frena en dos casos: cuando
   * la Prestadora es estricta, y siempre que la haya subido el propio Asistente.
   */
  SIN_VERIFICAR: 'sin_verificar',
};

/** Los tres motivos, en una lista, para recorrerlos sin escribirlos a mano otra vez. */
export const MOTIVOS_DE_BLOQUEO = [
  BLOQUEO.SIN_MATRICULA,
  BLOQUEO.VENCIDA,
  BLOQUEO.SIN_VERIFICAR,
];

const lista = (x) => (Array.isArray(x) ? x : []);

/**
 * La Matrícula que manda para un Asistente en un día dado, o `null` si ninguna está vigente.
 *
 * "La que manda" cuando hay varias: primero la que no vence —una Matrícula sin fecha de fin no
 * caduca, así que gana siempre—, y entre las que vencen, la que vence más tarde. Es el mismo
 * criterio de desempate que usa la base, escrito igual a propósito.
 *
 * @param tipo  si se pasa, solo cuentan las Matrículas de ese tipo (el que exige el tipo de
 *              Asistente: 'enfermeria', 'kinesiologia', ...). Si no se pasa, cuentan todas.
 */
export function matriculaQueMandaAl(asistenteId, matriculas, momento, tipo = null) {
  const dia = diaISO(momento);
  if (!asistenteId || !dia) return null;

  const vigentes = lista(matriculas).filter(
    (m) =>
      m.asistente_id === asistenteId &&
      (tipo === null || tipo === undefined || m.tipo === tipo) &&
      (!m.vigente_desde || m.vigente_desde <= dia) &&
      (!m.vigente_hasta || m.vigente_hasta >= dia)
  );
  if (!vigentes.length) return null;

  return vigentes.reduce((mejor, m) => {
    if (!mejor.vigente_hasta) return mejor;
    if (!m.vigente_hasta) return m;
    return m.vigente_hasta > mejor.vigente_hasta ? m : mejor;
  });
}

/**
 * ¿Hay algo con la Matrícula que impida a este Asistente atender ese día?
 *
 * Devuelve `null` si puede atender, o uno de los tres valores de `BLOQUEO`.
 *
 * Es la copia fiel de la función `motivo_bloqueo_matricula` de la base. Los tres motivos se
 * miran en este orden y por esta razón: no tener nada cargado, tenerlo vencido y tenerlo sin
 * comprobar son tres problemas distintos que se resuelven de tres maneras distintas, y un solo
 * "no puede" no le diría a nadie qué hacer al respecto.
 *
 * **Nunca bloquea por falta de datos.** Si el Asistente no tiene tipo cargado, o su tipo no
 * exige Matrícula, o la pantalla todavía no trajo su fila de la vista, la respuesta es `null`.
 * Bloquear por una suposición es peor que no bloquear: dejaría a un Paciente sin nadie por un
 * dato que ni siquiera estaba cargado. Es el mismo criterio que la base ya aplica.
 *
 * @param asistenteId  a quién se mira.
 * @param estado       su fila de la vista `estado_matricula_asistente`
 *                     (`requiere_matricula`, `tipo_matricula`, `modo_control_matricula`).
 * @param matriculas   filas de `matriculas_asistente` que la pantalla ya cargó.
 * @param dia          el día que se mira. Para una guardia es el día en que **termina**, no el
 *                     que empieza: la de noche arranca a las 22:00 y termina a las 06:00 del
 *                     día siguiente, y lo que importa es que la Matrícula llegue hasta el final.
 */
export function motivoDeBloqueo(asistenteId, estado, matriculas, dia) {
  if (!asistenteId) return null;
  if (!estado || estado.requiere_matricula !== true) return null;

  const tipo = estado.tipo_matricula ?? null;
  const propias = lista(matriculas).filter(
    (m) => m.asistente_id === asistenteId && (tipo === null || m.tipo === tipo)
  );
  if (!propias.length) return BLOQUEO.SIN_MATRICULA;

  const vigente = matriculaQueMandaAl(asistenteId, propias, dia, tipo);
  if (!vigente) return BLOQUEO.VENCIDA;

  // La verificación se exige en dos casos, no en uno. El obvio: la Prestadora es estricta. El
  // otro: la Matrícula la subió el propio Asistente desde su aplicación. En modo flexible
  // alcanza con que esté cargada y vigente, así que sin esta segunda condición cualquiera
  // podría escribir un número inventado y quedar habilitado solo. El permiso de trabajar con
  // papeles a medias es de la Prestadora sobre su propia carga administrativa, no del
  // interesado sobre su propia Matrícula.
  const modo = estado.modo_control_matricula ?? 'estricto';
  const hayQueVerificarla = modo === 'estricto' || vigente.cargada_por_el_asistente === true;
  if (hayQueVerificarla && !vigente.verificada_at) return BLOQUEO.SIN_VERIFICAR;

  return null;
}

/**
 * Busca la fila de un Asistente dentro de lo que trajo la vista.
 *
 * Existe para que ninguna pantalla vuelva a escribir el `.find()` con el nombre de la columna a
 * mano: si mañana la vista cambia de nombre de columna, se arregla en un solo lugar.
 */
export function estadoDe(asistenteId, estados) {
  if (!asistenteId) return null;
  return lista(estados).find((e) => e.asistente_id === asistenteId) ?? null;
}

/**
 * Traduce el rechazo de la base a uno de los tres motivos, o `null` si el error es otra cosa.
 *
 * Cuando un disparador frena una operación, levanta un mensaje con esta forma exacta:
 *
 *     matricula_bloquea:vencida:
 *
 * Ese texto **nunca puede llegar a la pantalla**. No está traducido, no está en ninguno de los
 * tres idiomas, y para quien lo lee es un error de sistema, no una explicación. Esta función lo
 * abre, saca la palabra del medio, y la pantalla la convierte en la frase que corresponde.
 *
 * Si el error es cualquier otra cosa —se cayó la conexión, chocó con otra guardia—, devuelve
 * `null` y la pantalla lo trata como siempre.
 *
 * @param error  lo que devolvió Supabase: un objeto con `message`, o el texto suelto.
 */
export function motivoDelError(error) {
  const texto =
    typeof error === 'string' ? error : (error?.message ?? error?.error_description ?? '');
  if (!texto) return null;

  const encontrado = /matricula_bloquea:([a-z_]+)/.exec(texto);
  if (!encontrado) return null;

  const motivo = encontrado[1];
  return MOTIVOS_DE_BLOQUEO.includes(motivo) ? motivo : null;
}

/**
 * La frase que se le muestra a la persona cuando la base frenó la operación por la Matrícula.
 *
 * Devuelve `null` si el error no era de Matrícula, y entonces la pantalla lo trata como
 * cualquier otro. Cuando sí lo era, arma las dos partes que hacen falta: qué pasó y qué hacer
 * al respecto. Un cartel que dice "no se puede" y nada más obliga a preguntarle a otra persona.
 *
 * Está acá y no en cada pantalla porque son tres las que pueden chocarse con la misma pared
 * —cubrir una vacante, invitar a varios y reasignar— y el texto tiene que ser el mismo en las
 * tres (regla 12 de CLAUDE.md §7).
 *
 * @param error  lo que devolvió Supabase.
 * @param tm     el bloque de textos ya traducido: `t.matricula`.
 */
export function mensajeDeBloqueo(error, tm) {
  const motivo = motivoDelError(error);
  if (!motivo || !tm) return null;

  const que = tm[`bloqueo_${motivo}`];
  const hacer = tm[`que_hacer_${motivo}`];
  return [que, hacer].filter(Boolean).join(' ');
}

/** Las columnas de la vista que las pantallas piden. En un solo lugar para no repetirlas. */
export const COLUMNAS_ESTADO_MATRICULA =
  'asistente_id, requiere_matricula, tipo_matricula, modo_control_matricula, motivo_bloqueo, matricula_id, vigente_hasta, verificada_at, dias_para_vencer';
