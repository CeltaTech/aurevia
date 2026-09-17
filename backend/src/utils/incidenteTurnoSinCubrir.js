// Punto único de verdad de CUÁNDO UN TURNO VACÍO DEJA DE SER UN RENGLÓN Y PASA A SER GRAVE.
// ============================================================================
//
// QUÉ RESUELVE. Hasta ahora un turno sin nadie asignado producía un aviso y nada más. El aviso se
// lee o no se lee, y al día siguiente el turno desaparece de la lista que lo miraba: queda en
// `programada` para siempre, sin que nadie tenga que dar cuenta de él. Un turno que nunca se cubrió
// es una falla del servicio, y una falla del servicio tiene que quedar abierta hasta que alguien la
// cierre a mano diciendo cómo terminó.
//
// LA DIFERENCIA ENTRE EL AVISO Y EL INCIDENTE. El aviso es un mensaje: sale, llega y se termina.
// El incidente es una fila que queda abierta, que se le vuelve a recordar a quien lo puede tapar,
// y que al cerrarse deja escrito qué pasó. Un turno vacío produce las dos cosas y no se pisan:
// el aviso avisa temprano, el incidente se abre recién cuando el turno está cerca y ya es grave.
//
// EL BORDE SON VEINTICUATRO HORAS, y es el mismo con el que una ausencia deja de estar «avisada con
// tiempo» (`avisoDeAusencia.js`). Se eligió igual a propósito: las dos preguntas son la misma
// —¿queda margen para conseguir a alguien?— y tenerlas con números distintos obligaría a explicar
// por qué. Como todo número de este producto, cada Prestadora lo corre si su realidad es otra.
//
// EL CIERRE NO ES UN TRÁMITE. Un turno que terminó en manos de la familia no es un turno cubierto:
// es un defecto grave que no se pudo solucionar, y así queda escrito. La familia contrató para no
// tener que quedarse; que se haya quedado igual puede costar el servicio. Por eso el cierre se
// elige de una lista corta y lo que se elige cambia lo que el incidente significa.
//
// QUÉ NO DECIDE ESTE ARCHIVO. No abre nada, no avisa y no cierra nada. Contesta cuándo un turno
// vacío es grave y qué significa cada forma de cerrarlo; quién abre, quién insiste y quién cierra
// son el proceso de fondo y la Coordinadora.
//
// Se copia entero al motor (`scripts/copias_entre_apps.mjs`), que es quien los abre. Por eso no
// importa nada del Panel.

// Con extensión a propósito: este archivo se copia tal cual al motor, que corre en Node y ahí la
// ruta sin extensión no resuelve.
import { inicioDeGuardia } from './horarios.js';

/**
 * Los números con los que un turno vacío se vuelve un incidente. Valores de fábrica.
 */
export const REGLA_DEL_INCIDENTE = {
  /** A cuántas horas de empezar, un turno que sigue sin nadie abre el incidente. */
  horas_para_abrirlo: 24,
  /** Cada cuántas horas se le vuelve a recordar a quien lo puede tapar. */
  horas_entre_recordatorios: 2,
};

/** Entre qué valores se puede correr cada número de la regla. */
export const REGLA_QUE_SE_PUEDE_TOCAR = {
  // El mínimo no puede ser cero: con cero horas el incidente se abriría recién al empezar el
  // turno, que es justo cuando ya no se puede tapar.
  horas_para_abrirlo: { minimo: 1, maximo: 720 },
  horas_entre_recordatorios: { minimo: 1, maximo: 72 },
};

/**
 * Cómo puede terminar un incidente.
 *
 * `cubierto` es el único final bueno: apareció alguien y el turno se hizo. Los otros dos no son
 * variantes suyas, son finales distintos y se leen distinto en cualquier reporte.
 */
export const CIERRES = {
  /** Se le asignó una Asistente y el turno se hizo. */
  CUBIERTO: 'cubierto',
  /** Nadie fue y el turno quedó en manos de la familia. */
  QUEDO_EN_LA_FAMILIA: 'quedo_en_la_familia',
  /** El turno dejó de hacer falta: se canceló el servicio, hubo una internación, se reprogramó. */
  YA_NO_HACIA_FALTA: 'ya_no_hacia_falta',
};

export const CIERRES_POSIBLES = Object.values(CIERRES);

/**
 * Cuáles de esos finales son un defecto grave que no se pudo solucionar.
 *
 * Es una lista y no una sola constante porque va a crecer: «nadie fue y el Paciente quedó solo» es
 * el otro caso, y todavía no existe como cierre.
 *
 * No se guarda en la base una columna que diga «esto fue un defecto grave»: el final elegido ya lo
 * dice, y guardar las dos cosas las haría divergir el día que esta lista cambie.
 */
export const CIERRES_QUE_SON_DEFECTO_GRAVE = [CIERRES.QUEDO_EN_LA_FAMILIA];

/** Si este final deja escrito un defecto grave que no se pudo solucionar. */
export function esDefectoGrave(cierre) {
  return CIERRES_QUE_SON_DEFECTO_GRAVE.includes(cierre);
}

const MS_POR_HORA = 60 * 60 * 1000;

/** Los números con los que se abre el incidente, con lo que esta Prestadora haya corrido encima. */
export function reglaDelIncidenteDe(configuracion) {
  const regla = { ...REGLA_DEL_INCIDENTE };
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
    if (valor === REGLA_DEL_INCIDENTE[clave]) continue;
    corridos[clave] = valor;
  }
  return corridos;
}

/**
 * Cuántas horas faltan para que este turno empiece. Negativo si ya empezó.
 *
 * Devuelve `null` si al turno le falta la fecha o la hora: sin eso no hay cuenta posible, y quien
 * llama decide qué hacer con la duda en vez de recibir un cero que parece un dato.
 */
export function horasHastaElTurno(guardia, ahora = new Date()) {
  if (!guardia?.fecha || !guardia?.hora_inicio) return null;
  const inicio = inicioDeGuardia(guardia);
  if (!inicio || Number.isNaN(inicio.getTime())) return null;
  return (inicio.getTime() - ahora.getTime()) / MS_POR_HORA;
}

/**
 * Si este turno ya es grave y tiene que tener un incidente abierto.
 *
 * Tres condiciones, y las tres tienen que darse: que siga sin nadie asignado, que siga en pie —un
 * turno cancelado no deja a nadie sin atender— y que esté dentro de las horas que decidió la
 * Prestadora. Un turno que ya empezó sigue siendo grave: que se haya hecho tarde no lo arregla, y
 * el incidente tiene que quedar abierto para que alguien diga cómo terminó.
 *
 * @param {object} entrada
 * @param {object} entrada.guardia Con `asistente_id`, `estado`, `fecha` y `hora_inicio`.
 * @param {object} entrada.regla Los números de esta Prestadora, de `reglaDelIncidenteDe()`.
 * @param {Date} entrada.ahora
 */
export function elTurnoYaEsGrave(
  { guardia, regla = REGLA_DEL_INCIDENTE, ahora = new Date() } = {}
) {
  if (!guardia) return false;
  if (guardia.asistente_id) return false;
  if (guardia.estado !== 'programada') return false;
  const horas = horasHastaElTurno(guardia, ahora);
  if (horas === null) return false;
  return horas <= reglaDelIncidenteDe(regla).horas_para_abrirlo;
}
