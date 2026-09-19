/**
 * El alta deja puestos los lugares en el mismo pedido que crea a la persona.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Dónde acepta trabajar una Asistente y hasta dónde llega una
 * coordinadora se pueden cargar en dos momentos: al dar de alta, y después desde la ficha. Son dos
 * caminos hacia la misma lista, y lo que se prueba acá es que los dos la dejen igual y que ninguno
 * pueda terminar a medias:
 *
 *  1. Que el alta escriba los lugares que le mandaron, y en la Organización de quien la hizo.
 *  2. Que un alta de Asistente cuyos lugares no se pudieron escribir se deshaga entera, sin dejar
 *     una ficha sin lugares que nadie va a volver a mirar.
 *  3. Que una cuenta de Panel cuyo alcance no se pudo escribir se borre: una cuenta con acceso que
 *     nadie decidió es peor que un alta que no ocurrió.
 *
 * Se levanta el router de verdad contra una base de mentira y se mira qué escribió y qué borró.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const QUIEN_LLAMA = '22222222-2222-2222-2222-222222222222';
const NUEVA_CUENTA = '33333333-3333-3333-3333-333333333333';
const LUGAR = '55555555-5555-5555-5555-555555555555';
const OTRO_LUGAR = '66666666-6666-6666-6666-666666666666';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, con los filtros de la dirección incluidos. */
let llamadas = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const direccion = new URL(req.url, 'http://interno');
    // La cuenta de acceso se borra por una dirección que lleva el identificador adentro; se la
    // anota por su forma, para que la prueba pueda preguntar si se borró sin saber cuál.
    const ruta = direccion.pathname.startsWith('/auth/v1/admin/users/')
      ? '/auth/v1/admin/users/:id'
      : direccion.pathname;
    const clave = `${req.method} ${ruta}`;
    llamadas.push({ clave, ruta: direccion.pathname, filtros: direccion.searchParams, cuerpo: crudo ? JSON.parse(crudo) : null });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada(direccion.searchParams) : preparada;
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

// El import va después de dejar puestas las variables de entorno: la conexión a la base se lee en
// el momento del import.
const { default: express } = await import('express');
await import('express-async-errors');
const { panelUsuariosRouter } = await import('../../routes/panelUsuarios.js');
const { crearAsistenteDirecto } = await import('../cuentasPanel.js');

