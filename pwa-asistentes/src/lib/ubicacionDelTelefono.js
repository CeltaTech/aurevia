// Dónde está el teléfono ahora mismo, preguntado una sola vez y escrito en un solo lugar.
//
// La misma pregunta la hacen tres actos del turno —marcar la llegada, cerrar la guardia y avisar
// que se sale hacia el domicilio (pendiente #101)—, y con la condición escrita en cada pantalla
// alcanzaba con que una se olvidara del tiempo de espera para que se quedara colgada esperando
// un GPS que nunca contesta (CLAUDE.md §8, «ningún patrón repetido sin punto único de verdad»).
//
// FALLA CON UN CÓDIGO Y NO CON UN VALOR VACÍO, a propósito: un cero en la latitud es un punto
// real en el Atlántico, y una función que devolviera «no sé» como un par de números dejaría que
// el que llama lo guarde sin darse cuenta. Quien llama decide qué hace con ese error: la llegada
// lo muestra y no se marca, la salida lo ignora y se registra igual.
//
// Y LOS DOS FALLOS NO SON EL MISMO, que es lo que este archivo distingue: una cosa es que la
// persona no haya dado el permiso —eso lo arregla ella, en la configuración del teléfono— y otra
// muy distinta es que el aparato no haya podido ubicarse, que es lo que pasa adentro de un
// edificio con el GPS encendido. Decirle «active el GPS» a quien lo tiene activado la manda a
// buscar una perilla que ya está puesta, y la deja parada en la puerta.
//
// LA UBICACIÓN NO SE ESCRIBE EN NINGÚN LADO acá: ni en el registro de la consola, ni adentro del
// error. Es dato sensible, y un error se copia y se pega en cualquier parte.

/** La persona no dio el permiso de ubicación, o lo retiró. */
export const UBICACION_NEGADA = 'ubicacion_negada';

/** El permiso está dado y aun así el aparato no pudo ubicarse: sin señal, o se acabó la espera. */
export const UBICACION_NO_DISPONIBLE = 'ubicacion_no_disponible';

/** Los dos fallos, para quien tenga que recorrerlos. */
export const FALLOS_DE_UBICACION = [UBICACION_NEGADA, UBICACION_NO_DISPONIBLE];

// Cuánto se espera al GPS antes de darlo por no disponible. Diez segundos parados en la puerta
// ya son muchos; más que eso, la pantalla parece rota.
const ESPERA_MAXIMA_MS = 10000;

// El código 1 del navegador (`PERMISSION_DENIED`) es el único que habla de la persona. El 2
// (`POSITION_UNAVAILABLE`) y el 3 (`TIMEOUT`) hablan del aparato, y para quien está parado en la
// puerta los dos son lo mismo: no pudo.
const CODIGO_PERMISO_NEGADO = 1;

/**
 * ¿Este error es uno de los dos fallos de ubicación?
 *
 * Falla cerrado: cualquier otra cosa no se toma por fallo de ubicación y sigue su camino, que es
 * el de los errores del motor.
 */
export function esFalloDeUbicacion(error) {
  return FALLOS_DE_UBICACION.includes(error?.message);
}

export function obtenerUbicacion() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      // Un navegador sin geolocalización no le negó nada a nadie: no puede.
      reject(new Error(UBICACION_NO_DISPONIBLE));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (posicion) => resolve({ lat: posicion.coords.latitude, lng: posicion.coords.longitude }),
      (fallo) => reject(new Error(fallo?.code === CODIGO_PERMISO_NEGADO ? UBICACION_NEGADA : UBICACION_NO_DISPONIBLE)),
      { enableHighAccuracy: true, timeout: ESPERA_MAXIMA_MS },
    );
  });
}
