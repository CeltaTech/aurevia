import { supabase } from './supabaseClient';

/* Un solo camino hacia las rutas de Configuración del backend.
   ==========================================================================

   POR QUÉ EXISTE. Hay ajustes de la Prestadora que el navegador no puede escribir aunque el
   usuario tenga permiso en la pantalla: viven en la tabla `prestadoras`, que por regla de
   aislamiento solo el superadmin puede modificar. El backend sí puede, porque usa una clave
   con más alcance y acota siempre a la Prestadora de quien pide.

   La pantalla de Configuración ya tenía esta función escrita adentro. Cuando apareció una
   segunda pantalla que la necesitaba (la solapa de Tipos de Asistente), copiarla habría dejado
   dos versiones de la misma dirección y los mismos encabezados, listas para separarse el día
   que cambie una — que es exactamente lo que prohíbe la regla 12 de CLAUDE.md §7. */

const API_URL = import.meta.env.VITE_API_URL;

/**
 * @param {string} path  Lo que va después de `/api/panel/configuracion`, empezando con `/`.
 * @param {object} opciones  Lo mismo que acepta `fetch`.
 * @returns {Promise<object>} La respuesta ya convertida. Si el backend contesta un error, se
 *                            levanta una excepción con ese texto para que la pantalla lo muestre.
 */
export async function llamarApiConfiguracion(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/configuracion${path}`, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session?.access_token}`,
      ...opciones.headers,
    },
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) {
    const error = new Error(resultado.error);
    // El número de la respuesta viaja con el error: es lo que le permite a lib/errores.js
    // distinguir una sesión vencida (401) de un permiso que falta (403) sin leer el texto.
    error.status = respuesta.status;
    throw error;
  }
  return resultado;
}
