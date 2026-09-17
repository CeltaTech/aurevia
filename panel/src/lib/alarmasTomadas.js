// Punto único de verdad de QUÉ SIGNIFICA QUE ALGUIEN SE HAGA CARGO DE UNA ALARMA.
// ============================================================================
//
// QUÉ RESUELVE. Hoy una alarma repite hasta que el problema se resuelve, y nadie puede decir que la
// está atendiendo. Entonces pasan las dos cosas peores a la vez: quien la está atendiendo sigue
// recibiendo avisos de algo que ya tiene en la mano, y los demás no tienen forma de saber que
// alguien se ocupó, así que o se ocupan todos o no se ocupa nadie.
//
// «LA TOMO YO» NO ES «RESUELTO», Y NO SE PARECE. Resolver dice que el problema terminó. Tomarla
// dice que una persona se hizo cargo y está trabajando en eso: la alarma sigue abierta, sigue
// contando el tiempo, y el que la tomó queda escrito con nombre y hora. Si el problema se resuelve,
// se resuelve donde siempre; tomarla no cierra nada.
//
// LA TOMA VENCE, Y ÉSA ES LA PARTE IMPORTANTE. Una alarma que se calla para siempre porque alguien
// apretó un botón es peor que una que insiste: se apagaría sola justo el día en que esa persona
// tuvo que salir corriendo. Por eso hacerse cargo dura un rato —lo que cada Prestadora decida— y
// cuando ese rato termina, si el problema sigue abierto, la alarma vuelve como si nadie la hubiera
// tomado. Quien sigue trabajando en el asunto la vuelve a tomar; no hay penalidad en eso.
//
// QUÉ NO DECIDE ESTE ARCHIVO. No toma nada, no avisa y no resuelve nada. Contesta qué tipos de
// alarma existen, cuánto dura hacerse cargo de una y si una toma sigue en pie.
//
// Se copia entero al motor (`scripts/copias_entre_apps.mjs`), que es quien deja de insistir cuando
// una alarma está tomada. Por eso no importa nada del Panel.

/**
 * Las clases de alarma de las que alguien se puede hacer cargo.
 *
 * El valor es lo guardado y no cambia nunca; la fila a la que apunta cada una vive en su propia
 * tabla y la toma guarda su identificador. No hay una tabla única de alarmas, y no hace falta:
 * lo único que las cuatro comparten es que insisten hasta que alguien las atiende.
 */
export const TIPOS_DE_ALARMA = {
  /** Alguien avisó que una Asistente no llega, o la cuenta dice que no llega. */
  ALERTA_TEMPRANA: 'alerta_temprana_guardia',
  /** Un relevo que no apareció y dejó a alguien adentro esperando. */
  INCIDENTE_RELEVO: 'incidente_relevo',
  /** Un turno que terminó y nadie cerró. */
  GUARDIA_SIN_CERRAR: 'guardia_sin_cerrar',
  /** Un turno que se acerca sin nadie asignado. */
  TURNO_SIN_CUBRIR: 'incidente_turno_sin_cubrir',
};

export const TIPOS_DE_ALARMA_POSIBLES = Object.values(TIPOS_DE_ALARMA);

/** Si este nombre de tipo es uno de los que el producto conoce. */
export function esTipoDeAlarma(tipo) {
  return TIPOS_DE_ALARMA_POSIBLES.includes(tipo);
}

/** Cuánto dura hacerse cargo de una alarma. Valor de fábrica. */
export const REGLA_DE_LA_TOMA = {
  /** Minutos que la alarma deja de insistir desde que alguien la toma. */
  minutos_que_dura_hacerse_cargo: 60,
};

/** Entre qué valores se puede correr cada número de la regla. */
export const REGLA_QUE_SE_PUEDE_TOCAR = {
  // El mínimo son cinco minutos porque el proceso de fondo mira cada cinco: por debajo de eso el
  // número no cambiaría nada y quien lo configuró creería que sí. El máximo es un día, porque una
  // alarma que queda muda más de un día dejó de ser una alarma.
  minutos_que_dura_hacerse_cargo: { minimo: 5, maximo: 1440 },
};

const MS_POR_MINUTO = 60 * 1000;

/** Los números con los que se toma una alarma, con lo que esta Prestadora haya corrido encima. */
export function reglaDeLaTomaDe(configuracion) {
  const regla = { ...REGLA_DE_LA_TOMA };
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
    if (valor === REGLA_DE_LA_TOMA[clave]) continue;
    corridos[clave] = valor;
  }
  return corridos;
}

/** Hasta qué momento queda tomada una alarma que se toma ahora. */
export function hastaCuandoDura(ahora = new Date(), regla = REGLA_DE_LA_TOMA) {
  const minutos = reglaDeLaTomaDe(regla).minutos_que_dura_hacerse_cargo;
  return new Date(ahora.getTime() + minutos * MS_POR_MINUTO);
}

/**
 * Si esta toma sigue en pie.
 *
 * Dos formas de dejar de estarlo, y las dos importan: que la persona la haya soltado a mano, y que
 * se le haya cumplido el rato. La segunda es la que impide que una alarma quede muda para siempre.
 *
 * EL RATO SE VUELVE A MEDIR ACÁ, y no se cree lo que dice la fila. La hora de vencimiento la
 * escribe el Panel al tomar la alarma, o sea el navegador de una persona: si alguien mandara una
 * fecha de dentro de un año, la alarma quedaría muda un año. Entonces vale la que venza antes: la
 * escrita, o la que sale de contar desde que se tomó los minutos que decidió la Prestadora.
 */
export function tomaVigente(toma, ahora = new Date(), regla = REGLA_DE_LA_TOMA) {
  if (!toma || !toma.vence_at) return false;
  if (toma.soltada_at) return false;
  const vence = new Date(toma.vence_at);
  if (Number.isNaN(vence.getTime())) return false;
  const tomada = new Date(toma.tomada_at ?? toma.vence_at);
  if (Number.isNaN(tomada.getTime())) return false;
  const tope = hastaCuandoDura(tomada, regla);
  return Math.min(vence.getTime(), tope.getTime()) > ahora.getTime();
}

/**
 * De una lista de tomas, a qué alarmas alcanza una que siga en pie.
 *
 * Devuelve identificadores de las filas alarmadas —no de las tomas—, porque es lo que pregunta
 * quien recorre: «¿de ésta ya se hizo cargo alguien?».
 */
export function alarmasTomadas(tomas, ahora = new Date(), regla = REGLA_DE_LA_TOMA) {
  const tomadas = new Set();
  for (const toma of tomas ?? []) {
    if (tomaVigente(toma, ahora, regla)) tomadas.add(toma.referencia_id);
  }
  return tomadas;
}

/** Cuántos minutos le quedan a una toma antes de que la alarma vuelva. Nunca negativo. */
export function minutosQueLeQuedan(toma, ahora = new Date(), regla = REGLA_DE_LA_TOMA) {
  if (!tomaVigente(toma, ahora, regla)) return 0;
  const vence = Math.min(
    new Date(toma.vence_at).getTime(),
    hastaCuandoDura(new Date(toma.tomada_at ?? toma.vence_at), regla).getTime()
  );
  return Math.max(0, Math.round((vence - ahora.getTime()) / MS_POR_MINUTO));
}
