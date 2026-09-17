/* En qué orden va a pasar cada cosa cuando una alarma no se resuelve, y hasta dónde sube.

   QUÉ PROBLEMA RESUELVE. La escalada tiene varios escalones —insistirle a quien coordina, pasar a
   su respaldo, salir a buscar quién cubre, avisarle a todos los Coordinadores, avisarle a la
   administración— y cuál va antes que cuál no está escrito en ningún lado: lo decide el minuto que
   la Prestadora le puso a cada uno. Eso es exactamente lo que pedía el PRD: que el orden dependa de
   la premura y no sea el mismo para todas (`docs/PRD_06_WhatsApp_IA.md:162`). Pero configurarlo son
   campos numéricos sueltos, y quien los carga no ve lo que acaba de armar. `ordenDeLaEscalada()`
   arma esa frase.

   Y EL MOTOR TAMBIÉN LEE ACÁ. Hasta los dos escalones de arriba cada uno miraba su propio umbral
   por su cuenta y este archivo era sólo para mostrar. Los dos últimos son iguales entre sí y valen
   para las cuatro clases de alarma, así que la pregunta «¿a qué escalones ya llegó una alarma que
   lleva tantos minutos?» se contesta una sola vez, acá, y el motor la usa
   (`escalonesQueCorresponden()`). Por eso el archivo se copia entero al motor
   (`scripts/copias_entre_apps.mjs`) y no importa nada del Panel.

   LO QUE ACÁ NO PASA. No se avisa, no se decide a quién, no se guarda nada. Quién recibe cada
   escalón y la constancia de que salió son del motor
   (`backend/src/utils/avisosDeEscalon.js`).

   VIVE ACÁ, EN lib/, porque es una regla que se puede probar sola, sin abrir un navegador. */

/** La insistencia no espera nada: empieza con el incidente. */
const MINUTO_EN_QUE_EMPIEZA_LA_INSISTENCIA = 0;

/**
 * Los escalones que dejan constancia de haber salido, tal como se guardan.
 *
 * El del respaldo está en la lista aunque hoy siga marcándose en la columna de su propia tabla: la
 * mudanza obligaría a reescribir lo ya avisado de las alarmas abiertas, y una alarma abierta que
 * pierde la marca vuelve a avisar como si nadie se hubiera enterado. El nombre queda puesto para el
 * día que se mude.
 */
export const ESCALONES = {
  RESPALDO: 'coordinador_respaldo',
  TODOS_LOS_COORDINADORES: 'todos_los_coordinadores',
  ADMINISTRACION: 'administracion',
};

export const ESCALONES_POSIBLES = Object.values(ESCALONES);

/** Si este nombre de escalón es uno de los que el producto conoce. */
export function esEscalon(escalon) {
  return ESCALONES_POSIBLES.includes(escalon);
}

/**
 * Qué columna de la configuración lleva el minuto de cada escalón que este archivo resuelve.
 *
 * Los dos que no están —la insistencia y la fase automática— no se resuelven acá: la insistencia
 * empieza con la alarma y no tiene minuto, y la fase automática sale del incidente de relevo y de
 * ninguna otra clase de alarma.
 */
export const MINUTO_DE_CADA_ESCALON = {
  [ESCALONES.TODOS_LOS_COORDINADORES]: 'minutos_antes_todos_los_coordinadores',
  [ESCALONES.ADMINISTRACION]: 'minutos_antes_administracion',
};

/** Entre qué valores se puede correr el minuto de cada uno de esos dos escalones. */
export const MINUTOS_QUE_SE_PUEDEN_TOCAR = {
  // El mínimo son cinco minutos porque el proceso de fondo mira cada cinco: por debajo de eso el
  // número no cambiaría nada y quien lo configuró creería que sí.
  //
  // El máximo del aviso a todos los Coordinadores es un día, porque una alarma que tarda más de un
  // día en llegarle al resto del equipo ya no le sirve a nadie. El de la administración son tres
  // días, el mismo tope que el aviso grave de guardia sin cerrar: a esa altura lo que se está
  // escalando no es una urgencia de turno, es un servicio que no se prestó.
  minutos_antes_todos_los_coordinadores: { minimo: 5, maximo: 1440 },
  minutos_antes_administracion: { minimo: 5, maximo: 4320 },
};