const app = express();
app.use(express.json());
app.use('/api/panel/usuarios', panelUsuariosRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const RAIZ = `http://127.0.0.1:${motor.address().port}/api/panel`;

after(() => {
  motor.close();
  baseFalsa.close();
});

async function pedir(metodo, ruta, cuerpo) {
  const respuesta = await fetch(`${RAIZ}${ruta}`, {
    method: metodo,
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** Lo que el motor escribió en esa tabla, o `undefined` si no escribió nada. */
function loEscritoEn(tabla) {
  return llamadas.find((l) => l.clave === `POST /rest/v1/${tabla}`)?.cuerpo;
}

function hubo(clave) {
  return llamadas.some((l) => l.clave === clave);
}

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: QUIEN_LLAMA, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', (filtros) =>
    // La misma ruta contesta dos preguntas: quién llama, y de quién es la cuenta que se está por
    // borrar cuando un alta se deshace.
    filtros.get('id') === `eq.${NUEVA_CUENTA}`
      ? [{ id: NUEVA_CUENTA, rol: 'coordinador', prestadora_id: PRESTADORA }]
      : [{ id: QUIEN_LLAMA, rol: 'admin_prestadora', prestadora_id: PRESTADORA }],
  );
  respuestas.set('POST /rest/v1/usuarios', () => []);
  respuestas.set('POST /rest/v1/membresias', () => []);
  respuestas.set('DELETE /rest/v1/usuarios', () => []);
  respuestas.set('POST /auth/v1/admin/users', () => ({ id: NUEVA_CUENTA }));
  respuestas.set('DELETE /auth/v1/admin/users/:id', () => ({}));
  respuestas.set('GET /rest/v1/usuario_lugares', () => []);
  respuestas.set('DELETE /rest/v1/usuario_lugares', () => []);
  respuestas.set('POST /rest/v1/usuario_lugares', () => []);
  respuestas.set('DELETE /rest/v1/asistente_lugares', () => []);
  respuestas.set('POST /rest/v1/asistente_lugares', () => []);
  respuestas.set('POST /rest/v1/asistentes', () => []);
  respuestas.set('DELETE /rest/v1/asistentes', () => []);
  respuestas.set('DELETE /rest/v1/verificaciones_asistente', () => []);
  respuestas.set('DELETE /rest/v1/referencias_laborales_asistente', () => []);
  respuestas.set('POST /rest/v1/verificaciones_asistente', () => []);
  // El país decide con qué servicio se ubica un domicilio; la política, si el alta nace verificada.
  respuestas.set('GET /rest/v1/prestadoras', () => [{ pais: 'AR', politica_verificacion_alta_manual: 'ninguna' }]);
});

// ---------------------------------------------------------------------------------------

describe('el alta de una Asistente', () => {
  it('deja guardados los lugares en el mismo pedido', async () => {
    await crearAsistenteDirecto({
      nombre: 'Persona De Prueba',
      email: 'persona@ejemplo.invalido',
      lugares: [LUGAR, OTRO_LUGAR],
      prestadoraId: PRESTADORA,
    });

    assert.deepEqual(loEscritoEn('asistente_lugares'), [
      { asistente_id: NUEVA_CUENTA, lugar_id: LUGAR, prestadora_id: PRESTADORA },
      { asistente_id: NUEVA_CUENTA, lugar_id: OTRO_LUGAR, prestadora_id: PRESTADORA },
    ]);
  });

  it('si los lugares no se pueden escribir, el alta se deshace entera', async () => {
    respuestas.set('POST /rest/v1/asistente_lugares', undefined);

    await assert.rejects(() => crearAsistenteDirecto({
      nombre: 'Persona De Prueba',
      email: 'persona@ejemplo.invalido',
      lugares: [LUGAR],
      prestadoraId: PRESTADORA,
    }));

    // La ficha se borra y la cuenta de acceso también: no queda nadie a medias.
    assert.equal(hubo('DELETE /rest/v1/asistentes'), true);
    assert.equal(hubo('DELETE /auth/v1/admin/users/:id'), true);
  });
});

describe('el alta de una cuenta del Panel', () => {
  it('guarda hasta dónde llega quien coordina', async () => {
    const { estado } = await pedir('POST', '/usuarios', {
      email: 'coordinacion@ejemplo.invalido',
      nombre: 'Persona De Prueba',
      rol: 'coordinador',
      lugares: [LUGAR],
    });
    assert.equal(estado, 200);
    assert.deepEqual(loEscritoEn('usuario_lugares'), [
      { usuario_id: NUEVA_CUENTA, lugar_id: LUGAR, prestadora_id: PRESTADORA },
    ]);
  });

  it('si el alcance no se pudo escribir, la cuenta recién creada se borra', async () => {
    respuestas.set('POST /rest/v1/usuario_lugares', undefined);

    const { estado } = await pedir('POST', '/usuarios', {
      email: 'coordinacion@ejemplo.invalido',
      nombre: 'Persona De Prueba',
      rol: 'coordinador',
      lugares: [LUGAR],
    });

    assert.notEqual(estado, 200);
    assert.equal(hubo('DELETE /rest/v1/usuarios'), true);
    assert.equal(hubo('DELETE /auth/v1/admin/users/:id'), true);
  });

  it('sin lugares no se toca la lista, porque no hay alcance que decidir', async () => {
    const { estado } = await pedir('POST', '/usuarios', {
      email: 'coordinacion@ejemplo.invalido',
      nombre: 'Persona De Prueba',
      rol: 'coordinador',
    });
    assert.equal(estado, 200);
    assert.equal(hubo('DELETE /rest/v1/usuario_lugares'), false);
    assert.equal(loEscritoEn('usuario_lugares'), undefined);
  });
});
