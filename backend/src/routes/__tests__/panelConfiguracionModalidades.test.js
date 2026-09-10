/**
 * Apagar una modalidad de negocio que todavía tiene gente adentro.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El casillero de Configuración > La Prestadora > Modalidades
 * contratadas se apagaba sin mirar nada. Apagarlo no es un ajuste de pantalla: la Prestadora
 * quedaba con Asistentes trabajando de una forma que su propia configuración ya no habilita, y
 * —en el Marketplace— con Familias pagando una suscripción cuya pantalla de cobros acababa de
 * desaparecer del Panel. Nadie se enteraba hasta que algo fallaba más adelante, lejos del
 * casillero que lo causó.
 *
 * Lo que se prueba es el camino entero: se levanta el router de verdad contra una base de
 * mentira, se pide apagar la modalidad en cada situación y se mira qué contesta. En los casos
 * que se rechazan se comprueba, además, que **no haya escrito nada**: un rechazo que igual
 * apagó la modalidad no rechazó nada.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const USUARIO = '22222222-2222-2222-2222-222222222222';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, para poder afirmar que NO pidió algo. */
let llamadas = [];

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
const { panelConfiguracionRouter } = await import('../panelConfiguracion.js');

const app = express();
app.use(express.json());
app.use('/api/panel/configuracion', panelConfiguracionRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/panel/configuracion`;

after(() => {
  motor.close();
  baseFalsa.close();
});

async function apagar(modalidad, activa = false) {
  const respuesta = await fetch(`${DIRECCION}/modalidades/${modalidad}`, {
    method: 'PATCH',
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
    body: JSON.stringify({ activa }),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** Un Asistente cualquiera, de los que el motor sólo mira si hay o no hay. */
const UN_ASISTENTE = [{ id: '44444444-4444-4444-4444-444444444444' }];
/** Una suscripción del Marketplace, ídem. */
const UNA_SUSCRIPCION = [{ id: '55555555-5555-5555-5555-555555555555' }];

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'admin_prestadora', prestadora_id: PRESTADORA }]);
  // Por omisión no hay nada colgando de ninguna modalidad, y guardar sale bien.
  respuestas.set('GET /rest/v1/asistentes', () => []);
  respuestas.set('GET /rest/v1/suscripciones_marketplace', () => []);
  respuestas.set('POST /rest/v1/prestadora_modalidades', () => []);
});

/** Que el rechazo haya sido de verdad: la modalidad quedó como estaba. */
function noApago() {
  const escrituras = llamadas.filter((l) => l.clave === 'POST /rest/v1/prestadora_modalidades');
  assert.deepEqual(escrituras, [], 'el motor apagó la modalidad igual, después de decir que no');
}

/**
 * Que el mensaje no describa la base (CLAUDE.md §6). Se mira el texto, no el motivo: el motivo
 * es un código que la pantalla traduce y nunca se muestra tal cual.
 */
function noFiltraLaBase(cuerpo) {
  const texto = String(cuerpo?.error ?? '');
  assert.doesNotMatch(
    texto,
    /suscripciones_marketplace|prestadora_modalidades|deleted_at|canales|select|column|relation|PGRST/i,
    `el mensaje nombra algo de la base: ${texto}`
  );
}

// ---------------------------------------------------------------------------------------

describe('no se apaga una modalidad que todavía tiene gente adentro', () => {
  it('con Asistentes que trabajan de esa forma', async () => {
    respuestas.set('GET /rest/v1/asistentes', () => UN_ASISTENTE);
    const { estado, cuerpo } = await apagar('marketplace');
    assert.equal(estado, 409);
    assert.equal(cuerpo.motivo, 'modalidad_con_asistentes');
    noApago();
    noFiltraLaBase(cuerpo);
  });

  it('con Familias con la suscripción en curso', async () => {
    respuestas.set('GET /rest/v1/suscripciones_marketplace', () => UNA_SUSCRIPCION);
    const { estado, cuerpo } = await apagar('marketplace');
    assert.equal(estado, 409);
    assert.equal(cuerpo.motivo, 'modalidad_con_suscripciones');
    noApago();
    noFiltraLaBase(cuerpo);
  });

  it('con las dos cosas a la vez lo dice de una sola vez', async () => {
    // Si contestara sólo una, quien apaga resolvería eso, volvería a intentar y se encontraría
    // con el otro rechazo. Se dicen las dos juntas.
    respuestas.set('GET /rest/v1/asistentes', () => UN_ASISTENTE);
    respuestas.set('GET /rest/v1/suscripciones_marketplace', () => UNA_SUSCRIPCION);
    const { estado, cuerpo } = await apagar('marketplace');
    assert.equal(estado, 409);
    assert.equal(cuerpo.motivo, 'modalidad_con_asistentes_y_suscripciones');
    noApago();
    noFiltraLaBase(cuerpo);
  });

  it('también en prestación directa, donde atan los Asistentes', async () => {
    respuestas.set('GET /rest/v1/asistentes', () => UN_ASISTENTE);
    const { estado, cuerpo } = await apagar('directa');
    assert.equal(estado, 409);
    assert.equal(cuerpo.motivo, 'modalidad_con_asistentes');
    noApago();
  });

  it('y en prestación directa no se pregunta por suscripciones, que no existen ahí', async () => {
    await apagar('directa');
    const preguntas = llamadas.map((l) => l.clave);
    assert.ok(!preguntas.includes('GET /rest/v1/suscripciones_marketplace'));
  });
});

describe('cuando no hay nada colgando, se apaga', () => {
  it('contesta que sí y lo guarda', async () => {
    const { estado, cuerpo } = await apagar('marketplace');
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    const escritura = llamadas.find((l) => l.clave === 'POST /rest/v1/prestadora_modalidades');
    assert.ok(escritura, 'dijo que apagó y no escribió nada');
    assert.equal(escritura.cuerpo.activa, false);
    assert.equal(escritura.cuerpo.prestadora_id, PRESTADORA);
  });

  it('pregunta por esta Prestadora, no por cualquiera', async () => {
    await apagar('marketplace');
    const pregunta = llamadas.find((l) => l.clave === 'GET /rest/v1/asistentes');
    assert.ok(pregunta, 'apagó sin mirar si hay Asistentes trabajando de esa forma');
  });
});

describe('encender no comprueba nada', () => {
  it('no hay nada que se rompa por encender una modalidad', async () => {
    // Y si se comprobara, se estaría trabando justo el camino de salida de una Prestadora que
    // quedó con la modalidad apagada y gente adentro.
    respuestas.set('GET /rest/v1/asistentes', () => UN_ASISTENTE);
    respuestas.set('GET /rest/v1/suscripciones_marketplace', () => UNA_SUSCRIPCION);
    const { estado, cuerpo } = await apagar('marketplace', true);
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    const preguntas = llamadas.map((l) => l.clave);
    assert.ok(!preguntas.includes('GET /rest/v1/asistentes'));
  });
});

describe('si no se pudo comprobar, no se apaga', () => {
  it('deja la modalidad como está', async () => {
    // Falla cerrado (CLAUDE.md §5): apagarla sin haber mirado es justamente lo que esta
    // comprobación vino a impedir. La respuesta sin preparar hace que la base conteste error.
    respuestas.delete('GET /rest/v1/asistentes');
    const { estado, cuerpo } = await apagar('marketplace');
    assert.equal(estado, 500);
    noApago();
    noFiltraLaBase(cuerpo);
  });
});
