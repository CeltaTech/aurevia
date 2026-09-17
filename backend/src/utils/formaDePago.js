// ---------------------------------------------------------------------------
// formaDePago.js — con qué se mide el trabajo de cada Asistente, y qué es una hora extra
//
// POR QUÉ EXISTE ESTE ARCHIVO. Hasta ahora la forma de pago no existía: la deducía el código
// del tipo de vínculo. Quien estaba en relación de dependencia cobraba un sueldo fijo, y
// cualquier otro cobraba horas por valor hora. No había manera de pagarle a alguien por
// guardia ni por semana, y sobre todo no había manera de pagarle una hora de más: la
// Asistente que se quedaba tres horas después de su turno no cobraba nada por ellas.
//
// LAS DOS COSAS QUE NO SON LO MISMO. Con qué se mide el trabajo —por hora, por guardia, por
// semana o por mes— es esto. Cada cuánto se le paga —los viernes, a treinta días— es otra
// cosa, se arregla con cada persona y no cambia ni un centavo de esta cuenta. Acá está sólo
// la medición.
//
// DE DÓNDE SALEN LAS HORAS EXTRA, Y DE DÓNDE NO. Salen de lo que se anotó en la guardia
// cuando pasó. NO salen de restarle a la marca de salida la hora de fin planificada: irse
// media hora tarde porque el relevo se demoró no es una hora extra autorizada, y calcularlas
// así convertiría cualquier demora en plata sin que nadie lo haya decidido.
//
// Y TAMPOCO HAY JORNADA NORMAL DE OCHO HORAS. Existen guardias de veinticuatro, cuarenta y
// ocho y setenta y dos horas cubiertas por una sola persona. Un tope de jornada convertiría
// casi toda guardia larga en horas extra, que es exactamente lo contrario de lo que significan.
//
// NO IMPORTA NADA A PROPÓSITO. Este archivo lo usa el Panel y el motor usa una copia generada
// (`backend/src/utils/formaDePago.js`, ver `scripts/copias_entre_apps.mjs`), y lo que se copia
// al motor no puede traerse medio Panel atrás.
// ---------------------------------------------------------------------------

/** Con qué se mide el trabajo. Son identificadores guardados: no se renombran nunca. */
export const UNIDADES = {
  HORA: 'hora',
  GUARDIA: 'guardia',
  SEMANA: 'semana',
  MES: 'mes',
};

export const UNIDADES_POSIBLES = Object.values(UNIDADES);

/** En qué columna de la ficha de remuneración vive el valor de cada unidad. */
export const COLUMNA_DEL_VALOR = {
  [UNIDADES.HORA]: 'valor_hora',
  [UNIDADES.GUARDIA]: 'valor_guardia',
  [UNIDADES.SEMANA]: 'valor_semana',
  [UNIDADES.MES]: 'sueldo_basico',
};

/**
 * Qué unidad le corresponde a una ficha que todavía no eligió ninguna.
 *
 * Es exactamente lo que hacía el código antes de que la forma de pago se pudiera elegir, y
 * está acá para que una ficha vieja siga liquidando igual que el mes pasado. Ninguna ficha
 * nueva pasa por esto: la unidad se elige al cargarla.
 */
export const UNIDAD_POR_VINCULO = {
  dependencia: UNIDADES.MES,
  monotributo: UNIDADES.HORA,
};

/** Un día tiene una sola forma de contarse; una semana, siete días. No es una decisión. */
export const DIAS_DE_UNA_SEMANA = 7;

/**
 * Lo que cada Prestadora puede correr, y con qué arranca.
 *
 * Prorratear quiere decir que a quien cobra un monto fijo, el mes en que entra o se va se le
 * paga la parte de los días que estuvo. Viene puesto porque es lo corriente en una
 * liquidación, y se puede apagar.
 */
export const REGLA_DE_PAGO = {
  prorratear_monto_fijo: true,
};

export const REGLA_DE_PAGO_QUE_SE_PUEDE_TOCAR = {
  prorratear_monto_fijo: { tipo: 'booleano' },
};

/** La regla que rige, que es la de fábrica con lo que esta Prestadora haya corrido encima. */
export function reglaDePagoDe(corrida) {
  const regla = { ...REGLA_DE_PAGO };
  for (const clave of Object.keys(REGLA_DE_PAGO)) {
    const valor = corrida?.[clave];
    if (typeof valor === 'boolean') regla[clave] = valor;
  }
  return regla;
}

/** Avisa qué valor está mal antes de guardarlo, con la clave para poder nombrarlo. */
export function revisarReglaDePago(corrida) {
  for (const [clave, valor] of Object.entries(corrida ?? {})) {
    const borde = REGLA_DE_PAGO_QUE_SE_PUEDE_TOCAR[clave];
    if (!borde) return { ok: false, clave };
    if (borde.tipo === 'booleano' && typeof valor !== 'boolean') return { ok: false, clave };
  }
  return { ok: true };
}

