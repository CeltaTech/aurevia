// ---------------------------------------------------------------------------
// frecuenciaDePago.js — cada cuánto cobra cada Asistente, y qué período se le arma
//
// POR QUÉ EXISTE ESTE ARCHIVO. Hasta ahora esto no existía: el sistema daba por sentado que
// el período que se liquida es el mes calendario, del primero al último día. Ningún lugar
// permitía pagarle a alguien los viernes, ni cada quince días, ni pagarle el mes cerrado a
// treinta días de terminado. Lo que se arregla con cada persona cuando entra —y que es de las
// primeras cosas que se arreglan— no tenía dónde anotarse.
//
// LAS DOS COSAS QUE NO SON LO MISMO, Y ESTA ES LA SEGUNDA. Con qué se mide el trabajo —por
// hora, por guardia, por semana o por mes— está en `formaDePago.js`. Cada cuánto se cobra es
// esto. Son independientes: se le puede pagar por hora y cobrar por mes, o tener sueldo
// mensual y cobrar cada quince días.
//
// Y ESTE ARCHIVO NO TOCA UN SOLO IMPORTE. Sólo dice desde qué día hasta qué día va cada
// período y qué día se paga. Cuánto se paga adentro de ese período lo sigue resolviendo
// `calcularLiquidacion.js`, sin enterarse de dónde salieron los bordes.
//
// LA PRESTADORA DECIDE, EL PRODUCTO OFRECE LAS FORMAS. Acá están las formas y los valores de
// fábrica; cuál rige lo elige cada Prestadora en su configuración, y se puede correr persona
// por persona, porque con cada una se arregla distinto.
//
// NO IMPORTA NADA A PROPÓSITO. Este archivo lo usa el Panel y el motor usa una copia generada
// (`backend/src/utils/frecuenciaDePago.js`, ver `scripts/copias_entre_apps.mjs`), y lo que se
// copia al motor no puede traerse medio Panel atrás.
// ---------------------------------------------------------------------------

/** Cada cuánto se cierra un período. Son identificadores guardados: no se renombran nunca. */
export const FRECUENCIAS = {
  SEMANA: 'semana',
  QUINCENA: 'quincena',
  MES: 'mes',
};

export const FRECUENCIAS_POSIBLES = Object.values(FRECUENCIAS);

/** Los días de la semana, como los numera la norma internacional: 1 es lunes y 7 domingo. */
export const DIAS_DE_LA_SEMANA = { LUNES: 1, VIERNES: 5, DOMINGO: 7 };

const MILISEGUNDOS_DE_UN_DIA = 86400000;

// En hora universal a propósito: una fecha de período no tiene hora, y construirla en la hora
// local del navegador haría que el mismo día diera un día distinto según dónde esté quien mira.
function enMedianoche(fecha) {
  const [anio, mes, dia] = String(fecha).split('-').map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia));
}

const enTexto = (fecha) => fecha.toISOString().slice(0, 10);

const correrDias = (fecha, dias) => new Date(enMedianoche(fecha).getTime() + dias * MILISEGUNDOS_DE_UN_DIA);

/** La fecha que queda al correr tantos días, en texto. Negativo va para atrás. */
export function diaCorrido(fecha, dias) {
  return enTexto(correrDias(fecha, dias));
}

/** Qué día de la semana cae una fecha, del 1 al 7. El domingo de JavaScript es 0 y acá es 7. */
export function diaDeLaSemanaDe(fecha) {
  return enMedianoche(fecha).getUTCDay() || DIAS_DE_LA_SEMANA.DOMINGO;
}

/** El último día del mes al que pertenece esta fecha, sin tener que saber cuáles tienen 28. */
export function ultimoDiaDelMesDe(fecha) {
  const f = enMedianoche(fecha);
  return enTexto(new Date(Date.UTC(f.getUTCFullYear(), f.getUTCMonth() + 1, 0)));
}

/** El primer día del mes al que pertenece esta fecha. */
export function primerDiaDelMesDe(fecha) {
  return `${String(fecha).slice(0, 7)}-01`;
}

