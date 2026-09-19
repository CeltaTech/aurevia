/**
 * LA HORA DEL HECHO LA PONE EL TELÉFONO, Y NO ES LA HORA EN QUE EL DATO LLEGÓ A LA BASE.
 *
 * Las dos son distintas y no se mezclan. Un aviso que estuvo media hora esperando señal ocurrió
 * cuando la persona lo apretó, no cuando volvió la red, y guardado con la hora de la
 * sincronización contaría mal lo que pasó. La hora de llegada la pone la base sola, en su propia
 * columna; ésta es la otra.
 *
 * SE ACEPTA SÓLO HACIA ATRÁS. El reloj del teléfono lo maneja quien lo tiene en la mano, así que
 * una hora futura es un reloj mal puesto —o algo peor— y con eso no se escribe nada: se usa la
 * hora del motor. Hacia atrás no hace falta tope: el dato que llega tarde es exactamente el caso
 * que esta función existe para no perder.
 *
 * Lo que no se puede leer como fecha tampoco decide nada. Ante un valor ausente, vacío o que no
 * es una fecha, queda la hora del motor: falla cerrado hacia el dato que el motor sí conoce.
 *
 * Esta decisión estaba escrita cuatro veces, una por ruta, con las mismas cuatro líneas copiadas.
 * Acá está una sola vez, y las rutas la consumen.
 */
export function horaDelHecho(delTelefono, ahora = Date.now()) {
  const leido = Date.parse(delTelefono ?? '');
  const referencia = Number.isFinite(ahora) ? ahora : Date.now();
  return new Date(Number.isNaN(leido) || leido > referencia ? referencia : leido).toISOString();
}
