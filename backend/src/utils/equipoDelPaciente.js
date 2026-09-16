// Punto único de verdad de QUIÉNES SON EL EQUIPO DE UN PACIENTE.
// ============================================================================
//
// QUÉ ES UN EQUIPO. Las Asistentes que habitualmente trabajan con un Paciente, más la persona
// que las coordina. Adentro del equipo puede haber una franquera, que cubre los días francos de
// las demás y, en general, las emergencias.
//
// POR QUÉ HACÍA FALTA. Hasta ahora la continuidad existía solamente como puntos al ordenar la
// lista de candidatos: se contaban las veces que alguien ya había atendido a ese Paciente, y
// listo. Esa cuenta no distingue a la que está todas las tardes hace dos años de la que cubrió
// cinco veces el año pasado, y no hay ningún lugar donde consultar "quiénes son los de este
// Paciente". Todo lo que viene después —el expediente del turno vacío, a quién se llama cuando
// falta alguien— necesita esa lista.
//
// SE ARMA SOLO Y SE CORRIGE A MANO, y ése es el corazón de este archivo. El sistema **propone**
// el equipo mirando los turnos que ya pasaron y las series vigentes; quien **fija** es la
// Coordinadora, que sabe cosas que el sistema no sabe: que la que aparece tres veces fue un
// reemplazo de verano, que la que entra la semana que viene todavía no tiene ni un turno hecho.
// Por eso lo guardado son **solamente las correcciones** —a quién sumó, a quién sacó, quién
// cubre francos—, nunca la lista entera. Guardar la lista entera la congelaría el día que se
// guarda, y a la semana siguiente estaría vieja sin que nadie se entere.
//
// QUÉ NO DECIDE ESTA LISTA. Nada. No bloquea, no asigna y no reemplaza a la Coordinadora. Es
// quiénes son, para que el resto del sistema pueda preguntarlo.
//
// Se copia entero al motor (`scripts/copias_entre_apps.mjs`), que lo necesita para saber a quién
// avisarle cuando un turno se queda sin nadie. Por eso no importa nada del Panel.

// Con extensión a propósito: este archivo se copia tal cual al motor, que corre en Node y ahí la
// ruta sin extensión no resuelve.
import { inicioDeGuardia } from './horarios.js';

/**
 * Cuándo una Asistente es del equipo sin que nadie la haya puesto. Valores de fábrica.
 *
 * Los dos números van juntos y por eso se leen juntos: «al menos tres turnos en los últimos
 * noventa días». Uno solo no alcanza —tres turnos en dos años no es un equipo, y un turno de la
 * semana pasada tampoco—, y la ventana es lo que hace que alguien que dejó de venir salga solo.
 */
export const REGLA_DE_EQUIPO = {
  /** Cuántos turnos con ese Paciente hacen falta para entrar solo. */
  turnos_para_ser_del_equipo: 3,
  /** Hasta cuántos días hacia atrás se miran esos turnos. */
  dias_hacia_atras: 90,
};

/** Entre qué valores se puede correr cada número de la regla. */
export const REGLA_QUE_SE_PUEDE_TOCAR = {
  turnos_para_ser_del_equipo: { minimo: 1, maximo: 60 },
  dias_hacia_atras: { minimo: 7, maximo: 730 },
};

/**
 * Qué decisión tomó la Coordinadora sobre una persona.
 *
 * `sumada` la pone en el equipo aunque no llegue sola; `sacada` la deja afuera aunque llegue.
 * No hay una tercera: que alguien entre porque cumple la regla no es una decisión de nadie.
 */
export const SITUACIONES = ['sumada', 'sacada'];

/**
 * Por qué cada integrante está en la lista. Se muestra siempre, porque no es lo mismo que el
 * sistema lo haya deducido a que alguien lo haya puesto, y quien mira la lista tiene derecho a
 * saber cuál de las dos cosas está viendo.
 */
export const ORIGEN = {
  /** Cumple la regla: tiene los turnos que hacen falta en la ventana que se mira. */
  POR_SUS_TURNOS: 'por_sus_turnos',
  /** Tiene una serie vigente con ese Paciente. Es el caso más claro de "habitual". */
  POR_SU_SERIE: 'por_su_serie',
  /** La puso la Coordinadora. */
  A_MANO: 'a_mano',
  /** Alcanza al Paciente por sus zonas. Sólo para quien coordina. */
  POR_SU_ZONA: 'por_su_zona',
};

