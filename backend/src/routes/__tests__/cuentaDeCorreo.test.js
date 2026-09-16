/**
 * La cuenta de cuántos correos salieron, contra el límite del despachante.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El correo de todas las Prestadoras sale por un mismo servicio de
 * afuera que acepta hasta cierta cantidad por día y por mes; pasado ese límite deja de aceptar y
 * los avisos no salen. Sin una cuenta propia, el límite se descubre el día que un aviso no sale.
 * Acá hay tres cosas que se rompen sin hacer ruido:
 *
 *   1. QUE UN ENVÍO NO SE CUENTE. Si el motor manda por un camino que no pasa por donde se anota,
 *      la cuenta queda corta y el Panel muestra margen que no existe. Por eso se comprueba sobre
 *      las dos salidas de correo que tiene el motor, no sobre una.
 *   2. QUE UN RECHAZO SE CUENTE COMO ENVÍO. Un correo rechazado es justamente la señal de que se
 *      llegó al límite: si se anota como aceptado, la señal desaparece.
 *   3. QUE LA ANOTACIÓN SE LLEVE PUESTO EL CORREO. Un aviso que salió y no se pudo contar sigue
 *      siendo un aviso que salió. Y al revés: lo que se anota es el hecho, nunca a quién iba,
 *      el asunto ni una línea del contenido (`celtatech/CLAUDE.md` §6).
 *
 * Se levanta el motor de verdad contra una base de mentira, y el despachante se reemplaza por uno
 * que contesta lo que la prueba le diga. Los datos son inventados.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const USUARIO = '22222222-2222-2222-2222-222222222222';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, con la dirección entera. */
let llamadas = [];
/** Cuántas filas dice la base que hay, cuando le preguntan una cuenta. */
let cuantasFilas = 0;
/** Si la base deja anotar. En falso, el insert contesta un error. */
let laBaseDejaAnotar = true;
/** Si el despachante toma el correo. */
let elDespachanteAcepta = true;

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

    // La cuenta se pide sin traer las filas: PostgREST la contesta en el encabezado del rango.
    if (req.method === 'HEAD' && ruta === '/rest/v1/envios_de_correo') {
      res.writeHead(200, { 'Content-Range': `0-0/${cuantasFilas}` });
      res.end();
      return;
    }

    if (req.method === 'POST' && ruta === '/rest/v1/envios_de_correo') {
      if (!laBaseDejaAnotar) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'la base no deja anotar' }));
        return;
      }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([]));
      return;
    }

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

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));

process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';
process.env.RESEND_API_KEY = 'clave-de-mentira';
process.env.REMITENTE_AVISOS = 'avisos@ejemplo.test';
delete process.env.SMTP_USER;

