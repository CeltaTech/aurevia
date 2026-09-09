// Dónde está el teléfono ahora mismo, preguntado una sola vez y escrito en un solo lugar.
//
// La misma pregunta la hacen tres actos del turno —marcar la llegada, cerrar la guardia y avisar
// que se sale hacia el domicilio (pendiente #101)—, y con la condición escrita en cada pantalla
// alcanzaba con que una se olvidara del tiempo de espera para que se quedara colgada esperando
// un GPS que nunca contesta (CLAUDE.md §8, «ningún patrón repetido sin punto único de verdad»).
//
// FALLA CON `sin_geo` Y NO CON UN VALOR VACÍO, a propósito: un cero en la latitud es un punto
// real en el Atlántico, y una función que devolviera «no sé» como un par de números dejaría que
// el que llama lo guarde sin darse cuenta. Quien llama decide qué hace con ese error: la llegada
// lo muestra y no se marca, la salida lo ignora y se registra igual.

// Cuánto se espera al GPS antes de darlo por no disponible. Diez segundos parados en la puerta
// ya son muchos; más que eso, la pantalla parece rota.
const ESPERA_MAXIMA_MS = 10000;

export function obtenerUbicacion() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('sin_geo'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (posicion) => resolve({ lat: posicion.coords.latitude, lng: posicion.coords.longitude }),
      () => reject(new Error('sin_geo')),
      { enableHighAccuracy: true, timeout: ESPERA_MAXIMA_MS },
    );
  });
}
