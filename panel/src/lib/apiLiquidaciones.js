import { supabase } from './supabaseClient';
import { errorDeLaRespuesta } from './errores';

/* Un solo camino hacia las rutas de Liquidaciones del backend.
   ==========================================================================

   POR QUÉ EXISTE. Lo que se le liquida a un Asistente lo arma el motor, no el navegador: la
   cuenta usa la escala legal vigente a la fecha del período y tiene que quedar congelada,
   así que se hace de un lado solo. El Panel pide y muestra; no calcula ni escribe importes.

   Y por qué es un archivo y no una función adentro de la pantalla: la dirección y los
   encabezados son los mismos para las seis rutas y para las dos solapas que las usan. Escrito
   dos veces, el día que cambie una se separan (regla 12 de CLAUDE.md §7). Es el mismo molde
   de `apiConfiguracion.js`, con otro camino. */

const API_URL = import.meta.env.VITE_API_URL;

/**
 * @param {string} path  Lo que va después de `/api/panel/liquidaciones`, empezando con `/`.
 * @param {object} opciones  Lo mismo que acepta `fetch`.
 * @returns {Promise<object>} La respuesta ya convertida. Si el backend contesta un error, se
 *                            levanta una excepción que `lib/errores.js` sabe explicar.
 */
export async function llamarApiLiquidaciones(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/liquidaciones${path}`, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session?.access_token}`,
      ...opciones.headers,
    },
  });
  // Una baja puede contestar sin cuerpo, y una caída del servidor puede contestar una página
  // de error que no es JSON. En los dos casos lo que importa es el número de la respuesta, y
  // romperse acá al leer el cuerpo taparía justamente ese dato.
  const resultado = await respuesta.json().catch(() => ({}));
  // El número de la respuesta viaja con el error: es lo que le permite a lib/errores.js
  // distinguir una sesión vencida (401) de un permiso que falta (403) sin leer el texto.
  if (!respuesta.ok) throw errorDeLaRespuesta(respuesta, resultado);
  return resultado;
}