// El despachante de verdad no se toca: se corta el pedido antes de salir, así que la prueba no
// sale a la red. Lo que va a la base falsa pasa de largo.
const fetchDeVerdad = globalThis.fetch;
globalThis.fetch = async (direccion, opciones) => {
  if (String(direccion).startsWith('https://api.resend.com/')) {
    if (!elDespachanteAcepta) return new Response('', { status: 429 });
    return new Response(JSON.stringify({ id: 'envio-de-mentira' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return fetchDeVerdad(direccion, opciones);
};

// El import va después de dejar puestas las variables de entorno: la conexión a la base se arma
// en el momento en que se importa, y con la dirección que haya en ese instante.
const { default: express } = await import('express');
await import('express-async-errors');
const { panelConfiguracionPlataformaRouter } = await import('../panelConfiguracionPlataforma.js');
const { enviarEmail, enviarEmailCoordinador } = await import('../../utils/email.js');

const app = express();
app.use(express.json());
app.use('/api/panel/configuracion-plataforma', panelConfiguracionPlataformaRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/panel/configuracion-plataforma`;

after(() => {
  motor.close();
  baseFalsa.close();
  globalThis.fetch = fetchDeVerdad;
  delete process.env.RESEND_API_KEY;
  delete process.env.REMITENTE_AVISOS;
  delete process.env.TOPE_CORREOS_DIARIO;
  delete process.env.TOPE_CORREOS_MENSUAL;
});

async function pedir(metodo, ruta) {
  const respuesta = await fetch(`${DIRECCION}${ruta}`, {
    method: metodo,
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

function anotaciones() {
  return llamadas.filter((l) => l.clave === 'POST /rest/v1/envios_de_correo');
}

beforeEach(() => {
  llamadas = [];
  cuantasFilas = 0;
  laBaseDejaAnotar = true;
  elDespachanteAcepta = true;
  delete process.env.TOPE_CORREOS_DIARIO;
  delete process.env.TOPE_CORREOS_MENSUAL;
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'superadmin', prestadora_id: null }]);
  respuestas.set('GET /rest/v1/configuracion_plataforma', () => [{ mfa_admin_obligatorio: false }]);
  respuestas.set('GET /rest/v1/sesiones_soporte_tecnico', () => []);
  respuestas.set('GET /rest/v1/prestadoras', () => [
    { casilla_envio: null, nombre_fantasia: null, logo_url: null },
  ]);
  respuestas.set('GET /rest/v1/configuracion_prestadora', () => [{ email: 'contacto@ejemplo.test' }]);
  respuestas.set('GET /rest/v1/configuracion_notificaciones', () => [
    { emails: ['coordinacion@ejemplo.test'], activo: true, whatsapp_activo: false },
  ]);
});

describe('cada correo que sale queda contado', () => {
  it('el que el despachante toma se anota como aceptado', async () => {
    await enviarEmail({
      to: 'alguien@ejemplo.test',
      asunto: 'Un asunto inventado',
      texto: 'Un texto inventado',
      prestadoraId: PRESTADORA,
    });

    const anotado = anotaciones();
    assert.equal(anotado.length, 1, 'el correo salió y no quedó contado: el Panel muestra margen que no existe');
    assert.equal(anotado[0].cuerpo.aceptado, true);
    assert.equal(anotado[0].cuerpo.prestadora_id, PRESTADORA);
  });

  it('el aviso al Coordinador también se cuenta, que es la otra salida de correo', async () => {
    await enviarEmailCoordinador({
      evento: 'un_evento_inventado',
      prestadoraId: PRESTADORA,
      asunto: 'Un asunto inventado',
      texto: 'Un texto inventado',
    });

    assert.equal(anotaciones().length, 1, 'esta salida de correo esquiva la cuenta');
  });

  it('el que el despachante rechaza se anota como rechazado, y el error sale igual', async () => {
    // Un rechazo es justamente la señal de que se llegó al límite. Anotarlo como aceptado, o no
    // anotarlo, borra la señal.
    elDespachanteAcepta = false;

    await assert.rejects(() =>
      enviarEmail({
        to: 'alguien@ejemplo.test',
        asunto: 'Un asunto inventado',
        texto: 'Un texto inventado',
        prestadoraId: PRESTADORA,
      }));

    const anotado = anotaciones();
    assert.equal(anotado.length, 1);
    assert.equal(anotado[0].cuerpo.aceptado, false);
  });

  it('no se anota a quién iba, ni el asunto, ni una línea de lo que decía', async () => {
    await enviarEmail({
      to: 'alguien@ejemplo.test',
      asunto: 'Un asunto inventado',
      texto: 'Un texto inventado',
      prestadoraId: PRESTADORA,
    });

    const escrito = JSON.stringify(anotaciones()[0].cuerpo);
    assert.doesNotMatch(escrito, /alguien@ejemplo\.test|Un asunto inventado|Un texto inventado/);
    assert.deepEqual(Object.keys(anotaciones()[0].cuerpo).sort(), ['aceptado', 'prestadora_id']);
  });

  it('si la anotación falla, el correo sale igual', async () => {
    // Hacer fallar el aviso porque falló su registro sería cambiar un número por una
    // notificación que no llega.
    laBaseDejaAnotar = false;

    await enviarEmail({
      to: 'alguien@ejemplo.test',
      asunto: 'Un asunto inventado',
      texto: 'Un texto inventado',
      prestadoraId: PRESTADORA,
    });
  });
});

describe('cuánto correo salió, desde el Panel', () => {
  it('contesta la cuenta del día y la del mes contra el límite cargado', async () => {
    process.env.TOPE_CORREOS_DIARIO = '100';
    process.env.TOPE_CORREOS_MENSUAL = '3000';
    cuantasFilas = 12;

    const { estado, cuerpo } = await pedir('GET', '/correos');

    assert.equal(estado, 200);
    assert.equal(cuerpo.correos.del_dia, 12);
    assert.equal(cuerpo.correos.del_mes, 12);
    assert.equal(cuerpo.correos.tope_diario, 100);
    assert.equal(cuerpo.correos.tope_mensual, 3000);
  });

  it('el día y el mes se cuentan desde donde arranca cada uno', async () => {
    await pedir('GET', '/correos');

    const cuentas = llamadas.filter((l) => l.clave === 'HEAD /rest/v1/envios_de_correo');
    assert.equal(cuentas.length, 2, 'las dos cuentas no se pidieron por separado');

    const desde = cuentas
      .map((c) => decodeURIComponent(new URL(c.url, 'http://interno').searchParams.get('created_at')))
      .sort();
    const arranqueDelDia = desde[1].replace('gte.', '');
    const arranqueDelMes = desde[0].replace('gte.', '');
    assert.match(arranqueDelDia, /T00:00:00\.000Z$/, 'el día no arranca donde lo cuenta el despachante');
    assert.match(arranqueDelMes, /-01T00:00:00\.000Z$/, 'el mes no arranca el día primero');
  });

  it('sin límite cargado contesta la cuenta y ningún límite, en vez de inventar uno', async () => {
    // Un límite inventado haría creer que queda margen donde no se sabe cuánto queda.
    cuantasFilas = 7;

    const { cuerpo } = await pedir('GET', '/correos');

    assert.equal(cuerpo.correos.del_dia, 7);
    assert.equal(cuerpo.correos.tope_diario, null);
    assert.equal(cuerpo.correos.tope_mensual, null);
  });

  it('quien administra una sola Prestadora no ve la cuenta de la plataforma', async () => {
    // El límite es de la cuenta entera del despachante, no de una Prestadora: quien administra
    // una sola no tiene por qué ver cuánto mandan las demás.
    respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'admin_prestadora', prestadora_id: PRESTADORA }]);

    const { estado } = await pedir('GET', '/correos');
    assert.equal(estado, 403);
  });
});
