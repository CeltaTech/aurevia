// La marca de la Prestadora, guardada para cuando la aplicación no está abierta.
//
// Los avisos que llegan al teléfono los muestra el service worker (`sw.js`), que
// corre por su cuenta: no tiene la sesión abierta ni puede preguntarle nada al
// servidor. Entonces la aplicación deja acá el nombre de la Prestadora cada vez
// que lo recibe, y el service worker lo lee de acá cuando tiene que mostrar un
// aviso sin título propio.
//
// Se usa el depósito del navegador (Cache) y no `localStorage` porque es el
// único de los dos que el service worker puede leer.

const DEPOSITO = 'marca-de-la-prestadora';
const CLAVE = '/marca-de-la-prestadora.json';

export async function guardarMarca(marca) {
  if (typeof caches === 'undefined' || !marca?.nombre) return;
  try {
    const deposito = await caches.open(DEPOSITO);
    await deposito.put(CLAVE, new Response(JSON.stringify(marca)));
  } catch {
    // Guardar la marca es una comodidad, no una función. Si el navegador no deja
    // (modo privado, depósito lleno), el aviso igual llega con el título que
    // manda el servidor.
  }
}

export async function leerMarcaGuardada() {
  if (typeof caches === 'undefined') return null;
  try {
    const deposito = await caches.open(DEPOSITO);
    const guardado = await deposito.match(CLAVE);
    return guardado ? await guardado.json() : null;
  } catch {
    return null;
  }
}