/**
 * A qué escalones ya llegó una alarma que lleva estos minutos sin resolverse.
 *
 * Devuelve los dos si el rato alcanza para los dos: no se sube de a uno por vuelta. El proceso de
 * fondo corre cada pocos minutos y puede haber estado caído; hacerlo subir un escalón por vuelta
 * significaría que una alarma de ayer todavía estuviera avisando al escalón de hace horas.
 *
 * Un escalón sin minuto está apagado y no aparece nunca. Lo que sale de acá es lo que corresponde
 * por el reloj, no lo que falta avisar: de eso ya salió y de eso no, lo sabe el motor.
 *
 * @param {object} config La fila de `configuracion_escalada_coordinador`.
 * @param {number} minutosPremura Minutos desde que la alarma empezó.
 */
export function escalonesQueCorresponden(config, minutosPremura) {
  const alcanzados = [];
  if (!Number.isFinite(minutosPremura)) return alcanzados;

  for (const [escalon, columna] of Object.entries(MINUTO_DE_CADA_ESCALON)) {
    const minuto = enMinutos(config?.[columna]);
    if (minuto === null) continue;
    if (minutosPremura >= minuto) alcanzados.push(escalon);
  }

  // En el orden en que se alcanzaron, que con el mismo minuto es el de arriba: primero el equipo,
  // después la administración. Sumarle a la administración un aviso que el equipo todavía no vio
  // sería hacer subir un problema antes de que nadie haya podido bajarlo.
  return alcanzados.sort(
    (a, b) => enMinutos(config?.[MINUTO_DE_CADA_ESCALON[a]]) - enMinutos(config?.[MINUTO_DE_CADA_ESCALON[b]])
  );
}

const enMinutos = (valor) => {
  // El campo vacío no es el minuto cero: es un campo que todavía no dice nada. `Number('')` da 0,
  // y si se lo dejara pasar, borrar el campo movería el escalón al principio de la lista.
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
};

/**
 * Los escalones encendidos, del primero que va a pasar al último.
 *
 * Un escalón apagado no aparece: sin respaldo elegido no hay a quién pasarle el aviso, y sin la
 * fase automática activada el sistema no toma ninguna acción por su cuenta. Los que quedaron sin
 * un minuto legible van al final, porque no se puede decir cuándo pasan.
 *
 * @param {{coordinadorBackupId?: string|null, minutosAntesBackup?: number|string,
 *          faseAutomaticaActiva?: boolean, minutosAntesFaseAutomatica?: number|string,
 *          minutosAntesTodosLosCoordinadores?: number|string|null,
 *          minutosAntesAdministracion?: number|string|null}} config
 * @returns {Array<{clave: string, minuto: number|null}>}
 */
export function ordenDeLaEscalada(config = {}) {
  const escalones = [{ clave: 'insistencia', minuto: MINUTO_EN_QUE_EMPIEZA_LA_INSISTENCIA }];

  if (config.coordinadorBackupId) {
    escalones.push({ clave: 'respaldo', minuto: enMinutos(config.minutosAntesBackup) });
  }
  if (config.faseAutomaticaActiva) {
    escalones.push({ clave: 'fase_automatica', minuto: enMinutos(config.minutosAntesFaseAutomatica) });
  }

  // Estos dos no tienen un interruptor aparte: el minuto vacío es el interruptor. No hay a quién
  // elegir —son todos los Coordinadores, y es la administración— así que un campo más para decir
  // que sí sería un campo para decir dos veces lo mismo.
  const todos = enMinutos(config.minutosAntesTodosLosCoordinadores);
  if (todos !== null) escalones.push({ clave: 'todos_los_coordinadores', minuto: todos });

  const administracion = enMinutos(config.minutosAntesAdministracion);
  if (administracion !== null) escalones.push({ clave: 'administracion', minuto: administracion });

  // El orden de llegada desempata: dos escalones puestos en el mismo minuto salen los dos, y en
  // el orden en que están escritos acá, que es el que usa el motor dentro de una misma pasada.
  return escalones
    .map((escalon, llegada) => ({ ...escalon, llegada }))
    .sort((a, b) => {
      if (a.minuto === null) return b.minuto === null ? a.llegada - b.llegada : 1;
      if (b.minuto === null) return -1;
      return a.minuto - b.minuto || a.llegada - b.llegada;
    })
    .map(({ clave, minuto }) => ({ clave, minuto }));
}
