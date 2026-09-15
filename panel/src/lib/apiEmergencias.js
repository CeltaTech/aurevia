import { llamadorDe } from './apiPanel';

/* Las emergencias avisadas desde una guardia.
   ==========================================================================

   Lo que va después de `/api/panel/emergencias`. El `fetch`, la sesión, los encabezados y el
   manejo del error están escritos una sola vez en `apiPanel.js`.

   @param {string} path  Lo que va después de `/api/panel/emergencias`, empezando con `/`.
   @param {object} opciones  Lo mismo que acepta `fetch`. */
export const llamarApiEmergencias = llamadorDe('/emergencias');
