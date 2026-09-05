/**
 * Quién entra a las rutas de Marketplace del Panel.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Hasta el 2026-09-04 este router dejaba pasar al Coordinador a
 * todo, incluida la pasarela de pago y los cobros. Otras dos rutas del motor tenían una
 * función con el mismo nombre que no lo dejaba pasar, así que la diferencia no se veía leyendo:
 * había que abrir los tres archivos y comparar tres listas escritas a mano. El Desarrollador lo
 * cerró ese día: la plata del Marketplace no es del Coordinador.
 *
 * Lo que se prueba no es la función del candado —eso sería probar un `includes`—, sino el
 * camino entero: se levanta el motor de verdad contra una base de mentira, se entra con cada
 * rol y se mira qué contesta cada ruta. Y en el caso que se niega se comprueba, además, que el
 * motor NO le haya preguntado nada a la base: un 403 que igual leyó la tabla ya filtró que esa
 * fila existe.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const USUARIO = '22222222-2222-2222-2222-222222222222';
const SUSCRIPCION = '33333333-3333-3333-3333-333333333333';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, para poder afirmar que NO pidió algo. */
let llamadas = [];

let rolDelUsuario = 'admin_prestadora';
let prestadoraDelUsuario = PRESTADORA;

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    llamadas.push({ clave, cuerpo: crudo ? JSON.parse(crudo) : null });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada() : preparada;
    if (valor === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `la prueba no preparó respuesta para ${clave}` }));
      return;
    }

    const unoSolo = (req.headers.accept || '').includes('vnd.pgrst.object+json');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(unoSolo && Array.isArray(valor) ? valor[0] ?? null : valor));
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

// El import va después de dejar puestas las variables de entorno: la conexión a la base se arma
// en el momento en que se importa, y con la dirección que haya en ese instante.
const { default: express } = await import('express');
await import('express-async-errors');
const { panelMarketplaceRouter } = await import('../panelMarketplace.js');

const app = express();
app.use(express.json());
app.use('/api/panel/marketplace', panelMarketplaceRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/panel/marketplace`;

after(() => {
  motor.close();
  baseFalsa.close();
});

async function pedir(metodo, ruta, cuerpo) {
  const respuesta = await fetch(`${DIRECCION}${ruta}`, {
    method: metodo,
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

beforeEach(() => {
  llamadas = [];
  rolDelUsuario = 'admin_prestadora';
  prestadoraDelUsuario = PRESTADORA;
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: rolDelUsuario, prestadora_id: prestadoraDelUsuario }]);
});

/** Las tablas y funciones que sólo se tocan cuando la ruta llegó a hacer su trabajo. */
const TABLAS_DE_PLATA = [
  'prestadora_pasarela_pago',
  'credenciales_pasarela_pago',
  'suscripciones_marketplace',
  'cobros_marketplace',
  'qr_cobro_efectivo',
  'rpc/guardar_credencial_pasarela_pago',
  'rpc/guardar_secreto_firma_pasarela_pago',
];

function noTocoLaPlata() {
  const tocadas = llamadas
    .map((l) => l.clave)
    .filter((clave) => TABLAS_DE_PLATA.some((tabla) => clave.includes(tabla)));
  assert.deepEqual(tocadas, [], `el motor le preguntó a la base antes de negar: ${tocadas.join(', ')}`);
}

// ---------------------------------------------------------------------------------------

const RUTAS_DE_PLATA = [
  ['GET', '/pasarela', undefined],
  ['PUT', '/pasarela/mercadopago/secreto-firma', { secretoFirma: 'lo que sea' }],
  ['PATCH', '/pasarela/mercadopago', { activo: true }],
  ['GET', '/suscripciones', undefined],
  ['GET', `/suscripciones/${SUSCRIPCION}/cobros`, undefined],
  ['POST', '/cobros/efectivo-manual', { suscripcion_id: SUSCRIPCION, monto: 1000, periodo: '2026-09', fecha_cobro: '2026-09-04' }],
  ['POST', '/qr-cobro/canjear', { token: 'token-de-mentira' }],
];

describe('el Coordinador no llega a la plata del Marketplace', () => {
  for (const [metodo, ruta, cuerpo] of RUTAS_DE_PLATA) {
    it(`${metodo} ${ruta}`, async () => {
      rolDelUsuario = 'coordinador';
      const { estado } = await pedir(metodo, ruta, cuerpo);
      assert.equal(estado, 403);
      noTocoLaPlata();
    });
  }
});

describe('lo que sí es del Coordinador', () => {
  it('ve las calificaciones', async () => {
    rolDelUsuario = 'coordinador';
    respuestas.set('GET /rest/v1/calificaciones_asistente', () => []);
    const { estado, cuerpo } = await pedir('GET', '/calificaciones');
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo.calificaciones, []);
  });

  it('ve la auditoría de advertencias legales', async () => {
    rolDelUsuario = 'coordinador';
    respuestas.set('GET /rest/v1/auditoria_advertencias_legales', () => []);
    const { estado } = await pedir('GET', '/auditoria-legal');
    assert.equal(estado, 200);
  });
});

describe('la administración sí pasa el candado', () => {
  it('a la carga de efectivo en mano', async () => {
    // Se manda sin cuerpo a propósito: lo que se prueba es que la respuesta ya no es la del
    // candado (403) sino la de la ruta contestando que le faltan datos.
    const { estado, cuerpo } = await pedir('POST', '/cobros/efectivo-manual', {});
    assert.equal(estado, 400);
    assert.match(cuerpo.error, /Faltan/);
  });

  it('a la lista de pasarelas', async () => {
    respuestas.set('GET /rest/v1/prestadora_pasarela_pago', () => []);
    respuestas.set('GET /rest/v1/credenciales_pasarela_pago', () => []);
    const { estado, cuerpo } = await pedir('GET', '/pasarela');
    assert.equal(estado, 200);
    assert.ok(Array.isArray(cuerpo.pasarelas));
  });
});

describe('sin Prestadora activa no hay Marketplace', () => {
  it('contesta que hay que entrar a una, y no que falta permiso', async () => {
    prestadoraDelUsuario = null;
    const { estado, cuerpo } = await pedir('GET', '/calificaciones');
    assert.equal(estado, 400);
    assert.match(cuerpo.error, /entrar a una prestadora/);
  });
});
