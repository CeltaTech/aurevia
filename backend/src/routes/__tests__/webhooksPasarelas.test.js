/**
 * Pruebas del camino entero del aviso de cobro de una pasarela (pendiente #159).
 *
 * Las cuentas de la firma están probadas aparte, en `pasarelas/__tests__/firmaWebhook.test.js`.
 * Lo que se prueba acá es lo otro, que es donde esto se rompe de verdad: que la ruta reciba
 * los bytes tal cual llegaron —no el objeto que express arma y alguien vuelve a convertir a
 * texto—, que corte con 401 cuando no hay nada guardado con qué comprobar, y que solo toque
 * la fila del cobro cuando el aviso resultó auténtico.
 *
 * Se levanta el motor de verdad contra una base de mentira que contesta lo que cada prueba le
 * prepara, igual que `panelCobros.test.js`.
 *
 *   npm test --prefix backend
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const COBRO = '55555555-5555-5555-5555-555555555555';
const ACCESO = '66666666-6666-6666-6666-666666666666';
/** Un importe por mes: es de la forma de cobro, y no del código, de donde sale cada cuánto se
 *  vuelve a cobrar un acceso. */
const CADA_MES = { periodo_cantidad: 1, periodo_unidad: 'mes' };
const SECRETO = 'whsec_un_secreto_de_mentira_para_la_prueba';
const SECRETO_DE_AMBIENTE = 'un_secreto_de_ambiente_de_mentira';
/** El período que el acceso está esperando cobrar. Es una fecha guardada, no la de hoy: de ella
 *  sale el mes siguiente cuando la plata entra (`utils/cobrosMarketplace.js`). */
const PERIODO = '2026-09-01';
const MONTO_MENSUAL = 12500;

/** Las variables de ambiente de los rieles que no publican esquema de firma (paso 9). */
const SECRETOS_DE_AMBIENTE = [
  'MODO_SECRETO_FIRMA_WEBHOOK',
  'DEBIN_SECRETO_FIRMA_WEBHOOK',
  'COBRANZA_EFECTIVO_SECRETO_FIRMA_WEBHOOK',
];

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base. */
let llamadas = [];
/** Los rechazos que el motor dejó anotados del lado del servidor. */
let anotados = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    llamadas.push({ clave, url: req.url, cuerpo: crudo ? JSON.parse(crudo) : null });

    // A la respuesta preparada se le pasa también la dirección con sus filtros: hay dos consultas
    // distintas que caen en la misma tabla —la que busca el acceso por la referencia del
    // aviso y la que la lee por su identificador antes de moverla— y sólo el filtro las separa.
    const preparada = respuestas.get(clave);
    const valor =
      typeof preparada === 'function' ? preparada(crudo ? JSON.parse(crudo) : null, req.url) : preparada;
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

// Un Mercado Pago de mentira. Hace falta porque su aviso no dice si la plata entró —solo trae
// el identificador del cobro—, así que la ruta le vuelve a preguntar antes de imputar nada, y
// eso es lo que se prueba más abajo.
let respuestaDelProveedor = { status: 'authorized' };
let codigoDelProveedor = 200;
let consultasAlProveedor = [];
const proveedorFalso = createServer((req, res) => {
  consultasAlProveedor.push(req.url);
  res.writeHead(codigoDelProveedor, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(respuestaDelProveedor));
});
await new Promise((listo) => proveedorFalso.listen(0, '127.0.0.1', listo));
process.env.MERCADOPAGO_API_BASE = `http://127.0.0.1:${proveedorFalso.address().port}`;

// El import va después de dejar puestas las variables de entorno: la conexión a la base se
// arma en el momento en que se importa.
const { default: express } = await import('express');
await import('express-async-errors');
const { webhooksPasarelasRouter } = await import('../webhooksPasarelas.js');

