import { supabase } from '../db/connection.js';

// De qué Prestadora es un pedido que llega sin sesión: los dos formularios del sitio público de
// una Prestadora —pedir un servicio, postularse como Asistente— y los datos de contacto que ese
// sitio muestra.
//
// **La Prestadora sale de la dirección, nunca de un encabezado.** Antes se deducía de `Origin`,
// `Referer` o `Host`: un navegador los manda solos, pero cualquier otro programa los escribe a
// mano, así que quien mandaba el pedido elegía en qué Prestadora escribir. Y cuando ninguno
// coincidía —lo normal detrás de un proxy, que reemplaza el `Host` por el suyo— se asumía la
// única Prestadora pública que hubiera, que es adivinar y deja de funcionar en cuanto hay dos.
// Ahora el identificador viaja en la propia dirección del formulario
// (`/api/publico/:prestadora/…`), lo escribe el sitio de esa Prestadora, y un pedido que no
// resuelve se rechaza en vez de asumir una.
//
// El identificador público es el dominio del sitio de la Prestadora: ya vive en
// `configuracion_prestadora.dominio`, es único, y lo configura ella misma desde el Panel.
//
// Lo que esto **no** hace: un formulario público sigue siendo abierto por definición, y cualquiera
// puede mandarle datos inventados a la Prestadora que quiera. Lo que se termina acá es que el
// destino lo elija un encabezado ajeno o una adivinanza del servidor.
export async function resolverPrestadoraPublica(req, res, next) {
  const identificador = String(req.params.prestadora || '')
    .trim()
    .toLowerCase()
    .replace(/^www\./, '');

  if (!identificador) {
    return res.status(404).json({ error: 'prestadora_no_reconocida' });
  }

  const { data, error } = await supabase
    .from('configuracion_prestadora')
    .select('*')
    .eq('dominio', identificador)
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'prestadora_no_reconocida' });

  req.prestadoraPublica = data;
  return next();
}
