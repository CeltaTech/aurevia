import { supabase } from '../db/connection.js';
import { CATALOGO_CIRCULO_FAMILIAR, accesosEfectivos } from './catalogoCirculoFamiliar.js';
import { visibilidadDelPedido } from './visibilidadPrestadora.js';

// Qué le dejaron ver a esta persona del círculo familiar. Es la única lectura de
// `permisos_circulo_familiar` que hace la aplicación de las Familias, y devuelve siempre las once
// claves resueltas —no las filas crudas—, para que ninguna ruta tenga que acordarse por su cuenta
// del valor de fábrica ni del tope de la Prestadora.
//
// Entramos con la llave maestra del servidor, así que las políticas de la base no nos frenan: el
// filtro va escrito acá a mano, como en el resto del motor. Las políticas dicen lo mismo y son la
// segunda red.
//
// El titular no se consulta: ve todo, siempre, y esa decisión no se configura.
export async function accesosDeLaPersona({ usuarioId, familiaId, esTitular, visibilidad }) {
  if (esTitular) {
    return accesosEfectivos({ esTitular: true, visibilidad });
  }

  // Se pide por la Familia y por la persona, que es la clave entera de la tabla. Hoy nadie está
  // anotado en dos círculos —cada persona tiene una sola fila de membresía—, pero preguntar por
  // media clave es de esas cosas que funcionan hasta el día que dejan de funcionar, y ese día
  // devolvería los accesos que otro titular le dio en otra Familia.
  const { data } = await supabase
    .from('permisos_circulo_familiar')
    .select('clave, permitido')
    .eq('familia_id', familiaId)
    .eq('usuario_id', usuarioId);

  return accesosEfectivos({ esTitular: false, filasGuardadas: data, visibilidad });
}

// Lo mismo, pero contestando una sola vez por pedido: hay rutas que lo necesitan dos veces (para
// cortar el acceso y después para armar la respuesta) y no tiene sentido volver a preguntarle a la
// base en el mismo pedido. Mismo patrón que `visibilidadDelPedido`.
export async function accesosDelPedido(req) {
  if (!req.accesosDelCirculo) {
    const visibilidad = await visibilidadDelPedido(req);
    req.accesosDelCirculo = await accesosDeLaPersona({
      usuarioId: req.usuarioFamilia?.id,
      familiaId: req.usuarioFamilia?.familiaId,
      esTitular: req.usuarioFamilia?.esTitular === true,
      visibilidad,
    });
  }
  return req.accesosDelCirculo;
}

// Corta el pedido cuando el titular no le dio ese acceso a esta persona. Va en la cadena de la
// ruta, después del middleware de sesión y después de `exigeVisible`, que es el tope de la
// Prestadora: primero se pregunta si la función existe en esta aplicación, y recién después si
// esta persona la tiene.
//
// Es el candado del lado del motor. La aplicación ya sabe qué no le dieron y no dibuja la pantalla,
// pero alguien puede llamar a la dirección igual. Sin esto, la instrucción firmada sería una
// decoración.
//
// El motivo viaja aparte del texto porque los dos casos se explican distinto: `no_disponible` es
// «la Prestadora no ofrece esto», y `sin_acceso` es «esto existe, pero a usted no se lo dieron».
// Meterlos en la misma frase deja a la persona buscando un botón que no le van a habilitar nunca.
export function exigeDelCirculo(clave) {
  return async (req, res, next) => {
    const accesos = await accesosDelPedido(req);
    if (!accesos[clave]) {
      return res.status(403).json({ error: 'No tiene acceso a esta función', motivo: 'sin_acceso' });
    }
    next();
  };
}

// Deja pasar solamente al titular. Lo usan las tres rutas de la firma: la hoja dice, persona por
// persona, qué se le dio y qué se le negó a cada uno del círculo, y eso es del titular. Además es
// él quien firma, así que nadie más tiene por qué pedir el código ni confirmarlo.
//
// Va acá y no repetido ruta por ruta porque es la misma decisión: escrita tres veces, alcanza con
// que alguien agregue una cuarta ruta y se olvide para que un miembro del círculo pueda firmar la
// instrucción que le recorta los accesos a él mismo.
export function soloElTitular(req, res, next) {
  if (req.usuarioFamilia?.esTitular !== true) {
    return res.status(403).json({ error: 'No tiene acceso a esta función', motivo: 'sin_acceso' });
  }
  next();
}

// Lo que esta Prestadora muestra, recortado por lo que le dieron a esta persona.
//
// Hay accesos del círculo que no son una pantalla entera sino una columna adentro de una que sí se
// muestra: la posición del Asistente vive adentro de la guardia, y la medicación de ese día, adentro
// del reporte. Cortar la ruta ahí sería sacarle la guardia entera a quien sí puede ver la agenda.
//
// Los dos topes son la misma decisión —qué de esto se muestra— aplicada uno arriba del otro:
// primero lo que la Prestadora ofrece y encima lo que el titular pidió para esta persona. Como la
// consulta arma sus columnas con `columnasSegunVisibilidad`, alcanza con darle esto en lugar de la
// visibilidad cruda y la columna negada ni siquiera sale de la base.
//
// Sólo se recortan las claves del catálogo que tienen interruptor, que son justamente las que se
// corresponden con una columna. Las otras —los reportes, la agenda, la ficha, las internaciones—
// son la consulta entera, y las corta `exigeDelCirculo` en la puerta de la ruta.
//
// Ojo con confundirla con la visibilidad cruda: la que viaja en `/perfil` para que la aplicación
// dibuje el menú es la de la Prestadora, y los accesos van al lado, aparte. Son dos respuestas
// distintas a dos preguntas distintas.
export async function visibilidadDeLaPersona(req) {
  if (!req.visibilidadRecortada) {
    const visibilidad = await visibilidadDelPedido(req);

    if (req.usuarioFamilia?.esTitular) {
      req.visibilidadRecortada = visibilidad;
    } else {
      const accesos = await accesosDelPedido(req);
      const recortada = { ...visibilidad };
      for (const cosa of CATALOGO_CIRCULO_FAMILIAR) {
        if (cosa.interruptor && accesos[cosa.clave] === false) {
          recortada[cosa.interruptor] = false;
        }
      }
      req.visibilidadRecortada = recortada;
    }
  }
  return req.visibilidadRecortada;
}
