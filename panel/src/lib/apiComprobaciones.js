import { llamadorDe } from './apiPanel';

/* Las rutas del pase de guardia vistas desde la Prestadora (pendiente #113).
   ==========================================================================

   POR QUÉ PASA POR EL MOTOR Y NO POR LA BASE. Casi todas las pantallas del Panel consultan la
   base directo desde el navegador. Ésta no puede: soltar el código de un solo uso significa
   generarlo, guardar solamente su huella y devolverlo una única vez. Si eso lo hiciera el
   navegador, el código habría que guardarlo en claro para poder compararlo después, que es
   justo lo que la huella viene a evitar. Lo mismo vale para cerrar una llegada sin comprobar:
   quién la cerró lo tiene que escribir el motor con la sesión, nunca la pantalla con un dato
   que ella misma manda.

   El `fetch`, la sesión, los encabezados y el manejo del error están escritos una sola vez en
   `apiPanel.js`. Acá queda solamente el camino.

   @param {string} path  Lo que va después de `/api/panel/comprobaciones`, empezando con `/`.
   @param {object} opciones  Lo mismo que acepta `fetch`. */
export const llamarApiComprobaciones = llamadorDe('/comprobaciones');