/** Los números con los que se arma el equipo, con lo que esta Prestadora haya corrido encima. */
export function reglaDeEquipoDe(configuracion) {
  const regla = { ...REGLA_DE_EQUIPO };
  for (const [clave, borde] of Object.entries(REGLA_QUE_SE_PUEDE_TOCAR)) {
    const valor = Number(configuracion?.[clave]);
    if (!Number.isFinite(valor)) continue;
    if (valor < borde.minimo || valor > borde.maximo) continue;
    regla[clave] = valor;
  }
  return regla;
}

/** Comprueba lo que llega de afuera antes de guardarlo. Misma forma que en los otros ajustes. */
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
    if (valor === REGLA_DE_EQUIPO[clave]) continue;
    corridos[clave] = valor;
  }
  return corridos;
}

/**
 * El equipo de un Paciente.
 *
 * Todo llega ya cargado: este archivo no habla con la base, para poder correr igual en el Panel
 * y en el motor.
 *
 * @param {object} entrada
 * @param {string} entrada.pacienteId De quién es el equipo.
 * @param {Array} entrada.guardias Turnos que tocan a ese Paciente, con `asistente_id`, `estado`,
 *   `fecha` y `hora_inicio`. Los que no lo tocan se ignoran, así que se puede pasar la lista
 *   entera de la pantalla.
 * @param {Map|null} entrada.pacientesPorGuardia Id de guardia → ids de Paciente. Si falta, se usa
 *   la columna vieja `paciente_id` de cada guardia.
 * @param {Array} entrada.series Series vigentes que tocan a ese Paciente, con `asistente_id`.
 * @param {Array} entrada.decisiones Lo guardado: `{ asistente_id, usuario_id, situacion,
 *   cubre_francos }`.
 * @param {Array} entrada.coordinadoresQueAlcanzan Ids de quienes hoy alcanzan al Paciente por zona.
 * @param {object} entrada.regla Los números ya resueltos por `reglaDeEquipoDe`.
 * @param {Date} entrada.ahora Desde cuándo se cuenta hacia atrás.
 * @returns {{ asistentes: Array, coordinadores: Array, afuera: Array }}
 */
