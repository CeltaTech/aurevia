// Qué guardias deja sin Asistente una ausencia.
//
// La columna `ausencias.guardias_afectadas` existe desde el primer día y no la escribía nadie, así
// que una cobertura quedaba colgada de la ausencia y no de los turnos que esa ausencia dejó
// descubiertos: se sabía que la persona faltó, y no qué había que cubrir.
//
// ESTO ES UNA REGLA, NO UNA CONSULTA. Qué cuenta como afectada lo decide esta función y nadie
// más; quien la use trae las guardias de esa persona y pregunta acá. La consulta a la base vive en
// la pantalla, y así esta regla se puede probar sin base.

/**
 * Los tres estados que una ausencia deja descubiertos. Son los turnos que todavía se van a
 * prestar: el programado, el que está corriendo en este momento —una ausencia puede empezar hoy— y
 * el pausado, porque la pausa es del servicio del Paciente y el día que se reanude la persona
 * sigue sin estar.
 *
 * Los otros tres no se tocan, y por el mismo motivo los tres: ya pasaron. Una guardia completada
 * se prestó, una cancelada no existe más y una marcada como ausente ya registró que esa persona no
 * fue. Ninguna de las tres tiene nada que cubrir, y meterlas en la lista haría aparecer un
 * sustituto para un día que terminó.
 */
export const ESTADOS_QUE_UNA_AUSENCIA_DEJA_SIN_ASISTENTE = ['programada', 'activa', 'pausada'];

/**
 * Los identificadores de las guardias que quedan afectadas por el rango de una ausencia.
 *
 * `guardias` son las de esa persona, tal como vienen de la base: cada una con `id`, `fecha` y
 * `estado`. Una ausencia sin fecha de fin está abierta y alcanza a todo lo que venga después del
 * inicio; cuando se le cargue el fin, la lista se vuelve a calcular con este mismo cálculo.
 *
 * Las fechas se comparan como el texto `AAAA-MM-DD` que guarda la base. Convertirlas a fecha del
 * navegador las movería de día: una fecha sin hora se lee como medianoche en tiempo universal, y
 * al oeste del meridiano eso es el día anterior.
 */
export function guardiasAfectadas(guardias, ausencia) {
  const desde = ausencia?.fecha_inicio;
  if (!desde) return [];
  const hasta = ausencia?.fecha_fin || null;
  return (guardias ?? [])
    .filter((g) => ESTADOS_QUE_UNA_AUSENCIA_DEJA_SIN_ASISTENTE.includes(g?.estado))
    .filter((g) => typeof g?.fecha === 'string' && g.fecha >= desde && (hasta === null || g.fecha <= hasta))
    .map((g) => g.id);
}
