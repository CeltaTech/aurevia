// Cuentas de calendario del motor, escritas una sola vez.
//
// POR QUÉ EXISTE. Sumar días a una fecha parece tan simple que cada archivo se lo escribía
// solo, y así estaba: la generación de series de guardias tenía su propia copia. Dos copias
// de la misma cuenta es una que se arregla y otra que queda mal (regla 12 de CLAUDE.md §7).
//
// TODO SE CUENTA EN UTC, A PROPÓSITO. Una fecha de guardia (`2026-08-20`) es un día del
// calendario, no un momento: no tiene hora ni huso. Si se la convirtiera al huso del servidor,
// el mismo día daría distinto según dónde esté encendida la máquina, y eso es exactamente lo
// que no puede pasar en un producto que corre para Prestadoras de varios países. Anclando en
// UTC, sumar un día es siempre sumar un día.
//
// QUÉ NO ESTÁ ACÁ: "hoy". La fecha de hoy depende del reloj de quien pregunta, no del servidor,
// y por eso viaja desde el teléfono en el pedido. Ver `pwa-familias/src/lib/horarios.js`.

const DIAS_POR_SEMANA = 7;

/**
 * ¿Este texto es una fecha del calendario, escrita como la guarda la base (`2026-08-20`)?
 *
 * Se comprueba la forma y además que la fecha exista de verdad: `2026-02-31` tiene la forma
 * correcta y no es ningún día. Sin esta segunda parte, un pedido con una fecha inventada
 * arrastraría un `Invalid Date` hasta la consulta y la respuesta saldría vacía sin explicación.
 */
export function esFechaISO(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const fecha = new Date(`${texto}T00:00:00Z`);
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === texto;
}

/** Suma (o resta, con número negativo) días a una fecha `2026-08-20`. */
export function sumarDias(fechaISO, dias) {
  const fecha = new Date(`${fechaISO}T00:00:00Z`);
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/**
 * La semana entera que contiene a ese día.
 *
 * POR QUÉ LA SEMANA SE ARMA ACÁ Y NO EN LA PANTALLA. La agenda se mira de a semanas y se
 * camina hacia atrás y hacia adelante. La consulta a la base, el título que dice qué semana
 * se está viendo y los dos botones de mover tienen que hablar de la misma semana; si cada uno
 * se hiciera su propia cuenta, alcanzaría con que uno empezara la semana un día distinto para
 * que la Familia leyera una semana y viera otra.
 *
 * LA SEMANA EMPIEZA EL LUNES. Es cómo se lee un calendario en los países donde hoy se usa el
 * producto, y lo que muestra el teléfono de cualquiera de esas personas. No es un parámetro de
 * configuración de la Prestadora: no describe cómo trabaja una empresa, describe el calendario.
 *
 * Devuelve los siete días ya escritos —no solamente los extremos— porque la pantalla dibuja un
 * renglón por día, incluidos los días sin ninguna guardia: "el jueves no viene nadie" también
 * es una respuesta, y es de las que evitan una llamada.
 */
export function semanaQueContiene(diaISO) {
  const dia = new Date(`${diaISO}T00:00:00Z`);
  // getUTCDay(): 0 es domingo y 6 es sábado. Corriendo dos lugares, el lunes queda en 0 y el
  // domingo pasa a ser el séptimo día, que es el orden en el que se lee la semana.
  const corrimiento = (dia.getUTCDay() + 6) % DIAS_POR_SEMANA;
  const lunes = sumarDias(diaISO, -corrimiento);
  const dias = Array.from({ length: DIAS_POR_SEMANA }, (_, i) => sumarDias(lunes, i));

  return {
    desde: lunes,
    hasta: dias[DIAS_POR_SEMANA - 1],
    dias,
    // Los dos días con los que se vuelve a pedir la semana de al lado. Van armados desde acá
    // para que la pantalla no tenga que saber cuántos días tiene una semana.
    semanaAnterior: sumarDias(lunes, -DIAS_POR_SEMANA),
    semanaSiguiente: sumarDias(lunes, DIAS_POR_SEMANA),
  };
}
