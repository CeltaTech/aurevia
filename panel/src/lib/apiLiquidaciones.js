import { llamadorDe } from './apiPanel';

/* Las rutas de Liquidaciones del motor.
   ==========================================================================

   POR QUÉ EXISTE. Lo que se le liquida a un Asistente lo arma el motor, no el navegador: la
   cuenta usa la escala legal vigente a la fecha del período y tiene que quedar congelada, así
   que se hace de un lado solo. El Panel pide y muestra; no calcula ni escribe importes.

   Lo único que queda acá es el camino. El `fetch`, la sesión, los encabezados y el manejo del
   error están escritos una sola vez en `apiPanel.js`.

   @param {string} path  Lo que va después de `/api/panel/liquidaciones`, empezando con `/`.
   @param {object} opciones  Lo mismo que acepta `fetch`. */
export const llamarApiLiquidaciones = llamadorDe('/liquidaciones');
