/* En qué orden va a pasar cada cosa cuando un relevo no se resuelve.

   QUÉ PROBLEMA RESUELVE. La escalada tiene tres escalones —insistirle a quien coordina, pasar a
   su respaldo, y salir a buscar quién cubre— y cuál va antes que cuál no está escrito en ningún
   lado: lo decide el minuto que la Prestadora le puso a cada uno. Eso es exactamente lo que pedía
   el PRD: que el orden dependa de la premura y no sea el mismo para todas
   (`docs/PRD_06_WhatsApp_IA.md:162`). Pero configurarlo son dos campos numéricos sueltos, y quien
   los carga no ve lo que acaba de armar. Esta función arma esa frase.

   NO DECIDE NADA. Ordena para mostrar. Quien ejecuta es el motor
   (`backend/src/utils/revisarNotificacionesCoordinador.js`), y no lee esto: cada escalón mira su
   propio umbral contra los minutos que lleva el incidente. Si algún día hiciera falta que el
   motor recorriera una secuencia, esta función es la que tiene que subir al motor, no una copia.

   VIVE ACÁ, EN lib/, porque es una regla que se puede probar sola, sin abrir un navegador. */

/** La insistencia no espera nada: empieza con el incidente. */
const MINUTO_EN_QUE_EMPIEZA_LA_INSISTENCIA = 0;

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
 *          faseAutomaticaActiva?: boolean, minutosAntesFaseAutomatica?: number|string}} config
 * @returns {Array<{clave: 'insistencia'|'respaldo'|'fase_automatica', minuto: number|null}>}
 */
export function ordenDeLaEscalada(config = {}) {
  const escalones = [{ clave: 'insistencia', minuto: MINUTO_EN_QUE_EMPIEZA_LA_INSISTENCIA }];

  if (config.coordinadorBackupId) {
    escalones.push({ clave: 'respaldo', minuto: enMinutos(config.minutosAntesBackup) });
  }
  if (config.faseAutomaticaActiva) {
    escalones.push({ clave: 'fase_automatica', minuto: enMinutos(config.minutosAntesFaseAutomatica) });
  }

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
