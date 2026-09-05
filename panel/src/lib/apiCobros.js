import { llamadorDe } from './apiPanel';

/* Las rutas de Cobros del motor.
   ==========================================================================

   POR QUÉ EXISTE. El saldo de una Familia es una resta —lo facturado menos lo cobrado— y esa
   resta se hace en un solo lugar, del lado de la base. El navegador no la rehace: pide y
   muestra. Si la hiciera acá habría dos cuentas que pueden dar distinto, y la que se ve en
   pantalla sería la que nadie puede auditar.

   Lo único que queda acá es el camino. El `fetch`, la sesión, los encabezados y el manejo del
   error están escritos una sola vez en `apiPanel.js`.

   @param {string} path  Lo que va después de `/api/panel/cobros`, empezando con `/`.
   @param {object} opciones  Lo mismo que acepta `fetch`. */
export const llamarApiCobros = llamadorDe('/cobros');
