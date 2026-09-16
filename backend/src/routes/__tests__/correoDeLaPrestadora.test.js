/**
 * La casilla a la que vuelven las respuestas, desde Configuración del Panel.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Cada Prestadora manda sus avisos desde una dirección del producto
 * que sólo manda; quien le conteste le escribe a un buzón que no existe, y para que esa respuesta
 * llegue hay un reenvío hacia la casilla que la Prestadora declaró. Esa casilla se cambia desde
 * esta pantalla, y ahí hay tres cosas que se rompen sin hacer ruido:
 *
 *   1. QUE LAS RESPUESTAS SIGAN YENDO A LA CASILLA VIEJA. Cambiar la casilla no es agregar una:
 *      el reenvío anterior sigue abierto si nadie lo corta, y quien conteste un aviso le escribe
 *      a quien ya no tiene que leerlo.
 *   2. QUE EL MOTOR PIERDA CON QUÉ CORTARLO. El identificador de la regla nueva se anota en la
 *      fila de la Prestadora; sin eso, el día que se vaya queda un reenvío abierto para siempre.
 *   3. QUE LA PANTALLA NO PUEDA EXPLICAR NADA. Las dos fallas posibles —el servicio sin
 *      configurar y la casilla sin confirmar por su dueño— se avisan en el Panel y nunca por
 *      correo, porque lo que falló es justamente el correo. Para poder avisarlas, la ruta las
 *      tiene que contestar.
 *
 * Se levanta el motor de verdad contra una base de mentira y contra un servicio de reenvío de
 * mentira, y se mira qué pidió cada uno. Los datos son inventados.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const USUARIO = '22222222-2222-2222-2222-222222222222';
const CUENTA = 'cuenta-de-mentira';
const ZONA = 'zona-de-mentira';
const REGLA_VIEJA = 'regla-vieja';
const REGLA_NUEVA = 'regla-nueva';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, con la dirección entera. */
let llamadas = [];
/** Todo lo que el motor le pidió al servicio de reenvío. */
let pedidosDeReenvio = [];
/** Si la casilla de respuestas figura confirmada por su dueño. */
let casillaConfirmada = true;

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
    const valor = typeof preparada === 'function' ? preparada({ cuerpo, url: req.url }) : preparada;
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

// El servicio de reenvío, de mentira. Contesta con la forma que tiene el de verdad: todo adentro
// de `result`, y una regla nueva trae su identificador en `tag`.
const reenvioFalso = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const { pathname } = new URL(req.url, 'http://interno');
    pedidosDeReenvio.push({
      clave: `${req.method} ${pathname}`,
      cuerpo: crudo ? JSON.parse(crudo) : null,
    });

    let resultado = {};
    if (req.method === 'GET' && pathname.endsWith('/email/routing/addresses')) {
      resultado = [{ email: 'respuestas@ejemplo.test', verified: casillaConfirmada ? new Date().toISOString() : null }];
    }
    if (req.method === 'POST' && pathname.endsWith('/email/routing/rules')) {
      resultado = { tag: REGLA_NUEVA };
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result: resultado }));
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
await new Promise((listo) => reenvioFalso.listen(0, '127.0.0.1', listo));

process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';
process.env.REMITENTE_AVISOS = 'avisos@ejemplo.test';
process.env.CLOUDFLARE_API_BASE = `http://127.0.0.1:${reenvioFalso.address().port}`;
process.env.CLOUDFLARE_EMAIL_ROUTING_TOKEN = 'token-de-mentira';
process.env.CLOUDFLARE_ACCOUNT_ID = CUENTA;
process.env.CLOUDFLARE_ZONE_ID = ZONA;

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
  reenvioFalso.close();
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
  pedidosDeReenvio = [];
  casillaConfirmada = true;
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'admin_prestadora', prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/configuracion_plataforma', () => [{ mfa_admin_obligatorio: false }]);
  respuestas.set('GET /rest/v1/sesiones_soporte_tecnico', () => []);
  // Las dos columnas que se le preguntan a la Prestadora, juntas: la casilla desde la que manda y
  // el reenvío que tiene abierto hoy.
  respuestas.set('GET /rest/v1/prestadoras', () => [
    { casilla_envio: 'unaprestadora', regla_reenvio: REGLA_VIEJA },
  ]);
  respuestas.set('PATCH /rest/v1/prestadoras', () => []);
  respuestas.set('GET /rest/v1/configuracion_prestadora', () => [{ email: 'respuestas@ejemplo.test' }]);
  respuestas.set('PATCH /rest/v1/configuracion_prestadora', () => [{ prestadora_id: PRESTADORA }]);
});

