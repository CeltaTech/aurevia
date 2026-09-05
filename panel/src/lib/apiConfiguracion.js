import { llamadorDe } from './apiPanel';

/* Las rutas de Configuración del motor.
   ==========================================================================

   POR QUÉ EXISTE. Hay ajustes de la Prestadora que el navegador no puede escribir aunque el
   usuario tenga permiso en la pantalla: viven en la tabla `prestadoras`, que por regla de
   aislamiento solo el superadmin puede modificar. El motor sí puede, porque usa una clave con
   más alcance y acota siempre a la Prestadora de quien pide.

   Lo único que queda acá es el camino. El `fetch`, la sesión, los encabezados y el manejo del
   error están escritos una sola vez en `apiPanel.js`.

   @param {string} path  Lo que va después de `/api/panel/configuracion`, empezando con `/`.
   @param {object} opciones  Lo mismo que acepta `fetch`. */
export const llamarApiConfiguracion = llamadorDe('/configuracion');
