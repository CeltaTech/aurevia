/* El día y la hora de una entrevista, entre el campo del navegador y el motor.
   ==========================================================================

   POR QUÉ ESTÁ APARTE. Un campo de fecha y hora del navegador habla en la hora de quien está
   mirando la pantalla y escribe `2026-10-07T10:00`, sin decir de qué huso es. El motor guarda un
   instante en formato universal. La conversión de ida y la de vuelta tienen que ser la misma o la
   cita se corre: se guarda una hora, se vuelve a abrir el formulario y dice otra.

   Escrito adentro del componente esto no se podía probar sin dibujar la pantalla, que es
   justamente donde el error no se ve. Acá son dos funciones sueltas, y la prueba las hace ir y
   volver. */

/** Del instante que guarda el motor al texto que espera el campo, en la hora de quien mira.
 *  Devuelve texto vacío cuando no hay nada que mostrar: un campo no puede quedar con «undefined». */
export function paraElCampo(iso) {
  if (!iso) return '';
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  // `toISOString` siempre habla en universal, así que primero se le corre la diferencia del huso
  // de quien mira: así los dieciséis caracteres que quedan son la hora que esa persona ve.
  const alRas = new Date(fecha.getTime() - fecha.getTimezoneOffset() * 60 * 1000);
  return alRas.toISOString().slice(0, 16);
}

/** Del texto del campo al instante que entiende el motor. Devuelve `null` cuando no se entiende,
 *  y quien llama no manda nada: una fecha a medio escribir no es una cita. */
export function desdeElCampo(valor) {
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime()) ? null : fecha.toISOString();
}