describe('leer cómo está el correo de la Prestadora', () => {
  it('contesta desde dónde manda, adónde vuelven las respuestas y en qué estado está el reenvío', async () => {
    const { estado, cuerpo } = await pedir('GET', '/correo');

    assert.equal(estado, 200);
    assert.equal(cuerpo.correo.direccion_envio, 'unaprestadora@ejemplo.test');
    assert.equal(cuerpo.correo.email_respuestas, 'respuestas@ejemplo.test');
    assert.equal(cuerpo.correo.reenvio_abierto, true);
    assert.equal(cuerpo.correo.respuestas_confirmadas, true);
    assert.equal(cuerpo.correo.servicio_configurado, true);
  });

  it('la casilla que su dueño todavía no confirmó se cuenta como sin confirmar', async () => {
    // Es la falla que hay que poder avisar en el Panel: el reenvío está abierto y aun así las
    // respuestas no llegan, porque falta un clic que da una persona del otro lado.
    casillaConfirmada = false;

    const { cuerpo } = await pedir('GET', '/correo');
    assert.equal(cuerpo.correo.reenvio_abierto, true);
    assert.equal(cuerpo.correo.respuestas_confirmadas, false);
  });

  it('lo que lee es de su propia Prestadora', async () => {
    await pedir('GET', '/correo');
    const busqueda = llamadas.find((l) => l.clave === 'GET /rest/v1/configuracion_prestadora');
    assert.ok(busqueda.url.includes(`prestadora_id=eq.${PRESTADORA}`));
  });
});

describe('cambiar la casilla a la que vuelven las respuestas', () => {
  it('la guarda, corta el reenvío anterior y abre el nuevo hacia la casilla nueva', async () => {
    const { estado, cuerpo } = await pedir('PATCH', '/correo', {
      email_respuestas: 'otra@ejemplo.test',
    });

    assert.equal(estado, 200);

    const guardada = llamadas.find((l) => l.clave === 'PATCH /rest/v1/configuracion_prestadora');
    assert.equal(guardada.cuerpo.email, 'otra@ejemplo.test');
    assert.ok(guardada.url.includes(`prestadora_id=eq.${PRESTADORA}`));

    const corte = pedidosDeReenvio.find((p) => p.clave === `DELETE /zones/${ZONA}/email/routing/rules/${REGLA_VIEJA}`);
    assert.ok(corte, 'el reenvío anterior quedó abierto: las respuestas seguirían yendo a la casilla vieja');

    const apertura = pedidosDeReenvio.find((p) => p.clave === `POST /zones/${ZONA}/email/routing/rules`);
    assert.ok(apertura, 'no se abrió el reenvío hacia la casilla nueva');
    assert.deepEqual(apertura.cuerpo.actions[0].value, ['otra@ejemplo.test']);
    assert.equal(apertura.cuerpo.matchers[0].value, 'unaprestadora@ejemplo.test');

    assert.equal(cuerpo.correo.email_respuestas, 'respuestas@ejemplo.test');
  });

  it('anota en la Prestadora con qué se corta el reenvío nuevo', async () => {
    await pedir('PATCH', '/correo', { email_respuestas: 'otra@ejemplo.test' });

    const anotada = llamadas.find((l) => l.clave === 'PATCH /rest/v1/prestadoras');
    assert.ok(anotada, 'la regla nueva no quedó anotada: el día que la Prestadora se vaya no hay con qué cortarla');
    assert.equal(anotada.cuerpo.regla_reenvio, REGLA_NUEVA);
  });

  it('una casilla mal escrita se rechaza con su motivo, y nada se toca', async () => {
    const { estado, cuerpo } = await pedir('PATCH', '/correo', { email_respuestas: 'esto no es un correo' });

    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'correo_invalido');
    // Y el motivo es todo lo que sale: nada que nombre una tabla ni una columna de la base
    // (`celtatech/CLAUDE.md` §6).
    assert.doesNotMatch(JSON.stringify(cuerpo), /configuracion_prestadora|select|column|relation/i);
    // Ni la base ni el servicio de reenvío se enteraron: un dato mal cargado se corta antes.
    assert.equal(llamadas.some((l) => l.clave.startsWith('PATCH /rest/v1/')), false);
    assert.deepEqual(pedidosDeReenvio, []);
  });
});
