/**
 * Pruebas del camino entero de la geocodificación: de una dirección escrita a mano al par de
 * coordenadas que se guarda al lado, o a nada.
 *
 * Lo que se prueba es lo que se rompe de verdad: que **nunca** se caiga un alta por esto, que
 * **nunca** se invente un punto, y que la dirección —dato sensible— no termine copiada en el
 * registro del servidor.
 *
 * Se levantan dos servidores de mentira, igual que en `routes/__tests__/webhooksPasarelas.test.js`:
 * uno hace de base (contesta el país de la Prestadora) y otro hace de servicio de direcciones.
 * Las variables de entorno se dejan puestas ANTES de importar el módulo, porque tanto la
 * conexión a la base como la dirección del servicio se leen en el momento del import.
 *
 *   npm test --prefix backend
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const DIRECCION = 'Avenida Siempreviva 742';
const LOCALIDAD = 'Springfield';

/** Qué país contesta la base para esa Prestadora. Cada prueba pisa lo que necesita. */
let paisDeLaPrestadora = 'AR';
/** Todo lo que se le preguntó a la base. */
let consultasALaBase = [];

const baseFalsa = createServer((req, res) => {
  consultasALaBase.push(req.url);
  const filas = paisDeLaPrestadora === null ? [] : [{ pais: paisDeLaPrestadora }];
  const unoSolo = (req.headers.accept || '').includes('vnd.pgrst.object+json');
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(unoSolo ? filas[0] ?? null : filas));
});
await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

/** El servicio de direcciones de mentira: contesta lo que cada prueba le prepare. */
let respuestaDelServicio = {};
let codigoDelServicio = 200;
let consultasAlServicio = [];

const servicioFalso = createServer((req, res) => {
  consultasAlServicio.push(req.url);
  res.writeHead(codigoDelServicio, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(respuestaDelServicio));
});
await new Promise((listo) => servicioFalso.listen(0, '127.0.0.1', listo));
process.env.GEOREF_API_BASE = `http://127.0.0.1:${servicioFalso.address().port}`;

const { coordenadasDeDomicilio, obtenerGeocodificador, paisesConGeocodificador } =
  await import('../index.js');

// Lo que el motor deja anotado del lado del servidor se junta acá, para poder comprobar qué
// dice —y sobre todo qué no dice— sin ensuciar la salida de las pruebas.
let anotados = [];
const avisarDeVerdad = console.warn;
console.warn = (...partes) => anotados.push(partes.join(' '));

after(() => {
  console.warn = avisarDeVerdad;
  baseFalsa.close();
  servicioFalso.close();
});

/** Lo que contesta el servicio cuando reconoce la dirección hasta la puerta. */
function encontrada({ lat = -34.6037, lon = -58.3816, altura = 742 } = {}) {
  return {
    cantidad: 1,
    direcciones: [
      {
        altura: { unidad: null, valor: altura },
        calle: { categoria: 'CALLE', nombre: 'SIEMPREVIVA' },
        provincia: { nombre: 'Buenos Aires' },
        ubicacion: { lat, lon },
      },
    ],
  };
}

beforeEach(() => {
  paisDeLaPrestadora = 'AR';
  consultasALaBase = [];
  consultasAlServicio = [];
  respuestaDelServicio = encontrada();
  codigoDelServicio = 200;
  anotados = [];
});

describe('la dirección que el servicio reconoce', () => {
  it('vuelve con sus coordenadas', async () => {
    const ubicacion = await coordenadasDeDomicilio({
      prestadoraId: PRESTADORA,
      direccion: DIRECCION,
      localidad: LOCALIDAD,
    });
    assert.deepEqual(ubicacion, { lat: -34.6037, lng: -58.3816 });
  });

  it('se pregunta por esa dirección, con la localidad para desempatar y una sola respuesta', async () => {
    await coordenadasDeDomicilio({ prestadoraId: PRESTADORA, direccion: DIRECCION, localidad: LOCALIDAD });

    assert.equal(consultasAlServicio.length, 1);
    const consulta = new URL(consultasAlServicio[0], 'http://interno');
    assert.equal(consulta.pathname, '/direcciones');
    assert.equal(consulta.searchParams.get('direccion'), DIRECCION);
    assert.equal(consulta.searchParams.get('localidad'), LOCALIDAD);
    assert.equal(consulta.searchParams.get('max'), '1');
  });

  it('sin localidad ni provincia no se mandan esos datos vacíos', async () => {
    await coordenadasDeDomicilio({ prestadoraId: PRESTADORA, direccion: DIRECCION });

    const consulta = new URL(consultasAlServicio[0], 'http://interno');
    assert.equal(consulta.searchParams.has('localidad'), false);
    assert.equal(consulta.searchParams.has('provincia'), false);
  });

  it('el adaptador devuelve además hasta dónde llegó y de dónde salió el punto', async () => {
    const georef = obtenerGeocodificador('AR');
    const ubicada = await georef.geocodificar({ direccion: DIRECCION });
    assert.equal(ubicada.confianza, 'exacta');
    assert.equal(ubicada.fuente, 'georef_ar');
  });
});

