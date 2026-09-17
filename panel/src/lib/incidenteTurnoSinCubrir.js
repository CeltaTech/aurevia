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
// EL CIERRE NO ES UN TRÁMITE. Que nadie haya ido no es un turno cubierto: es un defecto grave que
// no se pudo solucionar, y así queda escrito. La familia contrató para no tener que quedarse; que
// se haya quedado igual puede costar el servicio. Por eso lo que se elige al cerrar cambia lo que
// el incidente significa.
//
// Y LA LISTA DE FINALES LA ARMA CADA PRESTADORA, en la tabla `finales_turno_sin_cubrir`. Acá están
// los que trae el producto —con los que nace— y los dos que escribe el motor solo. Cuál de ellos
// es una falla lo dice la fila del catálogo, no este archivo: un final que inventó la Prestadora
// no está en ninguna lista del código.
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
 * Cómo puede terminar un incidente: los finales que trae el producto.
 *
 * ESTA LISTA NO ES LA LISTA. La de verdad la arma cada Prestadora en la tabla
 * `finales_turno_sin_cubrir`: saca los que no usa, apaga los que no quiere ofrecer y agrega los
 * suyos. Acá están los que trae el producto, que son con los que nace, y nada más.
 *
 * Están escritos igual porque el motor los necesita: es él quien cierra solo los dos que la base
 * ya dice, y para eso tiene que saber cómo se llaman.
 */
export const CIERRES = {
  /** Apareció una Asistente asignada y el turno se hizo. */
  LLEGO_UN_RELEVO: 'llego_un_relevo',
  /** El turno dejó de hacer falta: se canceló el servicio, hubo una internación, se reprogramó. */
  YA_NO_HACIA_FALTA: 'ya_no_hacia_falta',
  /** Fue en persona quien coordina. */
  LO_CUBRIO_LA_COORDINADORA: 'lo_cubrio_la_coordinadora',
  /** Siguió quien ya estaba adentro. */
  SE_EXTENDIO_EL_TURNO: 'se_extendio_el_turno',
  /** La familia aceptó que la persona atendida quedara sola. */
  QUEDO_SOLO_CON_CONSENTIMIENTO: 'quedo_solo_con_consentimiento',
  /** No fue nadie. */
  NO_FUE_NADIE: 'no_fue_nadie',
  /** Lo resolvió de una manera que no está en ninguna lista, y escribe cuál. */
  SE_RESOLVIO_DE_OTRA_MANERA: 'se_resolvio_de_otra_manera',
};

export const CIERRES_POSIBLES = Object.values(CIERRES);

/**
 * Los dos que escribe el motor solo, porque la base ya los dice.
 *
 * No se ofrecen para elegir: que apareció una Asistente asignada, o que el turno se canceló, está
 * escrito, y ofrecerlo como opción invitaría a anotarlo sin que haya pasado.
 */
export const CIERRES_QUE_ESCRIBE_EL_SISTEMA = [CIERRES.LLEGO_UN_RELEVO, CIERRES.YA_NO_HACIA_FALTA];

/**
 * Los que quedaron escritos antes de que existiera el catálogo.
 *
 * No se vuelven a escribir y no se reescriben los expedientes viejos: están acá para poder
 * leerlos, porque su texto sigue en las traducciones.
 */
export const CIERRES_HISTORICOS = ['cubierto', 'quedo_en_la_familia'];

/**
 * Cuáles de los que trae el producto nacen marcados como defecto grave.
 *
 * Es sólo el valor de fábrica. Cuál de los finales de una Prestadora es una falla lo dice su fila
 * del catálogo, porque un final que inventó ella no está en ninguna lista del código y sólo ella
 * sabe si para su forma de trabajar eso es una falla.
 */
export const CIERRES_QUE_SON_DEFECTO_GRAVE = [
  CIERRES.QUEDO_SOLO_CON_CONSENTIMIENTO,
  CIERRES.NO_FUE_NADIE,
  // De los viejos, el único que lo era. Se deja para que un expediente cerrado antes del catálogo
  // se siga leyendo como lo que fue.
  'quedo_en_la_familia',
];

/** Si un final que trae el producto nace marcado como defecto grave. */
export function esDefectoGraveDeFabrica(cierre) {
  return CIERRES_QUE_SON_DEFECTO_GRAVE.includes(cierre);
}

/** Lo que se guarda de una fila del catálogo: su clave, o el nombre que escribió la Prestadora. */
export function valorDelFinal(fila) {
  return fila?.clave ?? fila?.nombre ?? null;
}

/**
 * Si terminar así deja escrito un defecto grave que no se pudo solucionar.
 *
 * Recibe la fila del catálogo, no el valor guardado: la respuesta es de esa Prestadora y no del
 * producto. Sin fila no se inventa nada y contesta que no, porque un cartel de falla grave sobre
 * un final que nadie marcó así sería una acusación inventada.
 */
export function esDefectoGrave(fila) {
  return Boolean(fila?.es_defecto_grave);
}

/** Los que se le ofrecen a quien cierra: los encendidos que no escribe el motor. */
export function finalesQueSeOfrecen(catalogo) {
  return (catalogo ?? [])
    .filter((f) => f?.activo !== false && !f?.lo_escribe_el_sistema)
    .sort((a, b) => (a?.orden ?? 100) - (b?.orden ?? 100));
}

/**
 * Comprueba el cierre antes de mandarlo.
 *
 * El detalle se exige acá y también del lado de la base: el mismo control en los dos lados no está
 * repetido de más —uno evita un viaje perdido, el otro es el que de verdad protege—, pero la
 * respuesta sale de la misma fila del catálogo y no de dos listas escritas aparte.
 */
export function revisarCierre({ fila, detalle } = {}) {
  if (!fila) return { ok: false, campo: 'final' };
  if (fila.pide_detalle && String(detalle ?? '').trim() === '') {
    return { ok: false, campo: 'detalle' };
  }
  return { ok: true };
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