/**
 * Sólo lo que difiere de fábrica.
 *
 * Guardar lo que coincide con fábrica congelaría a esa Prestadora el día que el valor de
 * fábrica cambie: quedaría con el viejo sin haber decidido nada.
 */
export function soloLoQueCorreDelPago(regla) {
  const corridos = {};
  for (const [clave, valor] of Object.entries(regla ?? {})) {
    if (!(clave in REGLA_DE_PAGO)) continue;
    if (valor !== REGLA_DE_PAGO[clave]) corridos[clave] = valor;
  }
  return corridos;
}

/** Un monto fijo se paga esté la persona o no; lo demás se paga por lo que hizo. */
export function esMontoFijo(unidad) {
  return unidad === UNIDADES.SEMANA || unidad === UNIDADES.MES;
}

/**
 * Con qué se le mide el trabajo a esta persona.
 *
 * Recibe la ficha entera —lo que cobra y su vínculo vienen juntos en la mano de quien liquida—
 * porque una ficha que todavía no eligió unidad se resuelve mirando el vínculo.
 */
export function unidadDeMedicionDe(ficha) {
  const elegida = ficha?.unidad_medicion;
  if (UNIDADES_POSIBLES.includes(elegida)) return elegida;
  return UNIDAD_POR_VINCULO[ficha?.tipo_vinculo] ?? UNIDADES.HORA;
}

/**
 * Cuánto vale una unidad para esta persona.
 *
 * Devuelve `null` cuando la ficha no lo tiene cargado, y no cero: un cero se lee como «no se
 * le paga nada», que es una afirmación distinta de «no sabemos cuánto».
 */
export function valorDeLaUnidad(pago, unidad) {
  const crudo = pago?.[COLUMNA_DEL_VALOR[unidad]];
  if (crudo === null || crudo === undefined || crudo === '') return null;
  return Number(crudo);
}

/** Cuánto se le paga la hora de más a esta persona. Puede ser igual o distinto al normal. */
export function valorDeLaHoraExtra(pago) {
  const crudo = pago?.valor_hora_extra;
  if (crudo === null || crudo === undefined || crudo === '') return null;
  return Number(crudo);
}

/** Cuántos días hay entre dos fechas `AAAA-MM-DD`, contando los dos extremos. */
export function diasEntre(desde, hasta) {
  const ida = enMedianoche(desde);
  const vuelta = enMedianoche(hasta);
  if (vuelta < ida) return 0;
  return Math.round((vuelta - ida) / MILISEGUNDOS_DE_UN_DIA) + 1;
}

const MILISEGUNDOS_DE_UN_DIA = 86400000;

// En hora universal a propósito: una fecha de alta no tiene hora, y construirla en la hora
// local del navegador haría que el mismo día diera un día distinto según dónde esté quien mira.
function enMedianoche(fecha) {
  const [anio, mes, dia] = fecha.split('-').map(Number);
  return Date.UTC(anio, mes - 1, dia);
}

/**
 * Cuántos días del período estuvo esta persona en la Prestadora.
 *
 * Sin prorrateo el período cuenta entero, que es lo que hacía el sistema hasta ahora: el
 * sueldo fijo se pagaba completo sin mirar desde cuándo estaba.
 */
export function diasCubiertos({ desde, hasta, fechaAlta, fechaBaja, prorratear }) {
  if (!prorratear) return diasEntre(desde, hasta);
  const arranca = fechaAlta && fechaAlta > desde ? fechaAlta : desde;
  const termina = fechaBaja && fechaBaja < hasta ? fechaBaja : hasta;
  return diasEntre(arranca, termina);
}

/**
 * Cuántas unidades se le pagan a esta persona en el período, y de ahí sale el importe.
 *
 * Por hora y por guardia, lo que hizo. Por mes, la parte del período que estuvo. Por semana,
 * los días que estuvo divididos por siete: el período que se liquida es un mes y el valor es
 * semanal, así que hay una conversión, y no hay más que una forma de hacerla.
 */
export function unidadesDelPeriodo({ unidad, acumulado, diasDelPeriodo, diasDeLaPersona }) {
  if (unidad === UNIDADES.HORA) return acumulado?.horas ?? 0;
  if (unidad === UNIDADES.GUARDIA) return acumulado?.guardias ?? 0;
  if (unidad === UNIDADES.SEMANA) return diasDeLaPersona / DIAS_DE_UNA_SEMANA;
  if (!diasDelPeriodo) return 0;
  return diasDeLaPersona / diasDelPeriodo;
}
