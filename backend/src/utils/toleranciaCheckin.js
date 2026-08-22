// Cuán lejos del domicilio puede marcar un Asistente y que igual cuente como haber llegado.
//
// Este archivo existe más de una vez a propósito (ver `scripts/copias_entre_apps.mjs`): la
// misma pregunta se contesta en dos lados. En el motor, cuando entra un check-in y hay que
// decidir si se le avisa al Coordinador que alguien marcó lejos. Y en el Panel, en la pantalla
// de control de llegadas, que muestra si ese mismo check-in quedó verificado o fuera de rango.
//
// Cuando cada lado llevaba su propio número, las dos respuestas no coincidían: el motor
// toleraba los metros que la Prestadora había configurado y la pantalla un valor fijo escrito
// a mano, más del doble. El mismo check-in podía estar bien para el motor y mal para la
// pantalla que se usa justamente para auditar los check-in.
//
// El valor lo elige cada Prestadora en Configuración → El cuidado, y se guarda en
// `configuracion_ausencia_automatica`. Lo que hay acá abajo es solo dos cosas: con qué se
// compara, y qué se hace en el único caso en que la base no llega a contestar, que es cuando
// esa Prestadora todavía no tiene fila de configuración.

/**
 * Metros de tolerancia cuando la Prestadora todavía no configuró los suyos. Es el mismo número
 * que la base pone por omisión en la columna: se repite acá únicamente para el caso en que no
 * exista la fila, que es cuando la base no tiene ocasión de aplicar su propio valor.
 */
export const METROS_TOLERANCIA_POR_OMISION = 150;

/** Minutos de espera antes de dar por ausente a quien no marcó, misma situación que arriba. */
export const MINUTOS_TOLERANCIA_POR_OMISION = 15;

/** Los metros que tolera esta Prestadora, haya configurado los suyos o no. */
export function metrosDeTolerancia(configuracion) {
  const metros = configuracion?.metros_tolerancia_checkin;
  return Number.isFinite(metros) && metros > 0 ? metros : METROS_TOLERANCIA_POR_OMISION;
}

/**
 * ¿El punto donde marcó cuenta como haber llegado al domicilio?
 *
 * Devuelve `true`, `false` o `null`. El `null` es el caso en que la distancia no se pudo
 * calcular —falta la coordenada del punto o falta la del domicilio— y no es lo mismo que
 * "fuera de rango": es no saber. Nadie queda marcado como que llegó lejos porque a una
 * dirección le falten las coordenadas; quien llama decide cómo muestra ese caso.
 */
export function llegoAlDomicilio(metros, configuracion) {
  if (!Number.isFinite(metros)) return null;
  return metros <= metrosDeTolerancia(configuracion);
}