export function equipoDelPaciente({
  pacienteId,
  guardias = [],
  pacientesPorGuardia = null,
  series = [],
  decisiones = [],
  coordinadoresQueAlcanzan = [],
  regla = REGLA_DE_EQUIPO,
  ahora = new Date(),
} = {}) {
  const decision = decisionesPorPersona(decisiones);
  const desde = new Date(ahora.getTime() - regla.dias_hacia_atras * 24 * 60 * 60 * 1000);

  // Cuántos turnos hizo cada una con este Paciente adentro de la ventana, y cuándo fue el último.
  const cuenta = new Map();
  for (const guardia of guardias) {
    if (!guardia?.asistente_id) continue;
    if (!tocaAlPaciente(guardia, pacienteId, pacientesPorGuardia)) continue;
    if (guardia.estado === 'cancelada' || guardia.estado === 'ausente') continue;
    const empezo = inicioDeGuardia(guardia);
    if (!empezo || empezo >= ahora || empezo < desde) continue;
    const llevado = cuenta.get(guardia.asistente_id) ?? { turnos: 0, ultima_vez: null };
    llevado.turnos += 1;
    if (!llevado.ultima_vez || empezo > llevado.ultima_vez) llevado.ultima_vez = empezo;
    cuenta.set(guardia.asistente_id, llevado);
  }

  const conSerie = new Set(
    series.filter((s) => s?.asistente_id && serieVigente(s)).map((s) => s.asistente_id)
  );

  // Candidatas a integrar el equipo: las que llegan solas y las que alguien puso a mano.
  const idsAsistentes = new Set([
    ...cuenta.keys(),
    ...conSerie,
    ...decisiones.filter((d) => d?.asistente_id).map((d) => d.asistente_id),
  ]);

  const asistentes = [];
  const afuera = [];
  for (const id of idsAsistentes) {
    const suya = decision.get(claveAsistente(id));
    const llevado = cuenta.get(id) ?? { turnos: 0, ultima_vez: null };
    const llegaSola = conSerie.has(id) || llevado.turnos >= regla.turnos_para_ser_del_equipo;

    const integrante = {
      asistente_id: id,
      turnos: llevado.turnos,
      ultima_vez: llevado.ultima_vez,
      cubre_francos: Boolean(suya?.cubre_francos),
      // La serie manda sobre la cuenta de turnos: tener un turno fijo semanal es lo más parecido
      // a "habitual" que hay, aunque la serie sea de la semana pasada y todavía no haya turnos.
      origen: suya?.situacion === 'sumada' && !llegaSola
        ? ORIGEN.A_MANO
        : conSerie.has(id)
          ? ORIGEN.POR_SU_SERIE
          : ORIGEN.POR_SUS_TURNOS,
      decidido: Boolean(suya),
    };

    if (suya?.situacion === 'sacada') {
      afuera.push({ ...integrante, llegaba_solo: llegaSola });
      continue;
    }
    if (!llegaSola && suya?.situacion !== 'sumada') continue;
    asistentes.push(integrante);
  }

  // Primero quien cubre francos, después por turnos, y a igualdad por lo más reciente. Quien
  // cubre francos va arriba porque es a quien se llama cuando falta alguien.
  asistentes.sort(
    (a, b) =>
      Number(b.cubre_francos) - Number(a.cubre_francos) ||
      b.turnos - a.turnos ||
      (b.ultima_vez?.getTime() ?? 0) - (a.ultima_vez?.getTime() ?? 0)
  );

  return {
    asistentes,
    coordinadores: coordinadoresDelEquipo(decisiones, decision, coordinadoresQueAlcanzan),
    afuera,
  };
}

/**
 * Quién coordina a este Paciente.
 *
 * Si nadie lo fijó, son todos los que lo alcanzan por sus zonas —que es como el sistema resuelve
 * hoy quién puede ver sus turnos—. En cuanto alguien fija a una persona, manda esa: un aviso que
 * le llega a seis personas no le llega a ninguna.
 */
function coordinadoresDelEquipo(decisiones, decision, coordinadoresQueAlcanzan) {
  const fijados = decisiones
    .filter((d) => d?.usuario_id && d.situacion !== 'sacada')
    .map((d) => ({ usuario_id: d.usuario_id, origen: ORIGEN.A_MANO, decidido: true }));
  if (fijados.length) return fijados;

  return [...new Set(coordinadoresQueAlcanzan)]
    .filter((id) => decision.get(claveCoordinador(id))?.situacion !== 'sacada')
    .map((id) => ({ usuario_id: id, origen: ORIGEN.POR_SU_ZONA, decidido: false }));
}

function decisionesPorPersona(decisiones) {
  const mapa = new Map();
  for (const d of decisiones ?? []) {
    if (d?.asistente_id) mapa.set(claveAsistente(d.asistente_id), d);
    else if (d?.usuario_id) mapa.set(claveCoordinador(d.usuario_id), d);
  }
  return mapa;
}

const claveAsistente = (id) => `a:${id}`;
const claveCoordinador = (id) => `c:${id}`;

function tocaAlPaciente(guardia, pacienteId, pacientesPorGuardia) {
  const deLaLista = pacientesPorGuardia?.get(guardia.id);
  if (deLaLista?.length) return deLaLista.includes(pacienteId);
  return guardia.paciente_id === pacienteId;
}

function serieVigente(serie) {
  if (serie.estado && serie.estado !== 'activa') return false;
  if (!serie.vigente_hasta) return true;
  return serie.vigente_hasta >= hoyEnTexto();
}

function hoyEnTexto() {
  const ahora = new Date();
  return `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, '0')}-${String(
    ahora.getDate()
  ).padStart(2, '0')}`;
}

/** Quién cubre los francos de este Paciente, que es a quien se llama primero cuando falta alguien. */
export function quienCubreFrancos(equipo) {
  return (equipo?.asistentes ?? []).filter((a) => a.cubre_francos);
}
