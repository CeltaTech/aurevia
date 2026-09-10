/* La planilla que se acaba de leer, para que la pantalla siguiente no la lea otra vez.
   ==========================================================================

   POR QUÉ EXISTE. La guía de primeros pasos lee una planilla para proponer la configuración
   inicial, y de ahí se sigue a la pantalla de importación para revisar el mapeo y confirmar.
   Sin esto habría que volver a elegir el archivo y volver a leerlo: la misma espera dos veces,
   y una consulta más a la IA por el mismo contenido.

   POR QUÉ NO VIAJA EN EL ESTADO DE LA NAVEGACIÓN. Ahí van las filas enteras del archivo —hasta
   5 MB— y el historial del navegador tiene su propio tope, distinto en cada navegador; pasarlo
   rompe la navegación sin decir por qué. Acá es una variable del módulo: vive en la memoria de
   la pestaña, no se guarda en ningún lado y no sobrevive a una recarga.

   SE TOMA UNA SOLA VEZ. `tomar()` devuelve lo guardado y lo borra: si alguien entra después a
   la pantalla de importación por el menú, empieza de cero y elige su archivo, que es lo que
   corresponde. */

let guardada = null;

export function guardarPlanillaAnalizada(tipo, analisis) {
  guardada = { tipo, analisis };
}

export function tomarPlanillaAnalizada() {
  const valor = guardada;
  guardada = null;
  return valor;
}
