import { llamadorDe } from './apiPanel';

/* La biblioteca que la Prestadora escribe para sus Familias.
   ==========================================================================

   Lo que va después de `/api/panel/contenidos`. El `fetch`, la sesión, los encabezados y el
   manejo del error están escritos una sola vez en `apiPanel.js`.

   @param {string} path  Lo que va después de `/api/panel/contenidos`, empezando con `/`.
   @param {object} opciones  Lo mismo que acepta `fetch`. */
export const llamarApiContenidos = llamadorDe('/contenidos');
