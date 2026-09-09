// De dónde salió cada alerta temprana de guardia (`alertas_tempranas_guardia.fuente`).
//
// POR QUÉ ESTA LISTA EXISTE. Un aviso que dio una persona y una cuenta que hizo la máquina no
// son lo mismo y no se pueden mezclar nunca. Quien apretó «voy demorado» hizo algo, y eso lo
// protege; que el sistema calcule solo que alguien no llega es un hecho, no un mérito de nadie.
// Guardar las dos cosas en la misma columna sin distinguirlas convertiría un mérito en un dato
// suelto. Por eso cada origen tiene su código, y la pantalla dice cuál fue.
//
// LO QUE NO HAY es un código para «no pasó nada». La ausencia de aviso y de marca de salida
// también es un registro, pero se muestra donde se muestran los momentos de la guardia —con su
// hora, o diciendo que no hubo—, no como una alerta más: una alerta por cada guardia en la que
// nadie apretó nada sería ruido, y el ruido termina en un filtro de la casilla de correo.
// La única excepción es `sin_aviso_ni_salida`, que se anota recién cuando llegó la hora de
// inicio y no hay nada: ahí ya no es una ausencia, es una guardia que puede quedar sin cubrir.
//
// Los códigos se guardan en la base y no se renombran (regla del §8 de `celtatech/CLAUDE.md`).
// Lo que se lee en pantalla sale de i18n, en los tres idiomas.
//
// Este archivo existe dos veces y las dos son idénticas: el original es
// `panel/src/lib/fuentesAlertaTemprana.js` y la copia del motor la mantiene
// `scripts/sincronizar_copias.mjs`; `scripts/verificar_identidad.mjs` corta el build si se
// despegó. Nunca se edita la copia a mano.

/** El Coordinador registró un aviso que le llegó por teléfono. */
export const FUENTE_AVISO_TELEFONICO = 'aviso_telefonico';

/** El Asistente avisó desde su teléfono que va demorado. Es un acto suyo. */
export const FUENTE_AVISO_DEMORA_ASISTENTE = 'aviso_demora_asistente';

/** La cuenta de la hora estimada de llegada dice que no llega a horario. No lo avisó nadie. */
export const FUENTE_CALCULO_LLEGADA_TARDIA = 'calculo_llegada_tardia';

/** Llegó la hora de inicio sin marca de salida, sin aviso de demora y sin check-in. */
export const FUENTE_SIN_AVISO_NI_SALIDA = 'sin_aviso_ni_salida';

/** Todas, en el orden en que se explican. La usan la pantalla y las pruebas. */
export const FUENTES_ALERTA_TEMPRANA = [
  FUENTE_AVISO_TELEFONICO,
  FUENTE_AVISO_DEMORA_ASISTENTE,
  FUENTE_CALCULO_LLEGADA_TARDIA,
  FUENTE_SIN_AVISO_NI_SALIDA,
];

/**
 * Las que las hizo una persona, apretando un botón o levantando el teléfono.
 * Las demás las escribió el sistema solo.
 */
export const FUENTES_DE_UNA_PERSONA = [FUENTE_AVISO_TELEFONICO, FUENTE_AVISO_DEMORA_ASISTENTE];

/**
 * ¿Esta alerta la originó una persona?
 *
 * Falla cerrado: una fuente desconocida —una fila vieja, o una que escribió una versión
 * posterior— no se cuenta como acto de nadie.
 */
export function laDioUnaPersona(fuente) {
  return FUENTES_DE_UNA_PERSONA.includes(fuente);
}
