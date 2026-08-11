import { supabase } from '../db/connection.js';
import { visibilidadDeFabrica, visibilidadEfectiva } from './catalogoVisibilidad.js';

// Qué muestra hoy la aplicación de esta Prestadora. Es la única lectura de
// `configuracion_visibilidad_app` que hacen las dos aplicaciones, y devuelve siempre las
// dieciocho claves resueltas —no las filas crudas—, para que ninguna ruta tenga que acordarse
// del valor de fábrica por su cuenta (CLAUDE.md §7 regla 12).
//
// Entramos con la llave maestra del servidor, así que las políticas de la base no nos frenan:
// el filtro por Prestadora va escrito acá a mano, como en el resto del motor.
export async function visibilidadDeLaPrestadora(prestadoraId) {
  if (!prestadoraId) {
    return visibilidadDeFabrica();
  }
  const { data } = await supabase
    .from('configuracion_visibilidad_app')
    .select('clave, visible')
    .eq('prestadora_id', prestadoraId);
  return visibilidadEfectiva(data);
}

// La Prestadora de quien está pidiendo. Los dos middlewares de sesión de teléfono
// —`requiereRolFamilia` y `requiereRolAsistente`— dejan uno y solo uno de estos dos objetos,
// así que preguntar por los dos acá evita repetir la misma función una vez por aplicación.
function prestadoraDelPedido(req) {
  return req.usuarioFamilia?.prestadoraId ?? req.usuarioAsistente?.prestadoraId ?? null;
}

// Lo mismo, pero contestando una sola vez por pedido: hay rutas que necesitan la lista dos
// veces (para cortar el acceso y después para armar la consulta) y no tiene sentido volver a
// preguntarle a la base en el mismo pedido.
export async function visibilidadDelPedido(req) {
  if (!req.visibilidadApp) {
    req.visibilidadApp = await visibilidadDeLaPrestadora(prestadoraDelPedido(req));
  }
  return req.visibilidadApp;
}

// Corta el pedido cuando la Prestadora apagó esa función. Va en la cadena de la ruta, después
// del middleware de sesión.
//
// Es el candado del lado del motor: la aplicación ya sabe qué está apagado y no dibuja el
// botón, pero alguien puede llamar a la dirección igual desde el navegador. Sin esto, apagar
// una función sería una decoración.
export function exigeVisible(clave) {
  return async (req, res, next) => {
    const visibilidad = await visibilidadDelPedido(req);
    if (!visibilidad[clave]) {
      return res.status(403).json({ error: 'Tu Prestadora no tiene esta función activada', motivo: 'no_disponible' });
    }
    next();
  };
}
