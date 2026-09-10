/**
 * Encender una función de riesgo legal deja registrado que se avisó.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. `docs/legal/argentina.md` describe cinco funciones de la
 * modalidad marketplace que en Argentina acercan el vínculo con el Asistente a una relación de
 * dependencia, y para cada una tiene escrito el texto que hay que mostrar antes de encenderla.
 * El producto no bloquea ninguna: avisa, y queda registrado que avisó (CLAUDE.md §7).
 *
 * Hasta el 2026-09-10 ese registro lo escribía el navegador al cerrar el cartel, así que
 * dependía de que la pantalla se acordara de escribirlo: cualquier otro camino hasta la misma
 * acción encendía la función sin dejar rastro. Un registro que se puede saltear no sirve como
 * registro. Ahora lo escribe el motor en el mismo pedido que enciende la función, y eso es lo
 * que se prueba acá: no la función que arma la fila —eso sería probar un `insert`—, sino el
 * camino entero, desde el pedido del Panel hasta lo que el motor le manda a la base.
 *
 * Las cuatro cosas que se comprueban, y las cuatro pueden fallar:
 *
 *   1. Encender deja la fila de auditoría, con quién, qué función, qué jurisdicción y qué
 *      texto exacto se mostró.
 *   2. Apagar no deja ninguna: lo que el documento advierte es de usar la función.
 *   3. Una jurisdicción sin documento escrito enciende igual y no registra nada. El aviso que
 *      no existe no se improvisa, y su ausencia nunca se convierte en un impedimento.
 *   4. Si el registro falla, la función se enciende igual. Al revés sería el producto
 *      bloqueando por una razón legal, que es justo lo que la regla prohíbe.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const USUARIO = '22222222-2222-2222-2222-222222222222';
const FUNCION = 'ranking_plataforma';
const TEXTO_ARGENTINO =
  'Un ranking calculado por la plataforma que condiciona si el Asistente sigue visible para cualquier Familia puede interpretarse como la plataforma decidiendo su acceso al trabajo en general, un indicio de subordinación bajo el art. 23 de la LCT — mismo hecho que pesó en contra de Uber en el caso Aslam (Reino Unido, 2021).';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, para poder afirmar qué escribió y qué no. */
let llamadas = [];

let rolDelUsuario = 'admin_prestadora';
/** El país de la Prestadora: es lo que decide cuál documento legal aplica. */
let paisDeLaPrestadora = 'AR';

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

/** Lo que el motor le mandó a la base para esa tabla, ya desenvuelto si vino como lista. */
function escrituras(tabla) {
  return llamadas
    .filter((l) => l.clave === `POST /rest/v1/${tabla}`)
    .map((l) => (Array.isArray(l.cuerpo) ? l.cuerpo[0] : l.cuerpo));
}

beforeEach(() => {
  llamadas = [];
  rolDelUsuario = 'admin_prestadora';
  paisDeLaPrestadora = 'AR';
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: rolDelUsuario, prestadora_id: PRESTADORA }]);
  respuestas.set('POST /rest/v1/rpc/prestadora_tiene_modalidad_activa', () => true);
  // El catálogo de las cinco funciones sale de la base, no de una lista escrita en el motor.
  respuestas.set('GET /rest/v1/catalogo_funciones_marketplace', () => [{ clave: FUNCION, orden: 1 }]);
  respuestas.set('GET /rest/v1/configuracion_funciones_marketplace', () => []);
  respuestas.set('POST /rest/v1/configuracion_funciones_marketplace', () => []);
  respuestas.set('GET /rest/v1/prestadoras', () => [{ pais: paisDeLaPrestadora }]);
  // El texto escrito para Argentina. Otro país no tiene fila, y eso es lo que se prueba abajo.
  respuestas.set('GET /rest/v1/advertencias_legales', () =>
    paisDeLaPrestadora === 'AR' ? [{ funcion_clave: FUNCION, texto_advertencia: TEXTO_ARGENTINO }] : []
  );
  respuestas.set('POST /rest/v1/auditoria_advertencias_legales', () => []);
});

