// Adaptador de Argentina — API Georef, el servicio de direcciones del Estado argentino
// (datos.gob.ar). Es oficial, gratuito y abierto: no pide clave, ni cuenta, ni contrato, así
// que no hay ninguna credencial que guardar ni que rotar para esto.
//
// De todo lo que sabe contestar Georef acá se usa un solo recurso, `/direcciones`: se le manda
// una dirección escrita como la escribiría una persona y devuelve, si la reconoce, la calle
// normalizada, la provincia, la localidad y el punto en el mapa.
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

  let respuesta;
  try {
    respuesta = await fetch(`${API_BASE}/direcciones?${consulta}`, {
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

  const datos = await respuesta.json().catch(() => null);
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