// Se monta igual que en `server.js`: el router solo, sin `express.json()` delante. El router
// trae adentro su propio lector de cuerpo crudo.
const app = express();
app.use('/api/webhooks/pasarelas', webhooksPasarelasRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/webhooks/pasarelas`;

// Los rechazos se anotan del lado del servidor; acá se juntan en vez de imprimirse, para que
// la prueba pueda comprobar que quedaron anotados y para no ensuciar la salida.
const avisarDeVerdad = console.warn;
console.warn = (...partes) => anotados.push(partes.join(' '));

after(() => {
  console.warn = avisarDeVerdad;
  motor.close();
  baseFalsa.close();
  proveedorFalso.close();
});

const EVENTO = { type: 'invoice.paid', data: { object: { id: 'sub_1234567890' } } };
const CRUDO = Buffer.from(JSON.stringify(EVENTO, null, 2), 'utf8');

function firmaDe(cuerpo, instante, secreto = SECRETO) {
  return createHmac('sha256', secreto).update(`${instante}.`).update(cuerpo).digest('hex');
}

function cabeceraFirmada(cuerpo = CRUDO, secreto = SECRETO) {
  const instante = Math.floor(Date.now() / 1000);
  return `t=${instante},v1=${firmaDe(cuerpo, instante, secreto)}`;
}

async function avisar({ cuerpo = CRUDO, firma, tipoDeContenido = 'application/json' } = {}) {
  const respuesta = await fetch(`${DIRECCION}/stripe/${PRESTADORA}`, {
    method: 'POST',
    headers: {
      'Content-Type': tipoDeContenido,
      ...(firma === null ? {} : { 'Stripe-Signature': firma ?? cabeceraFirmada(cuerpo) }),
    },
    body: cuerpo,
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** La base con todo cargado: fila de credenciales, credencial, secreto de firma y un cobro
 *  esperando esa referencia. Cada prueba pisa lo que necesita cambiar. */
beforeEach(() => {
  llamadas = [];
  anotados = [];
  respuestaDelProveedor = { status: 'authorized' };
  codigoDelProveedor = 200;
  consultasAlProveedor = [];
  respuestas.clear();
  respuestas.set('GET /rest/v1/credenciales_pasarela_pago', () => [
    { credencial_secret_id: 'aaaaaaaa-0000-4000-8000-000000000000', secreto_firma_secret_id: 'bbbbbbbb-0000-4000-8000-000000000000' },
  ]);
  respuestas.set('POST /rest/v1/rpc/leer_credencial_pasarela_pago', () => 'sk_de_mentira');
  respuestas.set('POST /rest/v1/rpc/leer_secreto_firma_pasarela_pago', () => SECRETO);
  respuestas.set('GET /rest/v1/cobros_marketplace', () => [{ id: COBRO, acceso_id: ACCESO, periodo: PERIODO }]);
  respuestas.set('PATCH /rest/v1/cobros_marketplace', () => []);
  respuestas.set('POST /rest/v1/cobros_marketplace', () => []);
  respuestas.set('PATCH /rest/v1/accesos_marketplace', () => []);
  // Dos consultas distintas caen acá y se distinguen por el filtro: la ruta busca el acceso
  // **por la referencia del aviso** —y de fábrica no la encuentra, porque la de fábrica es la de
  // un cobro—, y `registrarCobroExitoso` la lee **por su identificador** antes de moverla. Por ese
  // mismo identificador la lee `abrirElPeriodoDeGracia` cuando el cobro no entra, y de ahí salen el
  // estado y la gracia: un acceso vigente al que todavía no se le abrió ninguna.
  respuestas.set('GET /rest/v1/accesos_marketplace', (_cuerpo, url) =>
    url.includes('referencia_externa=eq.')
      ? []
      : [{ id: ACCESO, estado: 'vigente', gracia_hasta: null, proximo_cobro: PERIODO, formas_de_cobro_marketplace: CADA_MES }]
  );
  // Los tres rieles sin esquema publicado miran un secreto de ambiente cuando la Prestadora no
  // cargó el suyo. La máquina donde corre esto puede tenerlo puesto, así que cada prueba
  // arranca sin ninguno y lo pone la que quiera probarlo.
  for (const variable of SECRETOS_DE_AMBIENTE) delete process.env[variable];
});

function escrituras() {
  return llamadas.filter((l) => l.clave.startsWith('PATCH '));
}

/** Las filas nuevas. Se miran aparte de las escrituras porque son otra cosa: una modifica un cobro
 *  que ya existía y la otra anota un mes que de este lado no estaba anotado. */
function inserciones() {
  return llamadas.filter((l) => l.clave === 'POST /rest/v1/cobros_marketplace');
}

describe('el aviso de cobro auténtico', () => {
  it('se acepta, marca el cobro y deja el acceso vigente', async () => {
    const { estado, cuerpo } = await avisar();
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo, { ok: true });

    const cobro = escrituras().find((l) => l.clave.endsWith('/cobros_marketplace'));
    assert.equal(cobro.cuerpo.estado_cobro, 'exitoso');
    const acceso = escrituras().find((l) => l.clave.endsWith('/accesos_marketplace'));
    assert.equal(acceso.cuerpo.estado, 'vigente');
  });

  it('el acceso pasa al período siguiente al cobrado, no al de hoy', async () => {
    // Es la diferencia que se ve el día que un cobro entra tarde: contando desde hoy, cada demora
    // corre la fecha y la Prestadora termina cobrando once meses por año en vez de doce.
    await avisar();
    const acceso = escrituras().find((l) => l.clave.endsWith('/accesos_marketplace'));
    assert.equal(acceso.cuerpo.proximo_cobro, '2026-10-01');
  });

  it('la búsqueda del cobro va acotada a la Prestadora de la dirección', async () => {
    await avisar();
    const busqueda = llamadas.find((l) => l.clave === 'GET /rest/v1/cobros_marketplace');
    assert.ok(busqueda.url.includes(`prestadora_id=eq.${PRESTADORA}`));
  });
});

describe('el aviso de cobro que no se puede probar auténtico', () => {
  it('con la firma cambiada se rechaza con 401 y no toca ninguna fila', async () => {
    const { estado } = await avisar({ firma: `t=${Math.floor(Date.now() / 1000)},v1=${'a'.repeat(64)}` });
    assert.equal(estado, 401);
    assert.equal(escrituras().length, 0);
  });

  it('sin cabecera de firma se rechaza con 401', async () => {
    const { estado } = await avisar({ firma: null });
    assert.equal(estado, 401);
    assert.equal(escrituras().length, 0);
  });

  it('con un instante viejo se rechaza con 401, aunque la firma esté bien hecha', async () => {
    const viejo = Math.floor(Date.now() / 1000) - 6 * 60;
    const { estado } = await avisar({ firma: `t=${viejo},v1=${firmaDe(CRUDO, viejo)}` });
    assert.equal(estado, 401);
    assert.equal(escrituras().length, 0);
  });

  it('sin secreto de firma guardado se rechaza con 401', async () => {
    respuestas.set('POST /rest/v1/rpc/leer_secreto_firma_pasarela_pago', () => null);
    const { estado } = await avisar();
    assert.equal(estado, 401);
    assert.equal(escrituras().length, 0);
  });

  it('sin fila de credenciales se corta antes de leer ningún secreto', async () => {
    respuestas.set('GET /rest/v1/credenciales_pasarela_pago', () => []);
    const { estado } = await avisar();
    assert.equal(estado, 401);
    assert.equal(llamadas.filter((l) => l.clave.startsWith('POST /rest/v1/rpc/')).length, 0);
    assert.equal(escrituras().length, 0);
  });

  it('el motivo queda anotado del lado del servidor, y no viaja en la respuesta', async () => {
    const { cuerpo } = await avisar({ firma: null });
    assert.equal(cuerpo.error, 'Aviso no autenticado');
    assert.ok(anotados.some((linea) => linea.includes('cabecera_de_firma_ausente')));
  });

  it('un proveedor que no existe no llega ni a mirar la base', async () => {
    const respuesta = await fetch(`${DIRECCION}/inventado/${PRESTADORA}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: CRUDO,
    });
    assert.equal(respuesta.status, 404);
    assert.equal(llamadas.length, 0);
  });
});

