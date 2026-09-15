// ---------------------------------------------------------------------------
// pestanasDelAsistente.js — qué pestañas tiene la ficha de un Asistente, y quién ve cuáles
//
// Está afuera de la pantalla por dos motivos. Uno: son datos, no dibujo — la lista de qué se
// muestra y el orden en que se muestra no cambia según cómo esté hecha la ficha. El otro: acá
// se puede comprobar que ninguna pestaña quedó sin nombre en alguno de los tres idiomas, que es
// el error que aparece cuando se agrega una y se traduce después.
//
// Por qué el Coordinador ve menos: los datos del vínculo laboral y los reservados viven en
// tablas aparte, donde la base exige el permiso correspondiente para contestar. Esta lista no
// es el candado —el candado es la base—, es no ofrecerle una pestaña que le va a contestar que
// no. Lo operativo lo ve todo: la protección por fila de su zona ya decide qué filas alcanza.
//
// Y hay una segunda pregunta, que no es quién mira sino cómo trabaja la Prestadora. Una
// Prestadora que no trabaja en modalidad marketplace no tiene Familias evaluando Asistentes:
// esa pestaña no le mostraría poco, le mostraría siempre nada. Es el mismo recorte que ya hace
// la pantalla de Calificaciones, que existe sólo en esa modalidad.
// ---------------------------------------------------------------------------

export const PESTANAS = [
  'perfil',
  'verificacion',
  'certificado',
  'matriculas',
  'vinculo_cese',
  'simulador',
  'score_riesgo',
  'guardias',
  'evaluaciones',
  'ausencias',
  'comunicacion',
];

export const PESTANAS_COORDINADOR = [
  'perfil',
  'verificacion',
  'certificado',
  'guardias',
  'evaluaciones',
  'ausencias',
  'comunicacion',
];

/**
 * Las que dependen de que la Prestadora trabaje en modalidad marketplace. Se nombran acá, y no
 * con un `if` adentro de la ficha, porque el día que haya una segunda el `if` se convierte en
 * dos lugares donde recordar lo mismo.
 */
export const PESTANAS_SOLO_MARKETPLACE = ['evaluaciones'];

/**
 * Las que se le muestran a quien está mirando.
 *
 * Recibe un objeto y no dos valores sueltos: dos banderas seguidas en la llamada se invierten
 * sin que nada avise, y las dos preguntas que contestan no se parecen en nada.
 */
export function pestanasDe({ esAdmin, marketplace }) {
  const todas = esAdmin ? PESTANAS : PESTANAS_COORDINADOR;
  if (marketplace) return todas;
  return todas.filter((pestana) => !PESTANAS_SOLO_MARKETPLACE.includes(pestana));
}
