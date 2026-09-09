import {
  FUENTE_AVISO_TELEFONICO,
  FUENTE_AVISO_DEMORA_ASISTENTE,
  FUENTE_CALCULO_LLEGADA_TARDIA,
  FUENTE_SIN_AVISO_NI_SALIDA,
} from './fuentesAlertaTemprana.js';

// Cómo se le nombra al Coordinador el origen de una alerta temprana (pendiente #101).
//
// POR QUÉ EXISTE. El aviso que sale por WhatsApp o por correo decía solamente «motivo: X», y con
// eso el Coordinador no podía distinguir dos cosas que no son iguales: que alguien haya avisado
// que va demorado, y que el sistema haya sacado la cuenta solo. La primera es un acto de una
// persona; la segunda es un hecho sin mérito de nadie. Mezcladas, el mérito se pierde.
//
// SON HECHOS, NO VEREDICTOS. Cada frase dice qué pasó y nada más: «aviso de demora dado desde la
// aplicación», nunca «evadió el seguimiento». Quien saca una conclusión es el Coordinador.
//
// El texto va en castellano y a mano porque estos avisos salen hacia afuera —WhatsApp y correo—,
// donde no hay pantalla ni idioma elegido por nadie, igual que el resto de los textos de
// `revisarNotificacionesCoordinador.js`. Lo que se lee adentro del Panel sale de i18n, en los tres
// idiomas, y no pasa por acá.
const COMO_SE_DICE = {
  [FUENTE_AVISO_TELEFONICO]: 'aviso telefónico registrado por la Prestadora',
  [FUENTE_AVISO_DEMORA_ASISTENTE]: 'aviso de demora dado por el Asistente desde la aplicación',
  [FUENTE_CALCULO_LLEGADA_TARDIA]: 'cuenta del sistema: la hora estimada de llegada pasa la hora de inicio',
  [FUENTE_SIN_AVISO_NI_SALIDA]: 'llegó la hora de inicio sin marca de salida, sin aviso de demora y sin llegada registrada',
};

/**
 * El origen de una alerta, dicho en una frase.
 *
 * Una fuente que no está en la lista —una fila vieja, o una escrita por una versión posterior—
 * se nombra como origen sin registrar. Nunca se la hace pasar por el aviso de una persona.
 *
 * @param {string|null|undefined} fuente
 * @returns {string}
 */
export function describirFuente(fuente) {
  return COMO_SE_DICE[fuente] ?? 'origen sin registrar';
}
