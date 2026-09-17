// Punto único de verdad de CÓMO LLEGÓ UNA AUSENCIA: con tiempo o de golpe.
// ============================================================================
//
// QUÉ RESUELVE. Hasta ahora una ausencia era una ausencia. Pedir vacaciones con un mes de
// anticipación y no aparecer esta mañana quedaban guardados igual, con las mismas columnas, y el
// sistema no podía tratarlos distinto. Son dos cosas opuestas: una es una tarea que la
// Coordinadora resuelve cuando puede, la otra es un turno que empieza en dos horas y no tiene a
// nadie.
//
// LO QUE SE GUARDA ES **CUÁNDO SE SUPO**, y nada más. La distancia entre ese momento y el primer
// turno afectado es una cuenta, y las cuentas no se guardan: el día que la Prestadora corra el
// número que separa «con tiempo» de «de golpe», todas las ausencias viejas quedan bien
// clasificadas solas. Guardar la clasificación las congelaría con el criterio del día que se
// cargaron.
//
// POR QUÉ NO ALCANZA CON LA HORA DE CARGA. La ausencia la carga la Coordinadora, que puede
// hacerlo al rato, a la noche o al día siguiente de que la avisaron. Si la cuenta saliera de la
// hora de carga, una Asistente que avisó con tres días de anticipación aparecería como que avisó
// tarde por culpa de la demora de otra persona. De ahí que `avisada_en` sea un dato propio, que
// nace con el momento de la carga y se puede corregir.
//
// CONTRA QUÉ SE MIDE. Contra el primer turno que la ausencia deja sin nadie, no contra el día en
// que empieza la licencia. Lo que apura a la Coordinadora es el turno, no el almanaque: una
// ausencia que empieza mañana pero cuyo primer turno es el lunes deja todo el fin de semana para
// resolverla. Y una ausencia que no toca ningún turno no apura nada, aunque empiece dentro de una
// hora.
//
// QUÉ NO DECIDE ESTE ARCHIVO. No avisa, no asigna y no bloquea nada. Contesta cómo llegó una
// ausencia; qué se hace con esa respuesta lo deciden el proceso que manda los avisos y la
// Coordinadora.
//
// Se copia entero al motor (`scripts/copias_entre_apps.mjs`), que es quien manda los avisos. Por
// eso no importa nada del Panel.

// Con extensión a propósito: este archivo se copia tal cual al motor, que corre en Node y ahí la
// ruta sin extensión no resuelve.
import { inicioDeGuardia } from './horarios.js';
import { ausenciaQueTapaLaGuardia } from './ausenciaQueTapa.js';

/**
 * Los números con los que se decide si una ausencia llegó con tiempo. Valores de fábrica.
 *
 * Veinticuatro horas es el mismo borde con el que el sistema considera grave un turno que sigue
 * sin nadie, y se eligió igual a propósito: las dos preguntas son la misma —¿queda margen para
 * conseguir a alguien?— y tenerlas con números distintos obligaría a explicar por qué.
 */
export const REGLA_DE_AVISO_DE_AUSENCIA = {
  /** Con cuántas horas de anticipación sobre el primer turno afectado se considera «con tiempo». */
  horas_para_considerarla_con_tiempo: 24,
  /** Cada cuántas horas se vuelve a avisar mientras el turno siga sin nadie. */
  horas_entre_avisos: 2,
};

/** Entre qué valores se puede correr cada número de la regla. */
export const REGLA_QUE_SE_PUEDE_TOCAR = {
  // El mínimo no puede ser cero: con cero horas ninguna ausencia sería nunca urgente, ni la que
  // avisan con el turno ya empezado.
  horas_para_considerarla_con_tiempo: { minimo: 1, maximo: 720 },
  horas_entre_avisos: { minimo: 1, maximo: 72 },
};

/**
 * Cómo llegó la ausencia.
 *
 * `sin_turnos` no es un caso menor ni un error: es la ausencia que no deja ningún turno sin
 * cubrir. Existe separada de las otras dos porque no hay nada que resolver, y tratarla como «con
 * tiempo» llenaría la pantalla de la Coordinadora de tareas que no son tareas.
 */
export const COMO_LLEGO = {
  CON_TIEMPO: 'con_tiempo',
  DE_GOLPE: 'de_golpe',
  SIN_TURNOS: 'sin_turnos',
};

const MS_POR_HORA = 60 * 60 * 1000;

/** Los números con los que se clasifica, con lo que esta Prestadora haya corrido encima. */
export function reglaDeAvisoDe(configuracion) {
  const regla = { ...REGLA_DE_AVISO_DE_AUSENCIA };
  for (const [clave, borde] of Object.entries(REGLA_QUE_SE_PUEDE_TOCAR)) {
    const valor = Number(configuracion?.[clave]);
    if (!Number.isFinite(valor)) continue;
    if (valor < borde.minimo || valor > borde.maximo) continue;
    regla[clave] = valor;
  }
  return regla;
}

