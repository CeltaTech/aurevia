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
  'ausencias',
  'comunicacion',
];

export const PESTANAS_COORDINADOR = [
  'perfil',
  'verificacion',
  'certificado',
  'guardias',
  'ausencias',
  'comunicacion',
];

/** Las que se le muestran a quien está mirando. */
export function pestanasDe(esAdmin) {
  return esAdmin ? PESTANAS : PESTANAS_COORDINADOR;
}
