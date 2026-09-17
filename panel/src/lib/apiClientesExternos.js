import { llamadorDe } from './apiPanel';

/* Las rutas del apareo con el cliente del otro software.
   ==========================================================================

   Lo único que hay acá es el camino. El `fetch`, la sesión, los encabezados y el manejo del error
   están escritos una sola vez en `apiPanel.js`.

   @param {string} path  Lo que va después de `/api/panel/clientes-externos`, empezando con `/`.
   @param {object} opciones  Lo mismo que acepta `fetch`. */
export const llamarApiClientesExternos = llamadorDe('/clientes-externos');