/** Comprueba lo que llega de afuera antes de guardarlo. */
export function revisarRegla(cambios) {
  for (const [clave, valor] of Object.entries(cambios ?? {})) {
    const borde = REGLA_QUE_SE_PUEDE_TOCAR[clave];
    if (!borde) return { ok: false, clave };
    const numero = Number(valor);
    if (!Number.isFinite(numero) || numero < borde.minimo || numero > borde.maximo) {
      return { ok: false, clave };
    }
  }
  return { ok: true };
}

/** Sólo lo que esta Prestadora corrió respecto de los valores de fábrica. Es lo que se guarda. */
export function soloLoQueCorreDeLaRegla(cambios) {
  const corridos = {};
  for (const clave of Object.keys(REGLA_QUE_SE_PUEDE_TOCAR)) {
    const valor = Number(cambios?.[clave]);
    if (!Number.isFinite(valor)) continue;
    if (valor === REGLA_DE_AVISO_DE_AUSENCIA[clave]) continue;
    corridos[clave] = valor;
  }
  return corridos;
}

/**
 * El momento en que la Prestadora se enteró de esta ausencia.
 *
 * Una ausencia vieja, cargada antes de que existiera esta columna, no tiene el dato. En ese caso
 * se usa el momento en que se cargó: es lo más cercano que hay, y lo único que puede pasar es que
 * una ausencia de hace meses quede clasificada con un error de unas horas. Devolver `null` sería
 * peor, porque dejaría afuera del tratamiento a todas las ausencias anteriores.
 */
export function cuandoSeSupo(ausencia) {
  const crudo = ausencia?.avisada_en ?? ausencia?.created_at ?? null;
  if (!crudo) return null;
  const momento = new Date(crudo);
  return Number.isNaN(momento.getTime()) ? null : momento;
}

/**
 * Los turnos que esta ausencia deja sin nadie, ordenados por hora de inicio.
 *
 * Se descartan tres clases de turno, y cada una por su motivo: los que la ausencia no tapa
 * —porque caen fuera de sus fechas o son de otra persona—; los que ya empezaron antes de que se
 * supiera de la ausencia, que no son un hueco que haya que salir a tapar sino un turno que esa
 * persona ya estaba haciendo; y los que ya no están en pie, cancelados o pasados a otra persona.
 */
export function turnosQueDejaSinNadie({ ausencia, guardias = [] } = {}) {
  const supo = cuandoSeSupo(ausencia);
  return (guardias ?? [])
    .filter((guardia) => {
      if (!guardia?.fecha || !guardia?.hora_inicio) return false;
      if (guardia.asistente_id !== ausencia?.asistente_id) return false;
      if (guardia.estado === 'cancelada') return false;
      if (!ausenciaQueTapaLaGuardia(guardia, [ausencia])) return false;
      if (supo && inicioDeGuardia(guardia).getTime() < supo.getTime()) return false;
      return true;
    })
    .sort((a, b) => inicioDeGuardia(a).getTime() - inicioDeGuardia(b).getTime());
}

/**
 * Cómo llegó una ausencia, y con cuántas horas de anticipación.
 *
 * Todo llega ya cargado: este archivo no habla con la base, para poder correr igual en el Panel y
 * en el motor.
 *
 * @param {object} entrada
 * @param {object} entrada.ausencia Con `asistente_id`, `fecha_inicio`, `fecha_fin` y `avisada_en`.
 * @param {Array} entrada.guardias Turnos de esa persona. Los que no toca la ausencia se ignoran,
 *   así que se puede pasar la lista entera de la pantalla.
 * @param {object} entrada.regla Los números de esta Prestadora, de `reglaDeAvisoDe()`.
 * @returns {{como: string, horas: number|null, primerTurno: object|null, turnos: Array}}
 *   `horas` es la anticipación sobre el primer turno afectado, negativa si ese turno ya había
 *   empezado cuando se supo.
 */
export function comoLlegoLaAusencia({
  ausencia,
  guardias = [],
  regla = REGLA_DE_AVISO_DE_AUSENCIA,
} = {}) {
  const turnos = turnosQueDejaSinNadie({ ausencia, guardias });
  if (!turnos.length) {
    return { como: COMO_LLEGO.SIN_TURNOS, horas: null, primerTurno: null, turnos };
  }

  const primerTurno = turnos[0];
  const supo = cuandoSeSupo(ausencia);
  // Sin el momento en que se supo no hay cuenta posible, y suponer que se supo recién sería
  // inventar el dato que decide. Se trata como urgente: el error caro es el otro, dejar pasar en
  // silencio un turno que empieza esta tarde (CLAUDE.md §5, todo control falla cerrado).
  if (!supo) {
    return { como: COMO_LLEGO.DE_GOLPE, horas: null, primerTurno, turnos };
  }

  const horas = (inicioDeGuardia(primerTurno).getTime() - supo.getTime()) / MS_POR_HORA;
  const conTiempo = horas >= reglaDeAvisoDe(regla).horas_para_considerarla_con_tiempo;
  return {
    como: conTiempo ? COMO_LLEGO.CON_TIEMPO : COMO_LLEGO.DE_GOLPE,
    horas,
    primerTurno,
    turnos,
  };
}
