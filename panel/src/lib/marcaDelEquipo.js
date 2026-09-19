import { IDENTIDAD } from '../config/identidadProducto';

/* La marca de este aparato.
   ==========================================================================

   QUÉ ES. Un texto al azar que el motor emite y que este navegador guarda. Sirve para una sola
   cosa: que el motor pueda contestar «desde acá ya se entró antes» y no pedir el código del
   teléfono en cada entrada.

   QUÉ NO ES. No es una credencial y sola no deja entrar a nadie: se mira **después** de que la
   sesión ya está hecha. Y no es una huella del aparato: no se mira el navegador, ni la pantalla, ni
   dónde está esa persona. Nada de eso se consulta, y por eso este archivo no tiene con qué.

   DÓNDE SE GUARDA. En el almacenamiento local de este navegador, con el prefijo técnico del
   producto, que es el mismo que usan las demás cosas que persisten. Borrarlo no rompe nada: la
   próxima entrada se trata como si fuera desde un aparato nuevo, que es exactamente lo que es
   desde el punto de vista del motor.

   El almacenamiento local puede estar bloqueado —ventana privada, permisos del navegador—, y
   entonces las dos funciones no hacen nada y no se rompen. Quien esté en esa situación escribe el
   código en cada entrada, que es molesto pero seguro. */

const CLAVE = `${IDENTIDAD.codigo}_marca_del_equipo`;

export function marcaGuardada() {
  try {
    return window.localStorage.getItem(CLAVE) || null;
  } catch {
    return null;
  }
}

export function guardarMarca(marca) {
  if (!marca) return;
  try {
    window.localStorage.setItem(CLAVE, marca);
  } catch {
    // Sin almacenamiento, este aparato vuelve a ser nuevo la próxima vez. No hay nada que hacer.
  }
}