describe('la dirección que no se puede ubicar en la puerta', () => {
  it('el servicio contesta sin resultados: se guarda el domicilio sin coordenadas', async () => {
    respuestaDelServicio = { cantidad: 0, direcciones: [] };
    const ubicacion = await coordenadasDeDomicilio({ prestadoraId: PRESTADORA, direccion: DIRECCION });
    assert.deepEqual(ubicacion, { lat: null, lng: null });
    assert.equal(anotados.length, 0, 'no encontrar una dirección no es una falla que anotar');
  });

  it('el servicio reconoce la calle pero no el número: no se guarda un punto aproximado', async () => {
    // Este es el caso que parece un dato bueno y no lo es: un punto en el medio de la cuadra
    // cae adentro o afuera de los 150 metros del aviso de check-in por azar.
    respuestaDelServicio = encontrada({ altura: null });
    const ubicacion = await coordenadasDeDomicilio({ prestadoraId: PRESTADORA, direccion: DIRECCION });
    assert.deepEqual(ubicacion, { lat: null, lng: null });

    const georef = obtenerGeocodificador('AR');
    const ubicada = await georef.geocodificar({ direccion: DIRECCION });
    assert.equal(ubicada.confianza, 'aproximada', 'el adaptador igual dice hasta dónde llegó');
  });

  it('la calle sin punto no se confunde con la isla del kilómetro cero', async () => {
    // `null` convertido a número da cero, y (0, 0) es una coordenada válida en el mar.
    respuestaDelServicio = encontrada({ lat: null, lon: null });
    const georef = obtenerGeocodificador('AR');
    assert.equal(await georef.geocodificar({ direccion: DIRECCION }), null);
  });
});

describe('el servicio que no contesta', () => {
  it('se cae con un error: se guarda el domicilio sin coordenadas y queda anotado', async () => {
    codigoDelServicio = 500;
    respuestaDelServicio = { mensaje: 'el servicio se cayó' };

    const ubicacion = await coordenadasDeDomicilio({ prestadoraId: PRESTADORA, direccion: DIRECCION });
    assert.deepEqual(ubicacion, { lat: null, lng: null });
    assert.ok(anotados.some((linea) => linea.includes('no se pudo ubicar un domicilio')));
  });

  it('lo que queda anotado no lleva la dirección adentro', async () => {
    codigoDelServicio = 502;
    await coordenadasDeDomicilio({ prestadoraId: PRESTADORA, direccion: DIRECCION, localidad: LOCALIDAD });

    const registro = anotados.join(' ');
    assert.ok(registro.length > 0, 'algo tuvo que quedar anotado');
    assert.ok(!registro.includes(DIRECCION), 'el domicilio es dato sensible y no va al registro');
    assert.ok(!registro.includes(LOCALIDAD));
    assert.ok(!registro.includes('742'));
  });

  it('no está en el aire: el error tampoco arrastra la dirección', async () => {
    process.env.GEOREF_API_BASE = 'http://127.0.0.1:1';
    const { geocodificar } = await import('../georefAr.js?sinServidor');
    await assert.rejects(
      () => geocodificar({ direccion: DIRECCION }),
      (error) => !error.message.includes(DIRECCION) && !error.message.includes('742'),
    );
    process.env.GEOREF_API_BASE = `http://127.0.0.1:${servicioFalso.address().port}`;
  });
});

describe('el país que todavía no tiene servicio de direcciones', () => {
  it('no se le pregunta a nadie y el domicilio se guarda igual', async () => {
    paisDeLaPrestadora = 'UY';
    const ubicacion = await coordenadasDeDomicilio({ prestadoraId: PRESTADORA, direccion: DIRECCION });

    assert.deepEqual(ubicacion, { lat: null, lng: null });
    assert.equal(consultasAlServicio.length, 0);
    assert.equal(anotados.length, 0, 'no tener servicio para un país no es una falla que anotar');
  });

  it('`obtenerGeocodificador` devuelve null en vez de lanzar', () => {
    assert.equal(obtenerGeocodificador('UY'), null);
    assert.equal(obtenerGeocodificador(null), null);
    assert.equal(obtenerGeocodificador(''), null);
  });

  it('el país se lee sin importar cómo esté escrito', () => {
    assert.ok(obtenerGeocodificador('ar'));
    assert.ok(obtenerGeocodificador(' AR '));
    assert.deepEqual(paisesConGeocodificador(), ['AR']);
  });

  it('una Prestadora que no está no rompe nada', async () => {
    paisDeLaPrestadora = null;
    const ubicacion = await coordenadasDeDomicilio({ prestadoraId: PRESTADORA, direccion: DIRECCION });
    assert.deepEqual(ubicacion, { lat: null, lng: null });
    assert.equal(consultasAlServicio.length, 0);
  });
});

describe('lo que ni siquiera vale preguntar', () => {
  it('sin dirección no se mira ni la base', async () => {
    for (const direccion of [null, undefined, '', '   ']) {
      const ubicacion = await coordenadasDeDomicilio({ prestadoraId: PRESTADORA, direccion });
      assert.deepEqual(ubicacion, { lat: null, lng: null });
    }
    assert.equal(consultasALaBase.length, 0);
    assert.equal(consultasAlServicio.length, 0);
  });

  it('sin Prestadora tampoco: el país es el suyo y sin él no hay a quién preguntarle', async () => {
    const ubicacion = await coordenadasDeDomicilio({ prestadoraId: null, direccion: DIRECCION });
    assert.deepEqual(ubicacion, { lat: null, lng: null });
    assert.equal(consultasALaBase.length, 0);
    assert.equal(consultasAlServicio.length, 0);
  });

  it('el país se busca acotado a esa Prestadora', async () => {
    await coordenadasDeDomicilio({ prestadoraId: PRESTADORA, direccion: DIRECCION });
    assert.ok(consultasALaBase[0].includes(`id=eq.${PRESTADORA}`));
  });
});