describe('el cuerpo crudo', () => {
  it('llega tal cual se mandó: la firma se calcula sobre esos bytes y coincide', async () => {
    // El cuerpo va con saltos de línea y sangría, como lo manda Stripe. Si en el camino
    // alguien lo rearmara a partir del objeto leído, los bytes cambiarían y la firma —que es
    // la de estos bytes— dejaría de dar. Que esto conteste 200 es la prueba de que no pasa.
    assert.ok(CRUDO.includes('\n'));
    const { estado } = await avisar({ cuerpo: CRUDO });
    assert.equal(estado, 200);
  });

  it('con un tipo de contenido que no es JSON no hay cuerpo crudo, y se rechaza', async () => {
    const { estado } = await avisar({ tipoDeContenido: 'text/plain' });
    assert.equal(estado, 401);
    assert.equal(escrituras().length, 0);
  });

  it('un cuerpo que no es JSON se rechaza sin tocar la base', async () => {
    const basura = Buffer.from('esto no es json', 'utf8');
    const { estado } = await avisar({ cuerpo: basura });
    assert.equal(estado, 400);
    assert.equal(llamadas.length, 0);
  });

  it('en server.js el router va montado ANTES del lector de JSON general', () => {
    // Esta es la parte que se rompe en silencio: si algún día alguien mueve esta línea al
    // montón de las demás rutas, `express.json()` se queda con el pedido primero, la ruta
    // nunca vuelve a ver los bytes originales y TODOS los avisos —también los auténticos—
    // pasan a rechazarse. No hay forma de probarlo levantando el servidor de verdad (arranca
    // sus procesos periódicos y se queda escuchando), así que se comprueba el orden escrito.
    const servidor = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    const montaje = servidor.indexOf("app.use('/api/webhooks/pasarelas'");
    const lectorJson = servidor.indexOf('app.use(express.json())');
    assert.ok(montaje > 0, 'el router de webhooks tiene que estar montado en server.js');
    assert.ok(lectorJson > 0, 'el lector de JSON general tiene que estar en server.js');
    assert.ok(montaje < lectorJson, 'el router de webhooks va antes del express.json() general');
  });
});

