// Adaptador de Argentina — API Georef, el servicio de direcciones del Estado argentino
// (datos.gob.ar). Es oficial, gratuito y abierto: no pide clave, ni cuenta, ni contrato, así
// que no hay ninguna credencial que guardar ni que rotar para esto.
//
// De Georef se usan tres recursos. `/direcciones` convierte una dirección escrita en un punto del
// mapa. `/localidades` y `/provincias` alimentan la lista de lugares de cada Prestadora.
//
// **Georef no tiene un recurso de barrios, y no hace falta.** En la Ciudad de Buenos Aires sus
// «localidades» son justamente los barrios —Saavedra, Constitución, Villa Urquiza, Monserrat,
// Retiro—, y en el resto del país son las localidades. Por eso del lado del producto entran todas
// a la misma lista de un solo nivel: son lo mismo para lo que se usan, que es decir dónde. El
// barrio que Georef no tiene lo agrega la Prestadora colgándolo de su localidad.
//
// La dirección base sale de una variable de entorno con valor por descarte, igual que
// `MERCADOPAGO_API_BASE` en `pasarelas/mercadopago.js`: en producción no se configura nada y
// se usa la oficial; en las pruebas se apunta a un servidor de mentira. El nombre de la
// variable es el que usa el tercero (CLAUDE.md §7 regla 13, excepción acotada).

const API_BASE = process.env.GEOREF_API_BASE || 'https://apis.datos.gob.ar/georef/api';

/** Cuánto se le espera al servicio antes de seguir sin coordenadas. Del otro lado hay alguien
 *  dando de alta a una persona y esperando que la pantalla conteste: las coordenadas son una
 *  comodidad y no valen tener a esa persona mirando una ruedita. */
const ESPERA_MS = 5000;

/** Queda escrito en el resultado para que se sepa de dónde salió el punto. Se nombra por lo
 *  que es y no cambia (CLAUDE.md §7 regla 13). */
export const FUENTE = 'georef_ar';

/** Le pregunta a Georef y devuelve lo que contestó, ya convertido. Existe para que las tres
 *  consultas traten igual la espera, la caída del servicio y la respuesta ilegible: son la misma
 *  decisión repetida, y una sola función la sostiene (CLAUDE.md §8). */
async function preguntarle(recurso, consulta) {
  let respuesta;
  try {
    respuesta = await fetch(`${API_BASE}/${recurso}?${consulta}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch {
    // Lo que lanza `fetch` cuando no llega a destino se descarta a propósito y se reemplaza por
    // una frase propia: el domicilio viaja adentro de la dirección consultada, y un error que
    // la arrastre termina copiado en el registro del servidor (CLAUDE.md §6).
    throw new Error('No se pudo consultar el servicio de direcciones');
  }
  if (!respuesta.ok) {
    throw new Error(`El servicio de direcciones contestó ${respuesta.status}`);
  }
  return (await respuesta.json().catch(() => null)) ?? {};
}

export async function geocodificar({ direccion, localidad, provincia }) {
  const buscada = String(direccion ?? '').trim();
  if (!buscada) return null;

  // `max=1` porque esto no es un buscador: se pregunta por una dirección concreta y se quiere
  // la que Georef considera mejor. Localidad y provincia van solo si se saben, y sirven para
  // desempatar: la misma calle con el mismo número existe en decenas de partidos.
  const consulta = new URLSearchParams({ direccion: buscada, max: '1' });
  const conLocalidad = String(localidad ?? '').trim();
  const conProvincia = String(provincia ?? '').trim();
  if (conLocalidad) consulta.set('localidad', conLocalidad);
  if (conProvincia) consulta.set('provincia', conProvincia);

  const datos = await preguntarle('direcciones', consulta);
  const encontrada = datos?.direcciones?.[0];
  const lat = encontrada?.ubicacion?.lat;
  const lng = encontrada?.ubicacion?.lon;
  // Georef contesta 200 con la lista vacía cuando no reconoce la dirección, y cuando reconoce
  // la calle sin poder ubicarla devuelve la fila con las dos coordenadas en nulo. En los dos
  // casos no hay punto, que no es un error. Se exige que sean números de verdad: `null`
  // convertido a número da cero, que es una coordenada válida en el Golfo de Guinea.
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  // Georef devuelve la altura que logró ubicar sobre la calle. Cuando viene, el punto es la
  // puerta; cuando viene en nulo, reconoció la calle pero no el número, y el punto es un lugar
  // cualquiera de la cuadra.
  const altura = encontrada?.altura?.valor;
  const ubicoLaPuerta = typeof altura === 'number' && Number.isFinite(altura);

  return {
    lat,
    lng,
    confianza: ubicoLaPuerta ? 'exacta' : 'aproximada',
    fuente: FUENTE,
  };
}

/** Cuántos lugares se traen de una búsqueda. Es una lista para elegir, no un padrón para
 *  recorrer: quien la mira escribe unas letras y espera reconocer el suyo entre pocos renglones. */
const LUGARES_POR_BUSQUEDA = 25;

/**
 * Los lugares de Argentina que coinciden con lo que se escribió, para que la Prestadora los
 * agregue a su lista.
 *
 * **Se consulta para cargar, y nunca en vivo.** El renglón queda guardado con su identificador,
 * su nombre y su punto; de ahí en más el producto trabaja contra su propia lista y no depende de
 * que el servicio del Estado esté levantado para armar una guardia.
 *
 * `provincia` es opcional y sirve para desempatar, que es lo corriente: hay un Belgrano en
 * varias. Devuelve la lista vacía cuando no reconoce nada, que no es un error.
 */
export async function buscarLugares({ texto, provincia } = {}) {
  const buscado = String(texto ?? '').trim();
  if (!buscado) return [];

  const consulta = new URLSearchParams({ nombre: buscado, max: String(LUGARES_POR_BUSQUEDA) });
  const enProvincia = String(provincia ?? '').trim();
  if (enProvincia) consulta.set('provincia', enProvincia);

  const datos = await preguntarle('localidades', consulta);
  const encontrados = Array.isArray(datos?.localidades) ? datos.localidades : [];

  return encontrados
    .filter((lugar) => lugar?.id && lugar?.nombre)
    .map((lugar) => {
      const lat = lugar?.centroide?.lat;
      const lng = lugar?.centroide?.lon;
      // Mismo cuidado que con las direcciones: `null` convertido a número da cero, y cero es una
      // coordenada válida en el Golfo de Guinea. Sin punto no se inventa ninguno.
      const tienePunto = Number.isFinite(lat) && Number.isFinite(lng);
      return {
        idOficial: String(lugar.id),
        nombre: String(lugar.nombre),
        provincia: lugar?.provincia?.nombre ?? null,
        municipio: lugar?.municipio?.nombre ?? null,
        lat: tienePunto ? lat : null,
        lng: tienePunto ? lng : null,
        fuente: FUENTE,
      };
    });
}

/** Las provincias de Argentina, para el casillero que acota la búsqueda. Son veinticuatro y no
 *  cambian, así que se piden todas de una vez y no se filtran por texto. */
export async function listarProvincias() {
  const datos = await preguntarle('provincias', new URLSearchParams({ campos: 'id,nombre', max: '30' }));
  const encontradas = Array.isArray(datos?.provincias) ? datos.provincias : [];
  return encontradas
    .filter((provincia) => provincia?.id && provincia?.nombre)
    .map((provincia) => ({ idOficial: String(provincia.id), nombre: String(provincia.nombre) }));
}