/**
 * Lo que cada Prestadora puede correr, y con qué arranca.
 *
 * El mes calendario, pagado al cierre, es exactamente lo que el sistema hacía hasta ahora: una
 * Prestadora que no toque nada sigue liquidando igual que el mes pasado.
 *
 * `dias_hasta_el_pago` es el plazo entre el día en que el período cierra y el día en que la
 * plata sale. Es lo que en el oficio se dice «a treinta días». En cero, se paga el mismo día
 * que cierra.
 */
export const FRECUENCIA_DE_PAGO = {
  cada_cuanto: FRECUENCIAS.MES,
  dia_de_corte: DIAS_DE_LA_SEMANA.VIERNES,
  dias_hasta_el_pago: 0,
};

/** Dentro de qué bordes puede moverse cada valor. Fuera de ellos, vale el de fábrica. */
export const FRECUENCIA_QUE_SE_PUEDE_TOCAR = {
  cada_cuanto: { tipo: 'lista', valores: FRECUENCIAS_POSIBLES },
  dia_de_corte: { tipo: 'entero', minimo: DIAS_DE_LA_SEMANA.LUNES, maximo: DIAS_DE_LA_SEMANA.DOMINGO },
  // Noventa días es plazo largo hasta para el peor de los casos, y un tope hace falta: sin él
  // un cero de más manda la fecha de pago a un año y medio y nadie lo nota hasta que alguien
  // reclama.
  dias_hasta_el_pago: { tipo: 'entero', minimo: 0, maximo: 90 },
};

const entraEnElBorde = (clave, valor) => {
  const borde = FRECUENCIA_QUE_SE_PUEDE_TOCAR[clave];
  if (!borde) return false;
  if (borde.tipo === 'lista') return borde.valores.includes(valor);
  return Number.isInteger(valor) && valor >= borde.minimo && valor <= borde.maximo;
};

/**
 * La frecuencia que rige para esta persona.
 *
 * Son tres capas, de la más general a la más particular: lo de fábrica, lo que corrió la
 * Prestadora, y lo que se arregló con esta persona. Cada capa pisa sólo lo que dice, así que
 * una persona con quien se arregló pagar los viernes conserva el plazo de pago de la
 * Prestadora sin tener que repetirlo.
 *
 * Un valor guardado fuera de borde se ignora en vez de romper: una liquidación que no se puede
 * generar es peor que una que sale con el valor de fábrica, y el borde se vuelve a revisar al
 * guardar.
 */
export function frecuenciaDePagoDe(deLaPrestadora, deLaPersona) {
  const frecuencia = { ...FRECUENCIA_DE_PAGO };
  for (const capa of [deLaPrestadora, deLaPersona]) {
    for (const clave of Object.keys(FRECUENCIA_DE_PAGO)) {
      const valor = capa?.[clave];
      if (valor !== undefined && entraEnElBorde(clave, valor)) frecuencia[clave] = valor;
    }
  }
  return frecuencia;
}

/** Avisa qué valor está mal antes de guardarlo, con la clave para poder nombrarlo. */
export function revisarFrecuenciaDePago(corrida) {
  for (const [clave, valor] of Object.entries(corrida ?? {})) {
    if (!entraEnElBorde(clave, valor)) return { ok: false, clave };
  }
  return { ok: true };
}

/**
 * Sólo lo que difiere de fábrica.
 *
 * Guardar lo que coincide con fábrica congelaría a esa Prestadora el día que el valor de
 * fábrica cambie: quedaría con el viejo sin haber decidido nada.
 */
export function soloLoQueCorreDeLaFrecuencia(frecuencia) {
  const corridos = {};
  for (const [clave, valor] of Object.entries(frecuencia ?? {})) {
    if (!(clave in FRECUENCIA_DE_PAGO)) continue;
    if (valor !== FRECUENCIA_DE_PAGO[clave]) corridos[clave] = valor;
  }
  return corridos;
}

