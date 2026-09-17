import { llamadorDe } from './apiPanel';

/* Dónde trabaja cada persona.
   ==========================================================================

   La lista de lugares para elegir, los lugares donde una Asistente acepta trabajar y hasta dónde
   llega una coordinadora. Es un camino aparte del de Configuración a propósito: cargar la lista es
   de la administración, elegir de ella la hace también quien coordina.

   @param {string} path  Lo que va después de `/api/panel/lugares-de-trabajo`, empezando con `/`.
   @param {object} opciones  Lo mismo que acepta `fetch`. */
export const llamarApiLugaresDeTrabajo = llamadorDe('/lugares-de-trabajo');
