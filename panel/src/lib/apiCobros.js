import { supabase } from './supabaseClient';
import { errorDeLaRespuesta } from './errores';

/* Un solo camino hacia las rutas de Cobros del backend.
   ==========================================================================

   POR QUÉ EXISTE. El saldo de una Familia es una resta —lo facturado menos lo cobrado— y esa
   resta se hace en un solo lugar, del lado de la base. El navegador no la rehace: pide y
   muestra. Si la hiciera acá habría dos cuentas que pueden dar distinto, y la que se ve en
   pantalla sería la que nadie puede auditar.

   Y por qué es un archivo y no una función adentro de la pantalla: la dirección y los
   encabezados son los mismos para las cinco rutas. Escrito dos veces, el día que cambie una se
   separan (regla 12 de CLAUDE.md §7). Es el mismo molde de `apiLiquidaciones.js`, con otro
   camino. */

const API_URL = import.meta.env.VITE_API_URL;

/**
 * @param {string} path  Lo que va después de `/api/panel/cobros`, empezando con `/`.
 * @param {object} opciones  Lo mismo que acepta `fetch`.
 * @returns {Promise<object>} La respuesta ya convertida. Si el backend contesta un error, se
 *                            levanta una excepción que `lib/errores.js` sabe explicar.
 */
export async function llamarApiCobros(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/cobros${path}`, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session?.access_token}`,
      ...opciones.headers,
    },
  });
  // Una caída del servidor puede contestar una página de error que no es JSON. Lo que importa
  // ahí es el número de la respuesta, y romperse al leer el cuerpo taparía justamente ese dato.
  const resultado = await respuesta.json().catch(() => ({}));
  // El número de la respuesta viaja con el error: es lo que le permite a lib/errores.js
  // distinguir una sesión vencida (401) de un permiso que falta (403) sin leer el texto.
  if (!respuesta.ok) throw errorDeLaRespuesta(respuesta, resultado);
  return resultado;
}