describe('encender una función de riesgo legal', () => {
  it('la enciende y deja registrado que se avisó', async () => {
    const { estado, cuerpo } = await pedir('PUT', `/funciones-riesgo/${FUNCION}`, { activa: true });
    assert.equal(estado, 200);
    assert.equal(cuerpo.activa, true);
    assert.equal(cuerpo.advertencia.texto, TEXTO_ARGENTINO);

    const encendida = escrituras('configuracion_funciones_marketplace');
    assert.equal(encendida.length, 1, 'la función no se encendió');
    assert.equal(encendida[0].prestadora_id, PRESTADORA);
    assert.equal(encendida[0].funcion_clave, FUNCION);
    assert.equal(encendida[0].activa, true);

    const registro = escrituras('auditoria_advertencias_legales');
    assert.equal(registro.length, 1, 'se encendió la función sin dejar registrado el aviso');
    assert.deepEqual(registro[0], {
      prestadora_id: PRESTADORA,
      usuario_id: USUARIO,
      funcion_clave: FUNCION,
      jurisdiccion: 'AR',
      // El texto que se registra es el del documento legal, palabra por palabra: el registro
      // sirve para saber exactamente qué se le mostró a esa persona ese día.
      texto_mostrado: TEXTO_ARGENTINO,
    });
  });

  it('la Prestadora de la que se registra es la de la sesión, no una que venga en el pedido', async () => {
    await pedir('PUT', `/funciones-riesgo/${FUNCION}`, { activa: true, prestadora_id: 'otra' });
    const registro = escrituras('auditoria_advertencias_legales');
    assert.equal(registro[0].prestadora_id, PRESTADORA);
  });
});

describe('apagarla no avisa nada', () => {
  it('no registra: lo que se advierte es de usar la función, no de dejar de usarla', async () => {
    const { estado } = await pedir('PUT', `/funciones-riesgo/${FUNCION}`, { activa: false });
    assert.equal(estado, 200);
    assert.equal(escrituras('configuracion_funciones_marketplace').length, 1);
    assert.deepEqual(escrituras('auditoria_advertencias_legales'), []);
  });
});

describe('un país sin documento legal escrito', () => {
  it('enciende igual y no registra nada', async () => {
    // Si el país no tiene documento, no hay aviso: no se deduce por parecido con otro país, y
    // la falta de texto no se convierte en un impedimento (CLAUDE.md §7).
    paisDeLaPrestadora = 'UY';
    const { estado, cuerpo } = await pedir('PUT', `/funciones-riesgo/${FUNCION}`, { activa: true });
    assert.equal(estado, 200);
    assert.equal(cuerpo.activa, true);
    assert.equal(cuerpo.advertencia, null);
    assert.equal(escrituras('configuracion_funciones_marketplace').length, 1, 'no la encendió');
    assert.deepEqual(escrituras('auditoria_advertencias_legales'), []);
  });
});

describe('el aviso avisa, no bloquea', () => {
  it('si el registro falla, la función se enciende igual', async () => {
    respuestas.delete('POST /rest/v1/auditoria_advertencias_legales');
    const { estado, cuerpo } = await pedir('PUT', `/funciones-riesgo/${FUNCION}`, { activa: true });
    assert.equal(estado, 200);
    assert.equal(cuerpo.activa, true);
    assert.equal(escrituras('configuracion_funciones_marketplace').length, 1);
  });

  it('una función que no está en el catálogo no se enciende', async () => {
    const { estado } = await pedir('PUT', '/funciones-riesgo/inventada', { activa: true });
    assert.equal(estado, 404);
    assert.deepEqual(escrituras('configuracion_funciones_marketplace'), []);
  });

  it('sin decir si se enciende o se apaga, no se hace nada', async () => {
    const { estado } = await pedir('PUT', `/funciones-riesgo/${FUNCION}`, {});
    assert.equal(estado, 400);
    assert.deepEqual(escrituras('configuracion_funciones_marketplace'), []);
  });
});

describe('la pantalla recibe qué está encendido y qué texto se va a mostrar', () => {
  it('lista las cinco con su estado y su advertencia', async () => {
    respuestas.set('GET /rest/v1/configuracion_funciones_marketplace', () => [
      { funcion_clave: FUNCION, activa: true, advertida_en: '2026-09-10T12:00:00.000Z' },
    ]);
    const { estado, cuerpo } = await pedir('GET', '/funciones-riesgo');
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo.funciones, [
      {
        clave: FUNCION,
        activa: true,
        advertida_en: '2026-09-10T12:00:00.000Z',
        texto_advertencia: TEXTO_ARGENTINO,
      },
    ]);
  });

  it('sin fila guardada, la función está apagada', async () => {
    const { cuerpo } = await pedir('GET', '/funciones-riesgo');
    assert.equal(cuerpo.funciones[0].activa, false);
    assert.equal(cuerpo.funciones[0].advertida_en, null);
  });
});
