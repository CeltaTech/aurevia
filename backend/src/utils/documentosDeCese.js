/* Los documentos que genera el módulo de Plantel: cómo se llaman y dónde se guardan.
   ==========================================================================

   POR QUÉ EXISTE ESTE ARCHIVO. El nombre de archivo de cada documento estaba escrito a mano en
   las tres pantallas que los bajan —seis veces en total, `liquidacion-…`, `telegrama-cese-…`,
   `certificado-trabajo-…`— y ninguna sabía de las otras. Con eso, cambiar cómo se nombra un
   documento era buscarlo pantalla por pantalla, y dos de esos nombres ya no seguían la misma
   forma. Es el caso que describe «ningún patrón repetido sin punto único de verdad»
   (`../../../CLAUDE.md` §8).

   Y hay una segunda razón: desde que los documentos del cese quedan guardados, el motor tiene
   que saber cuáles son los tipos que acepta, y esa lista no puede vivir en una pantalla. Por eso
   este archivo se copia a `backend/src/utils/documentosDeCese.js`
   (`scripts/copias_entre_apps.mjs`) y no importa nada: lo que se copia entre carpetas que se
   despliegan por separado tiene que resolverse igual de los dos lados.

   QUÉ SE GUARDA Y QUÉ NO. Sólo los tres documentos que cuelgan de una fila de `ceses`, que son
   los que la columna `ceses.documentos_generados` puede apuntar. Los otros tres —los dos
   certificados del legajo y la constancia de ausencia— se siguen bajando y nada más: no hay
   ninguna fila de la que colgarlos, y el certificado de trabajo se emite también con el Asistente
   todavía en el plantel. Acá están los seis porque el nombre de archivo lo necesitan los seis; la
   lista de los que se guardan es aparte. */

/* Los tres que cuelgan de un cese y quedan guardados en el depósito. Se nombran de a uno y no
   como tres textos sueltos porque son a la vez el nombre del archivo adentro del depósito, la
   clave de `ceses.documentos_generados` y lo que la pantalla le manda al motor: escritos a mano
   en cada lugar, alcanza con una letra de diferencia para que el documento se guarde en un lado y
   se busque en otro. */
export const TIPO_LIQUIDACION = 'liquidacion_final';
export const TIPO_TELEGRAMA = 'telegrama_cese';
export const TIPO_NOTIFICACION_PRUEBA = 'notificacion_fin_periodo_prueba';

export const DOCUMENTOS_DE_CESE = [TIPO_LIQUIDACION, TIPO_TELEGRAMA, TIPO_NOTIFICACION_PRUEBA];

/** Cómo empieza el nombre con el que se baja cada documento. Los seis, no sólo los del cese. */
const PREFIJO = {
  [TIPO_LIQUIDACION]: 'liquidacion',
  [TIPO_TELEGRAMA]: 'telegrama-cese',
  [TIPO_NOTIFICACION_PRUEBA]: 'notificacion-fin-periodo-prueba',
  certificado_trabajo: 'certificado-trabajo',
  certificado_remuneraciones: 'certificado-remuneraciones',
  constancia_ausencia: 'constancia-ausencia',
};

/** ¿Este tipo es uno de los que se guardan? Falla cerrado: lo que no está en la lista, no entra. */
export function esDocumentoDeCese(tipo) {
  return DOCUMENTOS_DE_CESE.includes(tipo);
}

/**
 * El nombre con el que se baja un documento a la máquina de quien lo pidió.
 *
 * Lleva el nombre de la persona porque quien lo baja ya lo tiene delante en la pantalla, y sin él
 * una carpeta con veinte liquidaciones no se puede leer. Se le sacan la barra y los dos puntos,
 * que en un nombre de archivo significan otra cosa; nada más, porque esto no es una ruta del
 * depósito sino un nombre para una persona.
 *
 * @param {string} tipo  Uno de los seis de `PREFIJO`.
 * @param {{persona?: string, fecha?: string}} datos  La fecha es la del hecho —el cese, el
 *                       comienzo de la ausencia—, y se omite en los documentos que no tienen una.
 */
export function nombreDeArchivo(tipo, { persona = '', fecha = '' } = {}) {
  const limpio = String(persona).replace(/[\\/:*?"<>|]/g, ' ').trim();
  const partes = [PREFIJO[tipo] ?? tipo, limpio, fecha].filter(Boolean);
  return `${partes.join('-')}.pdf`;
}

/**
 * Dónde vive el documento guardado, adentro del depósito `documentos-cese`.
 *
 * Empieza por la Prestadora, como todas las rutas de todos los depósitos (`../../../CLAUDE.md`
 * §6), y no lleva adentro el nombre de nadie: el nombre de la persona es dato del legajo y no
 * tiene por qué quedar escrito en la ruta de un archivo.
 */
export function rutaEnElDeposito(prestadoraId, ceseId, tipo) {
  return `${prestadoraId}/${ceseId}/${tipo}.pdf`;
}
