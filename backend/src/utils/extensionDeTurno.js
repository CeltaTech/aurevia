import { finDeGuardia, inicioDeGuardia } from './horarios.js';

/* Cuándo una Asistente quedó de más, y qué se le puede contar de la búsqueda.
   ==========================================================================

   Acá está la decisión y nada más: ni consultas a la base, ni avisos. Eso lo hace
   `revisarExtensionesDeTurno.js`. Separado porque esta parte es la que se prueba sola, y porque
   la misma cuenta la va a necesitar después la liquidación de las horas de más.

   POR QUÉ NO SE PREGUNTA POR QUÉ FALTA EL RELEVO. Hay tres maneras de que no venga nadie —el
   turno que nunca tuvo a quién asignarle, la Asistente asignada que faltó, y la que simplemente
   todavía no llegó—, y las tres dejan a la misma persona adentro de la casa. Si la extensión
   dependiera de cuál de las tres es, dos casos quedarían sin registrar. Se pregunta al revés:
   ¿pasó la hora de fin de su turno, sigue adentro, y el que venía después no arrancó? */

/**
 * De las candidatas, el turno que arranca lo más cerca posible del final de éste.
 *
 * Es el espejo de `laQueTerminoJustoAntes` de `marcarAusente.js`: allá se busca quién quedó
 * esperando, acá a quién se espera.
 *
 * Uno que arranca exactamente cuando el otro termina sí cuenta: ése es el relevo normal, el caso
 * que esto viene a mirar. Uno que ya había arrancado antes del final no es un relevo, es un turno
 * que se pisa con éste, y de eso se ocupa la programación.
 */
export function laQueSigue(guardia, candidatas) {
  const final = finDeGuardia(guardia);
  let elegida = null;
  let arranqueElegido = null;

  for (const candidata of candidatas ?? []) {
    if (candidata?.id === guardia.id) continue;
    const arranque = inicioDeGuardia(candidata);
    if (arranque < final) continue;
    if (arranqueElegido === null || arranque < arranqueElegido) {
      elegida = candidata;
      arranqueElegido = arranque;
    }
  }
  return elegida;
}

/**
 * ¿Esta Asistente está de más en este momento?
 *
 * Las cuatro condiciones, y las cuatro hacen falta:
 *   - marcó que llegó, o sea que está adentro;
 *   - no cerró su turno, o sea que sigue adentro;
 *   - ya pasó la hora en que su turno terminaba;
 *   - el turno que venía después no arrancó: no hay ninguno cargado, o el que hay no tiene marca
 *     de llegada.
 *
 * No hay ninguna tolerancia acá. Quien llega tarde ya tiene su propio aviso mucho antes, con el
 * margen que cada Prestadora configuró; sumar minutos de gracia en este lugar los contaría dos
 * veces y le restaría horas a la que se quedó.
 */
export function laExtensionCorresponde({ guardia, relevo, ahora }) {
  if (!guardia?.checkin_at) return false;
  if (guardia.checkout_at) return false;
  if (finDeGuardia(guardia) > ahora) return false;
  return !relevo?.checkin_at;
}

/**
 * ¿Se terminó de estar de más?
 *
 * Dos finales, y los dos son buenos: llegó el relevo —marcó que entró— o ella cerró su turno. El
 * segundo incluye el caso en que se fue sin que llegara nadie, que no se puede impedir y que
 * igual hay que anotar: las horas que se quedó son suyas de todos modos.
 */
export function laExtensionTermino({ guardia, relevo }) {
  return Boolean(relevo?.checkin_at) || Boolean(guardia?.checkout_at);
}

/**
 * En qué momento terminó de estar de más.
 *
 * El que haya pasado primero de los dos. Nunca la hora en que el proceso de fondo se dio cuenta:
 * eso le regalaría minutos que no trabajó, o le sacaría los que sí.
 */
export function cuandoTermino({ guardia, relevo, ahora }) {
  const momentos = [guardia?.checkout_at, relevo?.checkin_at]
    .map((m) => (m ? Date.parse(m) : NaN))
    .filter((m) => !Number.isNaN(m));
  if (momentos.length === 0) return new Date(ahora);
  return new Date(Math.min(...momentos));
}

/* Qué se le muestra a quien está esperando.
   ---------------------------------------------------------------------------
   Esperar sin saber si alguien está buscando es lo que rompe a cualquiera, así que se le cuenta
   en qué anda la búsqueda. **Sin nombres**: quién va a venir, o quién faltó, no es asunto suyo, y
   decirle que faltó una compañera es hablar de una persona a sus espaldas. Lo que se le muestra
   son los pasos que ya se dieron, que es lo único que le sirve para saber si la están dejando
   sola. */

export const PASOS_DE_LA_BUSQUEDA = {
  /** Quien coordina está enterado. */
  COORDINACION_AVISADA: 'coordinacion_avisada',
  /** El aviso ya subió de escalón: lo sabe más gente que quien coordina a ese Paciente. */
  ESCALADO: 'escalado',
  /** El turno se ofreció y está esperando que alguien lo tome. */
  TURNO_OFRECIDO: 'turno_ofrecido',
  /** Hay alguien asignado que todavía no marcó la llegada. */
  RELEVO_ASIGNADO: 'relevo_asignado',
  /** Todavía no pasó nada de lo anterior. Se muestra igual: no saber nada también es una noticia. */
  SIN_NOVEDADES: 'sin_novedades',
};

/**
 * Los pasos ya dados, en el orden en que pasaron.
 *
 * Recibe hechos ya leídos de la base, no los busca: así se prueba sin base y así la pantalla no
 * depende de cuántas consultas haga el motor.
 */
export function pasosDeLaBusqueda({ relevo, coordinacionAvisada, escalado }) {
  const pasos = [];
  if (coordinacionAvisada) pasos.push(PASOS_DE_LA_BUSQUEDA.COORDINACION_AVISADA);
  if (escalado) pasos.push(PASOS_DE_LA_BUSQUEDA.ESCALADO);
  if (relevo?.ofrecida_at) pasos.push(PASOS_DE_LA_BUSQUEDA.TURNO_OFRECIDO);
  if (relevo?.asistente_id) pasos.push(PASOS_DE_LA_BUSQUEDA.RELEVO_ASIGNADO);
  return pasos.length ? pasos : [PASOS_DE_LA_BUSQUEDA.SIN_NOVEDADES];
}