// ---------------------------------------------------------------------------
// El aviso que no alcanza por sí solo (pendiente #159, decisión del 2026-08-22)
//
// Mercado Pago avisa "pasó algo con este cobro" y nada más: el estado no viaja adentro de lo
// que firma. Comprobar la firma prueba que el aviso es auténtico, no que la plata entró. Por
// eso la ruta le vuelve a preguntar al propio Mercado Pago, de sistema a sistema, y recién con
// esa respuesta imputa. Lo que se prueba acá es que esa segunda pregunta pase de verdad, que
// mande el mismo identificador que venía firmado, y que si se cae no dé nada por cobrado.
// ---------------------------------------------------------------------------

const CRUDO_MP = Buffer.from(JSON.stringify({ action: 'payment.updated', data: { id: 'PAGO-123' } }), 'utf8');
const REQUISITORIA = 'req-de-mentira';

async function avisarMercadoPago({ idDelAviso = 'PAGO-123' } = {}) {
  const instante = Math.floor(Date.now() / 1000);
  // Mercado Pago firma una plantilla de tres datos, no el cuerpo, y pide el identificador en
  // minúsculas. Acá se manda en mayúsculas a propósito, para que la prueba falle si algún día
  // se deja de bajar a minúsculas antes de firmar.
  const firma = createHmac('sha256', SECRETO)
    .update(`id:${idDelAviso.toLowerCase()};request-id:${REQUISITORIA};ts:${instante};`)
    .digest('hex');
  const respuesta = await fetch(`${DIRECCION}/mercadopago/${PRESTADORA}?data.id=${idDelAviso}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-request-id': REQUISITORIA,
      'x-signature': `ts=${instante},v1=${firma}`,
    },
    body: CRUDO_MP,
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

describe('el aviso de Mercado Pago, que no dice si la plata entró', () => {
  it('se confirma preguntándole al proveedor, y ahí sí se imputa', async () => {
    const { estado } = await avisarMercadoPago();
    assert.equal(estado, 200);

    assert.equal(consultasAlProveedor.length, 1);
    assert.ok(consultasAlProveedor[0].includes('PAGO-123'), 'se pregunta por el mismo cobro que venía firmado');

    const cobro = escrituras().find((l) => l.clave.endsWith('/cobros_marketplace'));
    assert.equal(cobro.cuerpo.estado_cobro, 'exitoso');
    const acceso = escrituras().find((l) => l.clave.endsWith('/accesos_marketplace'));
    assert.equal(acceso.cuerpo.estado, 'vigente');
  });

  it('si el proveedor dice que todavía no entró, el cobro queda pendiente y el acceso sin tocar', async () => {
    respuestaDelProveedor = { status: 'pending' };
    const { estado } = await avisarMercadoPago();
    assert.equal(estado, 200);

    const cobro = escrituras().find((l) => l.clave.endsWith('/cobros_marketplace'));
    assert.equal(cobro.cuerpo.estado_cobro, 'pendiente');
    assert.equal(escrituras().some((l) => l.clave.endsWith('/accesos_marketplace')), false);
  });

  it('si el proveedor dice que se canceló, el cobro queda fallido y el acceso entra en gracia', async () => {
    respuestaDelProveedor = { status: 'cancelled' };
    await avisarMercadoPago();

    const cobro = escrituras().find((l) => l.clave.endsWith('/cobros_marketplace'));
    assert.equal(cobro.cuerpo.estado_cobro, 'fallido');
    const acceso = escrituras().find((l) => l.clave.endsWith('/accesos_marketplace'));
    // Acá se suspendía el mismo día. Ahora se le abre la gracia y el acceso queda como estaba
    // (`utils/periodoDeGracia.js`).
    assert.ok(acceso.cuerpo.gracia_hasta);
    assert.equal(acceso.cuerpo.estado, undefined);
  });

  it('si no se puede preguntar, no se escribe nada: quedarse corto se arregla, cobrar de más no', async () => {
    codigoDelProveedor = 500;
    respuestaDelProveedor = { message: 'el proveedor se cayó' };
    const { estado } = await avisarMercadoPago();
    assert.equal(estado, 200);
    assert.equal(escrituras().length, 0);
    assert.ok(anotados.some((linea) => linea.includes('No se pudo confirmar el cobro')));
  });

  it('un aviso con la firma cambiada ni siquiera llega a preguntarle al proveedor', async () => {
    const instante = Math.floor(Date.now() / 1000);
    const respuesta = await fetch(`${DIRECCION}/mercadopago/${PRESTADORA}?data.id=PAGO-123`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-request-id': REQUISITORIA,
        'x-signature': `ts=${instante},v1=${'a'.repeat(64)}`,
      },
      body: CRUDO_MP,
    });
    assert.equal(respuesta.status, 401);
    assert.equal(consultasAlProveedor.length, 0);
    assert.equal(escrituras().length, 0);
  });
});

// ---------------------------------------------------------------------------
// Los rieles que no publican cómo firman: Modo, DEBIN y la red de cobranza extrabancaria
// (paso 9 del plan)
//
// Hasta ahora los tres daban por bueno cualquier aviso que trajera un identificador
// —`valido: Boolean(body?.id)`—, y la dirección es pública: alcanzaba con golpear la puerta
// con `{"id": "…", "estado": "aprobado"}` para dar por cobrado un acceso. Ninguno de los
// tres proveedores publica su esquema de firma, así que no se les reprodujo ninguno: se les
// exige la convención que declara este producto (`firmaWebhook.js`,
// `comprobarFirmaSinEsquemaPublicado`) y, sin secreto cargado, se rechaza todo.
//
// Lo que se prueba de cada uno es lo mismo y en el mismo orden: sin secreto no entra nada, con
// firma inventada tampoco, y con la firma bien hecha entra y recién ahí se toca la fila del
// cobro. Si alguna vez se vuelve al `Boolean(body?.id)`, las tres primeras pasan a devolver 200
// y estas pruebas se caen.
// ---------------------------------------------------------------------------

const RIELES_SIN_ESQUEMA = [
  { proveedor: 'modo', variable: 'MODO_SECRETO_FIRMA_WEBHOOK', aviso: { id: 'MODO-1', estado: 'aprobado' } },
  { proveedor: 'debin', variable: 'DEBIN_SECRETO_FIRMA_WEBHOOK', aviso: { id: 'DEBIN-1', estado: 'debitado' } },
  {
    proveedor: 'cobranza_efectivo',
    variable: 'COBRANZA_EFECTIVO_SECRETO_FIRMA_WEBHOOK',
    aviso: { id: 'CUPON-1', estado: 'pagado' },
  },
];

/** La convención que declara este producto: `ts=<instante>,v1=<hmac>` sobre `<instante>.<cuerpo>`. */
function cabeceraDeConvencionPropia(cuerpo, { secreto = SECRETO, instante = Math.floor(Date.now() / 1000) } = {}) {
  const firma = createHmac('sha256', secreto).update(`${instante}.`).update(cuerpo).digest('hex');
  return `ts=${instante},v1=${firma}`;
}

async function avisarRiel(proveedor, cuerpo, { firma } = {}) {
  const respuesta = await fetch(`${DIRECCION}/${proveedor}/${PRESTADORA}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(firma === null ? {} : { 'x-signature': firma ?? cabeceraDeConvencionPropia(cuerpo) }),
    },
    body: cuerpo,
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

for (const { proveedor, variable, aviso } of RIELES_SIN_ESQUEMA) {
  const CRUDO_RIEL = Buffer.from(JSON.stringify(aviso), 'utf8');

  describe(`el aviso de cobro de ${proveedor}, que no publica esquema de firma`, () => {
    it('sin firma alguna se rechaza con 401 y no toca ninguna fila', async () => {
      const { estado, cuerpo } = await avisarRiel(proveedor, CRUDO_RIEL, { firma: null });
      assert.equal(estado, 401);
      assert.equal(cuerpo.error, 'Aviso no autenticado');
      assert.equal(escrituras().length, 0);
    });

    it('con una firma inventada se rechaza con 401 y no toca ninguna fila', async () => {
      const instante = Math.floor(Date.now() / 1000);
      const { estado } = await avisarRiel(proveedor, CRUDO_RIEL, { firma: `ts=${instante},v1=${'a'.repeat(64)}` });
      assert.equal(estado, 401);
      assert.equal(escrituras().length, 0);
    });

    it('firmado con otro secreto se rechaza con 401 y no toca ninguna fila', async () => {
      const firma = cabeceraDeConvencionPropia(CRUDO_RIEL, { secreto: 'otro_secreto_de_mentira' });
      const { estado } = await avisarRiel(proveedor, CRUDO_RIEL, { firma });
      assert.equal(estado, 401);
      assert.equal(escrituras().length, 0);
    });

    it('con un instante viejo se rechaza con 401, aunque la firma esté bien hecha', async () => {
      const viejo = Math.floor(Date.now() / 1000) - 6 * 60;
      const firma = cabeceraDeConvencionPropia(CRUDO_RIEL, { instante: viejo });
      const { estado } = await avisarRiel(proveedor, CRUDO_RIEL, { firma });
      assert.equal(estado, 401);
      assert.equal(escrituras().length, 0);
    });

    it('sin ningún secreto configurado se rechaza TODO aviso, aun bien armado', async () => {
      // Es la posición de fábrica y es a propósito: mientras no se sepa cómo firma el proveedor
      // de verdad, prefiero que no entre ninguno a que entre cualquiera.
      respuestas.set('POST /rest/v1/rpc/leer_secreto_firma_pasarela_pago', () => null);
      const { estado } = await avisarRiel(proveedor, CRUDO_RIEL);
      assert.equal(estado, 401);
      assert.equal(escrituras().length, 0);
      assert.ok(anotados.some((linea) => linea.includes('secreto_de_firma_no_guardado')));
    });

    it('el motivo del rechazo queda anotado del lado del servidor y no viaja en la respuesta', async () => {
      const { cuerpo } = await avisarRiel(proveedor, CRUDO_RIEL, { firma: null });
      assert.deepEqual(Object.keys(cuerpo), ['error']);
      assert.equal(cuerpo.error, 'Aviso no autenticado');
      assert.ok(anotados.some((linea) => linea.includes('cabecera_de_firma_ausente')));
    });

    it('con la firma bien hecha se acepta, marca el cobro y deja el acceso vigente', async () => {
      const { estado, cuerpo } = await avisarRiel(proveedor, CRUDO_RIEL);
      assert.equal(estado, 200);
      assert.deepEqual(cuerpo, { ok: true });

      const cobro = escrituras().find((l) => l.clave.endsWith('/cobros_marketplace'));
      assert.equal(cobro.cuerpo.estado_cobro, 'exitoso');
      const acceso = escrituras().find((l) => l.clave.endsWith('/accesos_marketplace'));
      assert.equal(acceso.cuerpo.estado, 'vigente');
    });

    it('un aviso rechazado deja el cobro exactamente como estaba', async () => {
      // La otra mitad de la prueba de arriba: que el 401 no sea solo un código, sino que la
      // fila del cobro no se haya mirado siquiera.
      await avisarRiel(proveedor, CRUDO_RIEL, { firma: `ts=1,v1=${'b'.repeat(64)}` });
      assert.equal(llamadas.filter((l) => l.clave === 'GET /rest/v1/cobros_marketplace').length, 0);
      assert.equal(escrituras().length, 0);
    });

    it('el secreto de ambiente sirve solo cuando la Prestadora no cargó el suyo', async () => {
      // El de la Prestadora es el que ata la firma a esa Prestadora, así que gana siempre. El
      // de ambiente es la red para el despliegue que todavía no cargó ninguno.
      process.env[variable] = SECRETO_DE_AMBIENTE;
      respuestas.set('POST /rest/v1/rpc/leer_secreto_firma_pasarela_pago', () => null);

      const conElDeAmbiente = await avisarRiel(proveedor, CRUDO_RIEL, {
        firma: cabeceraDeConvencionPropia(CRUDO_RIEL, { secreto: SECRETO_DE_AMBIENTE }),
      });
      assert.equal(conElDeAmbiente.estado, 200);

      // Y con el de la Prestadora cargado, el de ambiente ya no alcanza.
      respuestas.set('POST /rest/v1/rpc/leer_secreto_firma_pasarela_pago', () => SECRETO);
      const otraVezConElDeAmbiente = await avisarRiel(proveedor, CRUDO_RIEL, {
        firma: cabeceraDeConvencionPropia(CRUDO_RIEL, { secreto: SECRETO_DE_AMBIENTE }),
      });
      assert.equal(otraVezConElDeAmbiente.estado, 401);
    });
  });
}

// ---------------------------------------------------------------------------
// El aviso de un riel que cobra solo, donde la referencia es la del acceso
//
// `mercadopago`, `stripe` y `debin` quedan cobrando del lado del proveedor desde el alta de la
// acceso: de este lado nadie arma el cobro de cada período, así que cuando llega el aviso no hay
// ninguna fila que tenga esa referencia. Hasta acá se buscaba únicamente entre los cobros: no se
// encontraba nada, se contestaba 200 y se seguía de largo, así que el acceso cobraba todos
// los meses del lado del proveedor y en esta base no figuraba ninguno.
//
// Lo que se prueba es que el mes se anote, con qué datos, y —sobre todo— las dos formas de
// anotarlo mal, que son las que rompen el mes siguiente en vez de éste.
// ---------------------------------------------------------------------------

/** Un aviso de Stripe armado a medida. El cuerpo va con sangría, como lo manda Stripe. */
function eventoStripe(tipo, objeto = { id: 'sub_1234567890' }) {
  return Buffer.from(JSON.stringify({ type: tipo, data: { object: objeto } }, null, 2), 'utf8');
}

/** La base sin ningún cobro con esa referencia, y un acceso que sí la tiene. */
function sinCobroYConAcceso({ proximoCobro = PERIODO } = {}) {
  respuestas.set('GET /rest/v1/cobros_marketplace', () => []);
  respuestas.set('GET /rest/v1/accesos_marketplace', (_cuerpo, url) =>
    url.includes('referencia_externa=eq.')
      ? [{ id: ACCESO, importe: MONTO_MENSUAL, proximo_cobro: proximoCobro }]
      : [{ id: ACCESO, estado: 'vigente', gracia_hasta: null, proximo_cobro: proximoCobro, formas_de_cobro_marketplace: CADA_MES }]
  );
}

describe('el aviso de un riel que cobra solo, con la referencia del acceso', () => {
  it('anota el cobro del período que el acceso estaba esperando', async () => {
    sinCobroYConAcceso();
    const { estado } = await avisar();
    assert.equal(estado, 200);

    assert.equal(inserciones().length, 1);
    const anotado = inserciones()[0].cuerpo;
    assert.equal(anotado.acceso_id, ACCESO);
    assert.equal(anotado.prestadora_id, PRESTADORA);
    assert.equal(anotado.medio, 'stripe');
    assert.equal(anotado.monto, MONTO_MENSUAL);
    assert.equal(anotado.periodo, PERIODO);
    assert.equal(anotado.estado_cobro, 'exitoso');
  });

  it('el cobro que nace del aviso no se queda con la referencia del acceso', async () => {
    // Si se guardara, el aviso del mes que viene encontraría esta misma fila y pisaría el cobro
    // anterior en vez de anotar uno nuevo: la Familia pagaría doce meses y la base mostraría uno.
    sinCobroYConAcceso();
    await avisar();
    assert.equal(inserciones()[0].cuerpo.referencia_externa ?? null, null);
  });

  it('y el acceso pasa al período siguiente al anotado', async () => {
    sinCobroYConAcceso({ proximoCobro: '2026-01-31' });
    await avisar();

    assert.equal(inserciones()[0].cuerpo.periodo, '2026-01-31');
    const acceso = escrituras().find((l) => l.clave.endsWith('/accesos_marketplace'));
    assert.equal(acceso.cuerpo.estado, 'vigente');
    // El 31 de enero más un mes con `setMonth(+1)` da 3 de marzo, y a partir de ahí el acceso
    // cobra el 3 de cada mes en vez del 31. Acá tiene que dar el último día de febrero.
    assert.equal(acceso.cuerpo.proximo_cobro, '2026-02-28');
  });

  it('un aviso que todavía no dice si la plata entró no deja ninguna fila', async () => {
    // Un `pendiente` no dice nada que se pueda anotar, y el mismo mes puede traer varios antes de
    // que la plata entre: anotarlos chocaría contra el índice único parcial del período pendiente.
    sinCobroYConAcceso();
    const { estado } = await avisar({ cuerpo: eventoStripe('invoice.created') });
    assert.equal(estado, 200);
    assert.equal(inserciones().length, 0);
    assert.equal(escrituras().length, 0);
  });

  it('un aviso fallido anota el período como fallido y le abre la gracia al acceso', async () => {
    sinCobroYConAcceso();
    await avisar({ cuerpo: eventoStripe('invoice.payment_failed') });

    assert.equal(inserciones()[0].cuerpo.estado_cobro, 'fallido');
    const acceso = escrituras().find((l) => l.clave.endsWith('/accesos_marketplace'));
    assert.ok(acceso.cuerpo.gracia_hasta);
    assert.equal(acceso.cuerpo.estado, undefined);
  });

  it('sin cobro y sin acceso con esa referencia se contesta 200 y no se escribe nada', async () => {
    // El aviso vino firmado pero habla de algo que acá no existe. Se contesta 200 para que el
    // proveedor no lo repita para siempre.
    respuestas.set('GET /rest/v1/cobros_marketplace', () => []);
    respuestas.set('GET /rest/v1/accesos_marketplace', () => []);
    const { estado, cuerpo } = await avisar();
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo, { ok: true });
    assert.equal(inserciones().length, 0);
    assert.equal(escrituras().length, 0);
  });

  it('el acceso se busca acotado a la Prestadora de la dirección', async () => {
    sinCobroYConAcceso();
    await avisar();
    const busqueda = llamadas.find(
      (l) => l.clave === 'GET /rest/v1/accesos_marketplace' && l.url.includes('referencia_externa=eq.')
    );
    assert.ok(busqueda.url.includes(`prestadora_id=eq.${PRESTADORA}`));
  });

  it('cuando el cobro sí existe, no se busca ningún acceso por referencia', async () => {
    // La otra mitad: el riel al que este producto le arma el cobro mes a mes ya tiene la fila, y
    // la segunda consulta sería trabajo al pedo contra la base.
    await avisar();
    const porReferencia = llamadas.filter(
      (l) => l.clave === 'GET /rest/v1/accesos_marketplace' && l.url.includes('referencia_externa=eq.')
    );
    assert.equal(porReferencia.length, 0);
    assert.equal(inserciones().length, 0);
  });
});

