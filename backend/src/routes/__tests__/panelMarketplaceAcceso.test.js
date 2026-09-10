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
const SESION_SOPORTE = '44444444-4444-4444-4444-444444444444';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, para poder afirmar que NO pidió algo. */
let llamadas = [];

let rolDelUsuario = 'admin_prestadora';
let prestadoraDelUsuario = PRESTADORA;
/** Qué contesta la base cuando se le pregunta si esta Prestadora tiene la modalidad encendida. */
let modalidadMarketplace = true;
/** Con sesión de soporte abierta, un Superadmin queda parado adentro de esta Prestadora. */
let sesionDeSoporteAbierta = false;

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

const dentroDeUnRato = () => new Date(Date.now() + 30 * 60 * 1000).toISOString();

beforeEach(() => {
  llamadas = [];
  rolDelUsuario = 'admin_prestadora';
  prestadoraDelUsuario = PRESTADORA;
  modalidadMarketplace = true;
  sesionDeSoporteAbierta = false;
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: rolDelUsuario, prestadora_id: prestadoraDelUsuario }]);
  respuestas.set('POST /rest/v1/rpc/prestadora_tiene_modalidad_activa', () => modalidadMarketplace);
  // El segundo factor no es lo que se prueba acá: se lo deja apagado para que el camino llegue
  // hasta el candado del rol.
  respuestas.set('GET /rest/v1/configuracion_plataforma', () => [{ mfa_admin_obligatorio: false }]);
  respuestas.set('GET /rest/v1/sesiones_soporte_tecnico', () =>
    sesionDeSoporteAbierta
      ? [
          {
            id: SESION_SOPORTE,
            prestadora_id: PRESTADORA,
            expira_at: dentroDeUnRato(),
            ultima_actividad_at: new Date().toISOString(),
          },
        ]
      : []
  );
  respuestas.set('PATCH /rest/v1/sesiones_soporte_tecnico', () => []);
  respuestas.set('POST /rest/v1/auditoria_soporte_tecnico', () => []);
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
  'rpc/leer_credencial_pasarela_pago',
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
  // Dar de alta una suscripción en la pasarela es lo que la deja cobrando de verdad: saca la
  // credencial de la caja fuerte y crea el cobro recurrente del lado del proveedor.
  ['POST', `/suscripciones/${SUSCRIPCION}/alta-en-pasarela`, {}],
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
    // Cuáles son las funciones de riesgo lo dice la base, no una lista escrita en el motor
    // (CLAUDE.md §8): la ruta lee el catálogo antes de filtrar la auditoría.
    respuestas.set('GET /rest/v1/catalogo_funciones_marketplace', () => [
      { clave: 'ranking_plataforma', orden: 1 },
    ]);
    respuestas.set('GET /rest/v1/auditoria_advertencias_legales', () => []);
    const { estado } = await pedir('GET', '/auditoria-legal');
    assert.equal(estado, 200);
  });

  it('ve las funciones de riesgo legal, y no las puede encender', async () => {
    rolDelUsuario = 'coordinador';
    respuestas.set('GET /rest/v1/catalogo_funciones_marketplace', () => [
      { clave: 'ranking_plataforma', orden: 1 },
    ]);
    respuestas.set('GET /rest/v1/configuracion_funciones_marketplace', () => []);
    respuestas.set('GET /rest/v1/prestadoras', () => [{ pais: 'AR' }]);
    respuestas.set('GET /rest/v1/advertencias_legales', () => []);

    const lectura = await pedir('GET', '/funciones-riesgo');
    assert.equal(lectura.estado, 200);
    assert.equal(lectura.cuerpo.funciones.length, 1);

    const escritura = await pedir('PUT', '/funciones-riesgo/ranking_plataforma', { activa: true });
    assert.equal(escritura.estado, 403);
    const escrituras = llamadas.filter((l) => l.clave === 'POST /rest/v1/configuracion_funciones_marketplace');
    assert.deepEqual(escrituras, [], 'el motor guardó el encendido antes de negarlo');
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

// ---------------------------------------------------------------------------------------
// Paso 7 del plan. Hasta acá el Marketplace se abría por rol: una Prestadora que trabaja
// solamente en prestación directa —que nunca contrató el Marketplace— entraba a todas estas
// rutas con sólo escribir la dirección, porque el único candado era quién es la persona, no
// qué contrató la Prestadora. El menú del Panel ya escondía los enlaces, pero esconder un
// enlace no impide escribir una dirección.
//
// Se prueba con las dos mitades del router —la de la plata y la que sí es del Coordinador—,
// porque el candado es del router entero y no de la mitad administrativa.

describe('sin la modalidad Marketplace no se entra', () => {
  const TODAS_LAS_RUTAS = [
    ...RUTAS_DE_PLATA,
    ['GET', '/calificaciones', undefined],
    ['GET', '/auditoria-legal', undefined],
  ];

  for (const [metodo, ruta, cuerpo] of TODAS_LAS_RUTAS) {
    it(`${metodo} ${ruta}`, async () => {
      modalidadMarketplace = false;
      const { estado, cuerpo: respuesta } = await pedir(metodo, ruta, cuerpo);
      assert.equal(estado, 403);
      // El motivo es lo que le permite al Panel mostrar la frase traducida en el idioma de
      // quien mira. Sin él la pantalla sólo puede decir "no tiene permiso", que acá es falso:
      // el permiso lo tiene, lo que falta es la modalidad.
      assert.equal(respuesta.motivo, 'modalidad_no_activa');
      // Y el mensaje no nombra ninguna tabla ni columna de la base (CLAUDE.md §6).
      assert.doesNotMatch(respuesta.error, /prestadora_modalidades|select|column|relation/i);
      noTocoLaPlata();
    });
  }

  it('niega igual si la base no pudo contestar', async () => {
    // Falla cerrado (CLAUDE.md §5): ante un dato que no se pudo resolver, se deniega. La
    // respuesta sin preparar hace que la base de mentira conteste un error.
    respuestas.delete('POST /rest/v1/rpc/prestadora_tiene_modalidad_activa');
    const { estado, cuerpo } = await pedir('GET', '/suscripciones');
    assert.equal(estado, 403);
    assert.equal(cuerpo.motivo, 'modalidad_no_activa');
    noTocoLaPlata();
  });

  it('niega igual si la respuesta viene vacía', async () => {
    // El caso que rompe los candados escritos a la ligera: `null` no es `false`, y una
    // comparación floja lo dejaría pasar.
    modalidadMarketplace = null;
    const { estado, cuerpo } = await pedir('GET', '/suscripciones');
    assert.equal(estado, 403);
    assert.equal(cuerpo.motivo, 'modalidad_no_activa');
    noTocoLaPlata();
  });

  it('le pregunta a la base por esta Prestadora y por esta modalidad', async () => {
    // Que la pregunta se arme con la Prestadora de la sesión —y no con una que venga en el
    // pedido— es lo que impide que alguien conteste por otra.
    modalidadMarketplace = false;
    await pedir('GET', '/suscripciones');
    const pregunta = llamadas.find((l) => l.clave === 'POST /rest/v1/rpc/prestadora_tiene_modalidad_activa');
    assert.ok(pregunta, 'el motor no le preguntó a la base si la modalidad está activa');
    assert.deepEqual(pregunta.cuerpo, { p_prestadora_id: PRESTADORA, p_modalidad: 'marketplace' });
  });
});

// ---------------------------------------------------------------------------------------
// Y adentro de la plata hay una parte más angosta todavía: las credenciales con las que la
// Prestadora cobra. Son un secreto de ella, igual que el token de WhatsApp y que la contraseña
// del correo saliente, así que Superadmin queda afuera de cargarlas y de reemplazarlas aunque
// tenga la sesión de soporte abierta. Las pruebas se hacen con esa sesión ABIERTA a propósito:
// sin ella, Superadmin no está parado en ninguna Prestadora y la ruta corta antes por otro
// motivo; el caso que importa es el de adentro de la sesión de soporte.

const RUTAS_DE_LAS_CREDENCIALES_DE_COBRO = [
  ['PUT', '/pasarela/mercadopago/secreto-firma', { secretoFirma: 'lo que sea' }],
  ['PATCH', '/pasarela/mercadopago', { activo: true }],
];

describe('Superadmin no llega a las credenciales de cobro de una Prestadora', () => {
  for (const [metodo, ruta, cuerpo] of RUTAS_DE_LAS_CREDENCIALES_DE_COBRO) {
    it(`${metodo} ${ruta}, aun con la sesión de soporte abierta`, async () => {
      rolDelUsuario = 'superadmin';
      prestadoraDelUsuario = null;
      sesionDeSoporteAbierta = true;

      const { estado, cuerpo: respuesta } = await pedir(metodo, ruta, cuerpo);
      assert.equal(estado, 403);
      // El mensaje explica de quién son las credenciales, y no nombra ninguna tabla ni columna
      // de la base (CLAUDE.md §6).
      assert.match(respuesta.error, /credenciales de cobro/i);
      assert.doesNotMatch(respuesta.error, /prestadora_pasarela_pago|credenciales_pasarela|select|column|relation|vault/i);
      noTocoLaPlata();
    });
  }

  it('pero sigue viendo qué pasarelas están conectadas, que es lo que necesita para dar soporte', async () => {
    // El candado angosto es de las dos rutas que escriben la credencial y de ninguna más: si se
    // hubiera cerrado el riel entero, Superadmin dejaría de poder ayudar a una Prestadora a
    // entender por qué no le entran los cobros.
    rolDelUsuario = 'superadmin';
    prestadoraDelUsuario = null;
    sesionDeSoporteAbierta = true;
    respuestas.set('GET /rest/v1/prestadora_pasarela_pago', () => []);
    respuestas.set('GET /rest/v1/credenciales_pasarela_pago', () => []);

    const { estado, cuerpo } = await pedir('GET', '/pasarela');
    assert.equal(estado, 200);
    assert.ok(Array.isArray(cuerpo.pasarelas));
  });
});
