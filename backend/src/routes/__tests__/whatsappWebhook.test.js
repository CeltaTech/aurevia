/**
 * Pruebas de la entrada de WhatsApp (pendiente #165).
 *
 * Lo que se prueba acá es lo que hacía falta y no estaba: que un aviso que no se puede probar
 * auténtico se rechace con 401 **antes de escribir una sola fila**, que la Prestadora salga de
 * la dirección y nunca del cuerpo del pedido, y que el saludo inicial de Meta se conteste con
 * el token de esa Prestadora y no con una variable de entorno única para todo el producto.
 *
 * Cada prueba de rechazo está escrita para fallar si se saca la comprobación: si la firma
 * dejara de mirarse, el aviso con firma cambiada contestaría 200 y escribiría, que es
 * exactamente lo que se afirma que no pasa.
 *
 * Se levanta el motor de verdad contra una base de mentira que contesta lo que cada prueba le
 * prepara, igual que `webhooksPasarelas.test.js`.
 *
 *   npm test --prefix backend
 */
import { strict as assert } from 'node:assert';
import { after, afterEach, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const CONVERSACION = '22222222-2222-2222-2222-222222222222';
const MENSAJE = '33333333-3333-3333-3333-333333333333';
const APP_SECRET = 'un_secreto_de_aplicacion_de_mentira';
const TOKEN_DE_SALUDO = 'un-token-de-verificacion-de-mentira';
const NUMERO_CONFIGURADO = '5490000000001';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base. */
let llamadas = [];
/** Los rechazos y avisos que el motor dejó anotados del lado del servidor. */
let anotados = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    const cuerpo = crudo ? JSON.parse(crudo) : null;
    llamadas.push({ clave, url: req.url, cuerpo });

    const preparada = respuestas.get(clave);
    // Al preparador se le pasa la dirección entera, no solo el cuerpo: hay dos consultas
    // distintas que caen en `GET /rest/v1/mensajes_whatsapp` —la que pregunta si ese mensaje ya
    // está anotado y la que trae el historial— y lo único que las distingue es el filtro.
    const valor = typeof preparada === 'function' ? preparada({ url: req.url, cuerpo }) : preparada;
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

// Sin clave de Anthropic la redacción con inteligencia artificial devuelve su respuesta de
// emergencia sin salir a la red, y el mensaje queda escalado al Coordinador. Es lo que se
// quiere acá: la prueba mira quién escribe en la base, no qué contesta el modelo.
delete process.env.ANTHROPIC_API_KEY;

// La variable de entorno vieja se deja puesta A PROPÓSITO: una de las pruebas comprueba que ya
// no sirva para nada, que es la mitad del pendiente que hablaba del token único global.
process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'el-token-global-que-ya-no-vale';

// El import va después de dejar puestas las variables de entorno: la conexión a la base se arma
// en el momento en que se importa.
const { default: express } = await import('express');
await import('express-async-errors');
const { whatsappWebhookRouter } = await import('../whatsappWebhook.js');

// Se monta igual que en `server.js`: el router solo, sin `express.json()` delante. El router
// trae adentro su propio lector de cuerpo crudo.
const app = express();
app.use('/api/whatsapp-webhook', whatsappWebhookRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/whatsapp-webhook`;

// Los rechazos se anotan del lado del servidor; acá se juntan en vez de imprimirse, para que la
// prueba pueda comprobar que quedaron anotados y para no ensuciar la salida.
const avisarDeVerdad = console.warn;
console.warn = (...partes) => anotados.push(partes.join(' '));

after(() => {
  console.warn = avisarDeVerdad;
  motor.close();
  baseFalsa.close();
});

const EVENTO = {
  entry: [
    {
      changes: [
        {
          value: {
            metadata: { phone_number_id: NUMERO_CONFIGURADO },
            messages: [{ id: 'wamid.DEMENTIRA1', from: '5490000000002', type: 'text', text: { body: 'Buenas, consulto por la guardia de mañana.' } }],
          },
        },
      ],
    },
  ],
};
// Con sangría y saltos de línea a propósito: si en el camino alguien rearmara el cuerpo a
// partir del objeto leído, los bytes cambiarían y la firma dejaría de dar.
const CRUDO = Buffer.from(JSON.stringify(EVENTO, null, 2), 'utf8');

function firmaDe(cuerpo, secreto = APP_SECRET) {
  return `sha256=${createHmac('sha256', secreto).update(cuerpo).digest('hex')}`;
}

async function avisar({ cuerpo = CRUDO, firma, tipoDeContenido = 'application/json', prestadora = PRESTADORA } = {}) {
  const respuesta = await fetch(`${DIRECCION}/${prestadora}`, {
    method: 'POST',
    headers: {
      'Content-Type': tipoDeContenido,
      ...(firma === null ? {} : { 'X-Hub-Signature-256': firma ?? firmaDe(cuerpo) }),
    },
    body: cuerpo,
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

async function saludar({ token = TOKEN_DE_SALUDO, modo = 'subscribe', prestadora = PRESTADORA } = {}) {
  const respuesta = await fetch(
    `${DIRECCION}/${prestadora}?hub.mode=${modo}&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=1234567890`,
  );
  return { estado: respuesta.status, cuerpo: await respuesta.text() };
}

/** El motor contesta 200 y sigue trabajando después: lo que escribe en la base no está listo
 *  cuando vuelve la respuesta. Se espera a que pase lo que la prueba está por mirar, en vez de
 *  dormir un rato fijo y esperar que alcance. */
async function esperarA(condicion, { intentos = 200, cada = 10 } = {}) {
  for (let i = 0; i < intentos; i += 1) {
    if (condicion()) return true;
    await new Promise((listo) => setTimeout(listo, cada));
  }
  return false;
}

/** Para afirmar que algo **no** pasó hay que darle tiempo a pasar. Se espera a la última señal
 *  que sí se espera ver y después se deja correr un momento más: si el trabajo siguiera, la
 *  escritura caería adentro de esa ventana y la prueba fallaría, que es lo que se quiere. */
async function dejarTerminar() {
  await new Promise((listo) => setTimeout(listo, 100));
}

/** El motor contesta 200 y recién después sigue trabajando, así que cuando una prueba termina
 *  puede quedar trabajo suyo en el aire. Sin esperarlo, esas escrituras caen adentro de la prueba
 *  siguiente —que ya limpió la lista— y aparecen como filas escritas por un aviso que en realidad
 *  se rechazó: la prueba acusa un defecto que está en la prueba anterior, no en el motor. Se
 *  espera a que la base de mentira deje de recibir pedidos. */
async function esperarQuietud({ quieto = 80, tope = 5000 } = {}) {
  const arranque = Date.now();
  let cuantas = -1;
  while (Date.now() - arranque < tope) {
    if (llamadas.length === cuantas) return;
    cuantas = llamadas.length;
    await new Promise((listo) => setTimeout(listo, quieto));
  }
}

/** La base con todo cargado: configuración de WhatsApp de la Prestadora, secreto de la
 *  aplicación, token del saludo y ningún mensaje anotado todavía. */
beforeEach(() => {
  llamadas = [];
  anotados = [];
  respuestas.clear();
  respuestas.set('GET /rest/v1/configuracion_whatsapp_prestadora', () => [
    { phone_number_id: NUMERO_CONFIGURADO, app_secret_secret_id: 'aaaaaaaa-0000-4000-8000-000000000000' },
  ]);
  respuestas.set('POST /rest/v1/rpc/leer_app_secret_whatsapp', () => APP_SECRET);
  respuestas.set('POST /rest/v1/rpc/leer_verify_token_whatsapp', () => TOKEN_DE_SALUDO);
  respuestas.set('GET /rest/v1/mensajes_whatsapp', () => []);
  respuestas.set('POST /rest/v1/conversaciones_whatsapp', () => [{ id: CONVERSACION }]);
  respuestas.set('POST /rest/v1/mensajes_whatsapp', () => [{ id: MENSAJE }]);
  respuestas.set('PATCH /rest/v1/conversaciones_whatsapp', () => []);
});

// Ninguna prueba le deja trabajo en el aire a la que sigue.
afterEach(esperarQuietud);

/** Lo que el motor escribió en la base. Las llamadas a funciones (`/rpc/`) quedan afuera: leer
 *  un secreto no es escribir. */
function escrituras() {
  return llamadas.filter((l) => (l.clave.startsWith('POST ') || l.clave.startsWith('PATCH ')) && !l.clave.includes('/rpc/'));
}

function secretosLeidos() {
  return llamadas.filter((l) => l.clave.startsWith('POST /rest/v1/rpc/'));
}

describe('el aviso entrante de WhatsApp auténtico', () => {
  it('se acepta, anota el mensaje y deja la conversación esperando al Coordinador', async () => {
    const { estado, cuerpo } = await avisar();
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo, { ok: true });

    await esperarA(() => escrituras().some((l) => l.clave.startsWith('PATCH ')));

    const entrante = escrituras().find((l) => l.clave === 'POST /rest/v1/mensajes_whatsapp' && l.cuerpo.direccion === 'entrante');
    assert.equal(entrante.cuerpo.prestadora_id, PRESTADORA);
    assert.equal(entrante.cuerpo.meta_message_id, 'wamid.DEMENTIRA1');

    const conversacion = escrituras().find((l) => l.clave === 'PATCH /rest/v1/conversaciones_whatsapp');
    assert.equal(conversacion.cuerpo.requiere_atencion_coordinador, true);
  });

  it('la Prestadora sale de la dirección, no del cuerpo del pedido', async () => {
    await avisar();
    const busqueda = llamadas.find((l) => l.clave === 'GET /rest/v1/configuracion_whatsapp_prestadora');
    assert.ok(busqueda.url.includes(`prestadora_id=eq.${PRESTADORA}`));
    // Esta es la parte del defecto: antes la Prestadora se averiguaba buscando por el
    // `phone_number_id` que venía adentro del cuerpo, o sea que la elegía quien llamaba.
    assert.equal(busqueda.url.includes('phone_number_id=eq.'), false);
  });

  it('todo lo que se escribe queda contra la Prestadora de la dirección', async () => {
    await avisar();
    await esperarA(() => escrituras().some((l) => l.clave.startsWith('PATCH ')));
    for (const escritura of escrituras()) {
      if (escritura.cuerpo && 'prestadora_id' in escritura.cuerpo) {
        assert.equal(escritura.cuerpo.prestadora_id, PRESTADORA);
      }
    }
  });
});

describe('el aviso entrante que no se puede probar auténtico', () => {
  it('con la firma cambiada se rechaza con 401 y no toca ninguna fila', async () => {
    const { estado } = await avisar({ firma: `sha256=${'a'.repeat(64)}` });
    assert.equal(estado, 401);
    await dejarTerminar();
    assert.equal(escrituras().length, 0);
  });

  it('firmado con otro secreto se rechaza con 401 y no toca ninguna fila', async () => {
    const { estado } = await avisar({ firma: firmaDe(CRUDO, 'otro_secreto_cualquiera') });
    assert.equal(estado, 401);
    await dejarTerminar();
    assert.equal(escrituras().length, 0);
  });

  it('sin cabecera de firma se rechaza con 401', async () => {
    const { estado } = await avisar({ firma: null });
    assert.equal(estado, 401);
    await dejarTerminar();
    assert.equal(escrituras().length, 0);
  });

  it('con una cabecera que no se entiende se rechaza con 401', async () => {
    const { estado } = await avisar({ firma: 'sha1=loquesea' });
    assert.equal(estado, 401);
    await dejarTerminar();
    assert.equal(escrituras().length, 0);
  });

  it('sin secreto de la aplicación guardado se rechaza con 401', async () => {
    respuestas.set('POST /rest/v1/rpc/leer_app_secret_whatsapp', () => null);
    const { estado } = await avisar();
    assert.equal(estado, 401);
    await dejarTerminar();
    assert.equal(escrituras().length, 0);
  });

  it('sin configuración de WhatsApp se corta antes de leer ningún secreto', async () => {
    respuestas.set('GET /rest/v1/configuracion_whatsapp_prestadora', () => []);
    const { estado } = await avisar();
    assert.equal(estado, 401);
    await dejarTerminar();
    assert.equal(secretosLeidos().length, 0);
    assert.equal(escrituras().length, 0);
  });

  it('con una Prestadora que no tiene forma de identificador no se llega ni a mirar la base', async () => {
    const { estado } = await avisar({ prestadora: 'la-prestadora-que-yo-diga' });
    assert.equal(estado, 401);
    await dejarTerminar();
    assert.equal(llamadas.length, 0);
  });

  it('el motivo queda anotado del lado del servidor, y no viaja en la respuesta', async () => {
    const { cuerpo } = await avisar({ firma: null });
    assert.equal(cuerpo.error, 'Aviso no autenticado');
    assert.ok(anotados.some((linea) => linea.includes('cabecera_de_firma_ausente')));
  });
});

describe('el cuerpo crudo del aviso', () => {
  it('llega tal cual se mandó: la firma se calcula sobre esos bytes y coincide', async () => {
    assert.ok(CRUDO.includes('\n'));
    const { estado } = await avisar({ cuerpo: CRUDO });
    assert.equal(estado, 200);
  });

  it('con un tipo de contenido que no es JSON no hay cuerpo crudo, y se rechaza', async () => {
    const { estado } = await avisar({ tipoDeContenido: 'text/plain' });
    assert.equal(estado, 401);
    await dejarTerminar();
    assert.equal(escrituras().length, 0);
  });

  it('un cuerpo firmado pero ilegible se rechaza con 400 sin escribir nada', async () => {
    const basura = Buffer.from('esto no es json', 'utf8');
    const { estado } = await avisar({ cuerpo: basura });
    assert.equal(estado, 400);
    await dejarTerminar();
    assert.equal(escrituras().length, 0);
  });

  it('en server.js el router va montado ANTES del lector de JSON general', () => {
    // Esta es la parte que se rompe en silencio: si algún día alguien mueve esta línea al montón
    // de las demás rutas, `express.json()` se queda con el pedido primero, la ruta nunca vuelve
    // a ver los bytes originales y TODOS los avisos —también los auténticos— pasan a
    // rechazarse. No hay forma de probarlo levantando el servidor de verdad (arranca sus
    // procesos periódicos y se queda escuchando), así que se comprueba el orden escrito.
    const servidor = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    const montaje = servidor.indexOf("app.use('/api/whatsapp-webhook'");
    const lectorJson = servidor.indexOf('app.use(express.json())');
    assert.ok(montaje > 0, 'el router de WhatsApp tiene que estar montado en server.js');
    assert.ok(lectorJson > 0, 'el lector de JSON general tiene que estar en server.js');
    assert.ok(montaje < lectorJson, 'el router de WhatsApp va antes del express.json() general');
  });
});

describe('el saludo inicial con el que Meta conecta la dirección', () => {
  it('con el token de esa Prestadora devuelve el desafío', async () => {
    const { estado, cuerpo } = await saludar();
    assert.equal(estado, 200);
    assert.equal(cuerpo, '1234567890');
  });

  it('el token sale de la caja fuerte de esa Prestadora, y se pide por su identificador', async () => {
    await saludar();
    const lectura = llamadas.find((l) => l.clave === 'POST /rest/v1/rpc/leer_verify_token_whatsapp');
    assert.equal(lectura.cuerpo.p_prestadora_id, PRESTADORA);
  });

  it('con otro token se rechaza con 403', async () => {
    const { estado } = await saludar({ token: 'cualquier-otra-cosa' });
    assert.equal(estado, 403);
  });

  it('sin token guardado para esa Prestadora se rechaza con 403', async () => {
    respuestas.set('POST /rest/v1/rpc/leer_verify_token_whatsapp', () => null);
    const { estado } = await saludar();
    assert.equal(estado, 403);
    assert.ok(anotados.some((linea) => linea.includes('token_de_verificacion_no_guardado')));
  });

  it('el token único global de la variable de entorno ya no sirve', async () => {
    // La mitad del pendiente #165: antes este texto abría la puerta de CUALQUIER Prestadora,
    // porque era uno solo para todo el producto. Si alguien lo vuelve a leer de ahí, esta
    // prueba pasa a contestar 200 y falla.
    const { estado } = await saludar({ token: process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN });
    assert.equal(estado, 403);
  });

  it('con una Prestadora que no tiene forma de identificador no se llega ni a mirar la base', async () => {
    const { estado } = await saludar({ prestadora: 'la-prestadora-que-yo-diga' });
    assert.equal(estado, 403);
    assert.equal(llamadas.length, 0);
  });
});

describe('el aviso auténtico que no corresponde atender', () => {
  it('el mismo mensaje mandado dos veces se anota una sola', async () => {
    // La firma de Meta no lleva instante adentro, así que un aviso auténtico copiado sigue
    // dando firma buena. Lo que corta el reenvío es el identificador del mensaje.
    respuestas.set('GET /rest/v1/mensajes_whatsapp', ({ url }) =>
      url.includes('meta_message_id=eq.') ? [{ id: MENSAJE }] : [],
    );
    const { estado } = await avisar();
    assert.equal(estado, 200);

    await esperarA(() => llamadas.some((l) => l.clave === 'GET /rest/v1/mensajes_whatsapp'));
    await dejarTerminar();
    assert.equal(escrituras().length, 0);
  });

  it('un aviso de un número que no es el configurado no se procesa', async () => {
    const otroNumero = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '5490000000999' },
                messages: [{ id: 'wamid.DEMENTIRA2', from: '5490000000002', type: 'text', text: { body: 'Hola.' } }],
              },
            },
          ],
        },
      ],
    };
    const cuerpo = Buffer.from(JSON.stringify(otroNumero), 'utf8');
    const { estado } = await avisar({ cuerpo });
    assert.equal(estado, 200);

    await esperarA(() => anotados.some((linea) => linea.includes('no es el configurado')));
    await dejarTerminar();
    assert.equal(escrituras().length, 0);
  });
});