/**
 * El período que contiene a esta fecha: desde qué día hasta qué día.
 *
 * - **Por mes**, el mes calendario entero.
 * - **Por quincena**, del 1 al 15 y del 16 al último día. Se parte por el número del día y no
 *   cada quince días corridos a partir de una fecha: contando corrido, las quincenas se van
 *   desfasando del mes y en diciembre nadie sabe qué días le tocan. Partiendo por el número,
 *   cada mes tiene sus dos mitades siempre en el mismo lugar.
 * - **Por semana**, la que termina el día de corte que eligió la Prestadora. Si el corte es el
 *   viernes, va de sábado a viernes.
 *
 * Los bordes no se cruzan y no dejan huecos: todo día del calendario pertenece a exactamente
 * un período. De eso depende que ninguna guardia se pague dos veces ni se quede sin pagar.
 */
export function periodoQueContiene(fecha, frecuencia) {
  const regla = frecuenciaDePagoDe(frecuencia);

  if (regla.cada_cuanto === FRECUENCIAS.MES) {
    return { desde: primerDiaDelMesDe(fecha), hasta: ultimoDiaDelMesDe(fecha) };
  }

  if (regla.cada_cuanto === FRECUENCIAS.QUINCENA) {
    const dia = Number(String(fecha).slice(8, 10));
    const mes = String(fecha).slice(0, 7);
    if (dia <= 15) return { desde: `${mes}-01`, hasta: `${mes}-15` };
    return { desde: `${mes}-16`, hasta: ultimoDiaDelMesDe(fecha) };
  }

  // Cuántos días faltan desde esta fecha hasta el próximo día de corte, contando que si la
  // fecha ES el día de corte, el período termina ahí mismo.
  const faltan = (regla.dia_de_corte - diaDeLaSemanaDe(fecha) + 7) % 7;
  const hasta = enTexto(correrDias(fecha, faltan));
  return { desde: enTexto(correrDias(hasta, -6)), hasta };
}

/** El período siguiente al que termina en esta fecha. */
export function periodoSiguienteA(periodo, frecuencia) {
  return periodoQueContiene(enTexto(correrDias(periodo.hasta, 1)), frecuencia);
}

/**
 * Todos los períodos que tocan el tramo pedido, en orden.
 *
 * Toca quiere decir que se superponen aunque sea un día: un período que arranca el 28 de un
 * mes y termina el 3 del siguiente aparece en los dos meses. Es a propósito — quien busca qué
 * se liquidó en marzo tiene que ver esa semana, aunque haya cerrado en abril.
 *
 * El tope de vueltas existe porque un tramo mal armado —el año 9999 por un dedo— colgaría la
 * pantalla sin decir por qué.
 */
export function periodosQueTocan(desde, hasta, frecuencia, topeDeVueltas = 1000) {
  if (!desde || !hasta || String(hasta) < String(desde)) return [];
  const periodos = [];
  let actual = periodoQueContiene(desde, frecuencia);
  for (let vuelta = 0; vuelta < topeDeVueltas; vuelta += 1) {
    periodos.push(actual);
    if (actual.hasta >= String(hasta)) return periodos;
    actual = periodoSiguienteA(actual, frecuencia);
  }
  return periodos;
}

/** Qué día se paga un período que cierra este día. */
export function fechaDePagoDe(periodo, frecuencia) {
  const regla = frecuenciaDePagoDe(frecuencia);
  return enTexto(correrDias(periodo.hasta, regla.dias_hasta_el_pago));
}

/**
 * Cuántos días de mes representa este período, para lo que se paga por mes.
 *
 * Hace falta porque un sueldo mensual cobrado por semana no es un sueldo por semana: las
 * cuatro o cinco liquidaciones de un mes tienen que sumar ese sueldo y no cuatro. Entonces la
 * parte que se paga sale de los días del período sobre los días del mes al que pertenecen, y
 * no sobre los días del período, que daría el sueldo entero cada vez.
 *
 * Un período que cruza dos meses se mide contra el mes en que empieza. Los meses tienen entre
 * 28 y 31 días, así que la alternativa —partir el período y medir cada mitad contra su mes—
 * cambia el resultado en centavos y obliga a explicar por qué dos semanas iguales pagaron
 * distinto. Se mide contra uno solo, y el mes en que el período empieza es el que contiene la
 * mayor parte del trabajo cuando el corte cae cerca del fin de mes.
 */
export function diasDelMesDelPeriodo(periodo) {
  return Number(ultimoDiaDelMesDe(periodo.desde).slice(8, 10));
}
