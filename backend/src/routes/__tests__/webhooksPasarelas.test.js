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
const SUSCRIPCION = '66666666-6666-6666-6666-666666666666';
const SECRETO = 'whsec_un_secreto_de_mentira_para_la_prueba';

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

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada(crudo ? JSON.parse(crudo) : null) : preparada;
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
  respuestas.set('GET /rest/v1/cobros_marketplace', () => [{ id: COBRO, suscripcion_id: SUSCRIPCION }]);
  respuestas.set('PATCH /rest/v1/cobros_marketplace', () => []);
  respuestas.set('PATCH /rest/v1/suscripciones_marketplace', () => []);
});

function escrituras() {
  return llamadas.filter((l) => l.clave.startsWith('PATCH '));
}

describe('el aviso de cobro auténtico', () => {
  it('se acepta, marca el cobro y deja la suscripción activa', async () => {
    const { estado, cuerpo } = await avisar();
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo, { ok: true });

    const cobro = escrituras().find((l) => l.clave.endsWith('/cobros_marketplace'));
    assert.equal(cobro.cuerpo.estado_cobro, 'exitoso');
    const suscripcion = escrituras().find((l) => l.clave.endsWith('/suscripciones_marketplace'));
    assert.equal(suscripcion.cuerpo.estado, 'activa');
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
    const suscripcion = escrituras().find((l) => l.clave.endsWith('/suscripciones_marketplace'));
    assert.equal(suscripcion.cuerpo.estado, 'activa');
  });

  it('si el proveedor dice que todavía no entró, el cobro queda pendiente y la suscripción sin tocar', async () => {
    respuestaDelProveedor = { status: 'pending' };
    const { estado } = await avisarMercadoPago();
    assert.equal(estado, 200);

    const cobro = escrituras().find((l) => l.clave.endsWith('/cobros_marketplace'));
    assert.equal(cobro.cuerpo.estado_cobro, 'pendiente');
    assert.equal(escrituras().some((l) => l.clave.endsWith('/suscripciones_marketplace')), false);
  });

  it('si el proveedor dice que se canceló, el cobro queda fallido y la suscripción vencida', async () => {
    respuestaDelProveedor = { status: 'cancelled' };
    await avisarMercadoPago();

    const cobro = escrituras().find((l) => l.clave.endsWith('/cobros_marketplace'));
    assert.equal(cobro.cuerpo.estado_cobro, 'fallido');
    const suscripcion = escrituras().find((l) => l.clave.endsWith('/suscripciones_marketplace'));
    assert.equal(suscripcion.cuerpo.estado, 'vencida');
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