describe('el aviso de una factura de Stripe', () => {
  it('se busca por la suscripción, no por la factura', async () => {
    // Lo que este producto guardó al dar de alta es la suscripción de Stripe. La factura nace del
    // lado de Stripe y acá no existe: buscar por su identificador equivale a no encontrar nunca
    // nada, y hasta el paso 5 ningún aviso de Stripe imputaba un solo cobro.
    await avisar({ cuerpo: eventoStripe('invoice.paid', { id: 'in_de_una_factura', subscription: 'sub_1234567890' }) });
    const busqueda = llamadas.find((l) => l.clave === 'GET /rest/v1/cobros_marketplace');
    assert.ok(busqueda.url.includes('sub_1234567890'), 'se busca por la suscripción');
    assert.equal(busqueda.url.includes('in_de_una_factura'), false, 'no se busca por la factura');
  });

  it('también cuando Stripe lo pone en el lugar nuevo de su API', async () => {
    const objeto = { id: 'in_de_una_factura', parent: { subscription_details: { subscription: 'sub_1234567890' } } };
    await avisar({ cuerpo: eventoStripe('invoice.paid', objeto) });
    const busqueda = llamadas.find((l) => l.clave === 'GET /rest/v1/cobros_marketplace');
    assert.ok(busqueda.url.includes('sub_1234567890'));
  });

  it('y en la baja de la suscripción, donde el objeto es la suscripción, se usa su identificador', async () => {
    await avisar({ cuerpo: eventoStripe('customer.subscription.deleted') });
    const busqueda = llamadas.find((l) => l.clave === 'GET /rest/v1/cobros_marketplace');
    assert.ok(busqueda.url.includes('sub_1234567890'));
  });
});

describe('los tres rieles sin esquema publicado piden secreto de firma', () => {
  it('el Panel se entera de que se lo tiene que pedir a la Prestadora', async () => {
    // Sin esto, la pantalla de pasarelas no le pide el secreto a nadie y los tres rieles quedan
    // rechazando todo sin que se entienda por qué (`panelMarketplace.js`, `requiere_secreto_firma`).
    const { requiereSecretoFirma } = await import('../../pasarelas/index.js');
    for (const { proveedor } of RIELES_SIN_ESQUEMA) {
      assert.equal(requiereSecretoFirma(proveedor), true, `${proveedor} tiene que pedir secreto de firma`);
    }
  });
});
