import { supabase } from './supabaseClient';
import { errorDeLaRespuesta } from './errores';

/* El único camino del Panel hacia el motor.
   ==========================================================================

   POR QUÉ EXISTE. Todas las llamadas del Panel al motor hacen exactamente lo mismo: buscan la
   sesión, arman la dirección, ponen el encabezado de autorización y el tipo de contenido, leen
   la respuesta y, si no salió bien, levantan un error con el número adentro para que
   `lib/errores.js` sepa distinguir una sesión vencida de un permiso que falta.

   Eso estaba escrito tres veces —`apiConfiguracion.js`, `apiCobros.js` y
   `apiLiquidaciones.js`—, y las tres copias ya se habían separado: las dos últimas leen el
   cuerpo con `.catch(() => ({}))`, así que sobreviven a una caída del servidor que conteste una
   página de error en vez de JSON; la primera no, y ahí se rompía al leer el cuerpo justo cuando
   lo único que importaba era el número. Exactamente lo que advierte «ningún patrón repetido sin
   punto único de verdad» (CLAUDE.md §8): tres copias, tres comentarios diciendo que no había que
   copiarlas, y una ya distinta de las otras dos.

   Ahora se escribe una sola vez, acá, con la versión que aguanta las dos formas de fallar. Cada
   familia de rutas se queda con su nombre propio —`llamarApiCobros` y compañía— porque la
   pantalla no tiene por qué saber el camino entero; lo que ya no tiene es su propia copia del
   `fetch`. */

const API_URL = import.meta.env.VITE_API_URL;

/**
 * @param {string} path  Lo que va después de `/api/panel`, empezando con `/`.
 * @param {object} opciones  Lo mismo que acepta `fetch`.
 * @returns {Promise<object>} La respuesta ya convertida. Si el motor contesta un error, se
 *                            levanta una excepción que `lib/errores.js` sabe explicar.
 */
export async function llamarApiPanel(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel${path}`, {
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

/**
 * El mismo camino, atado a una familia de rutas.
 *
 * `llamadorDe('/cobros')` devuelve una función que recibe lo que va después de
 * `/api/panel/cobros`. Sirve para que una pantalla que usa cinco rutas de la misma familia no
 * repita el prefijo cinco veces y no pueda equivocarse en una.
 */
export function llamadorDe(prefijo) {
  return (path, opciones) => llamarApiPanel(`${prefijo}${path}`, opciones);
}
