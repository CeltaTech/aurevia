/**
 * Pruebas del apareo de cada Familia con el cliente que el otro software tiene cargado.
 *
 *   npm test --prefix backend
 *
 * Se levanta el motor de verdad contra una base de mentira que contesta lo que cada prueba le
 * prepara, igual que en los cobros. Así lo que se comprueba es el camino entero —quién puede,
 * qué se filtra, qué se escribe— y no una imitación.
 *
 * Lo que más importa acá: que ninguna consulta se olvide el filtro de Prestadora. El motor entra
 * a la base con la clave de servicio, o sea sin las reglas de acceso, así que ese filtro es lo
 * único que impide que una Prestadora aparee las Familias de otra.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const USUARIO = '22222222-2222-2222-2222-222222222222';
const FAMILIA = '44444444-4444-4444-4444-444444444444';
const OTRA_FAMILIA = '66666666-6666-6666-6666-666666666666';

const respuestas = new Map();
let llamadas = [];
let rolDelUsuario = 'admin_prestadora';

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
    const valor =
      typeof preparada === 'function' ? preparada(crudo ? JSON.parse(crudo) : null, req.url) : preparada;
    if (valor === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `la prueba no preparó respuesta para ${clave}` }));
      return;
    }

    if (valor && valor.__estado) {
      res.writeHead(valor.__estado, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(valor.__cuerpo));
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

const { default: express } = await import('express');
await import('express-async-errors');
const { panelClientesExternosRouter } = await import('../panelClientesExternos.js');

const app = express();
app.use(express.json());
app.use('/api/panel/clientes-externos', panelClientesExternosRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/panel/clientes-externos`;

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
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: rolDelUsuario, prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/catalogo_conexiones_externas', () => [
    { conexion: 'facturacion', orden: 1 },
    { conexion: 'cobranzas', orden: 2 },
  ]);
  // La base de mentira respeta el filtro por Familia, porque el motor pregunta de quién es una
  // Familia con una consulta que espera una fila sola.
  respuestas.set('GET /rest/v1/familias', (_cuerpo, url) => {
    const todas = [
      { id: FAMILIA, solicitudes: { nombre: 'Familia Aldana' } },
      { id: OTRA_FAMILIA, solicitudes: { nombre: 'Familia Bravo' } },
    ];
    const pedida = /[?&]id=eq\.([^&]+)/.exec(url);
    return pedida ? todas.filter((f) => f.id === pedida[1]) : todas;
  });
  respuestas.set('GET /rest/v1/clientes_externos_de_familias', () => [
    { familia_id: FAMILIA, cliente_externo: 'CLI-0001' },
  ]);
});

/** Las consultas a la base que traen datos de una Prestadora, sin las de sesión ni de catálogo. */
function consultasDeDatos() {
  return llamadas.filter(
    (l) =>
      l.clave.startsWith('GET /rest/v1/familias') ||
      l.clave.includes('clientes_externos_de_familias')
  );
}

describe('qué clases de conexión hay', () => {
  it('salen de la base y no de una lista escrita en el código', async () => {
    const { estado, cuerpo } = await pedir('GET', '/conexiones');
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo, ['facturacion', 'cobranzas']);
  });
});

describe('la lista de Familias para aparear', () => {
  it('trae todas, con la referencia de las que ya están apareadas', async () => {
    const { estado, cuerpo } = await pedir('GET', '/?conexion=facturacion');
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo, [
      { familia_id: FAMILIA, familia: 'Familia Aldana', cliente_externo: 'CLI-0001' },
      { familia_id: OTRA_FAMILIA, familia: 'Familia Bravo', cliente_externo: '' },
    ]);
  });

  it('sin decir de qué conexión se trata no contesta', async () => {
    const { estado } = await pedir('GET', '/');
    assert.equal(estado, 400);
  });

  it('una conexión que no está en el catálogo se rechaza', async () => {
    const { estado } = await pedir('GET', '/?conexion=inventada');
    assert.equal(estado, 400);
  });

  it('toda consulta lleva el filtro de Prestadora', async () => {
    await pedir('GET', '/?conexion=facturacion');
    const sinFiltro = consultasDeDatos().filter((l) => !l.url.includes(`prestadora_id=eq.${PRESTADORA}`));
    assert.deepEqual(sinFiltro.map((l) => l.url), []);
  });
});

describe('aparear una Familia', () => {
  it('guarda la referencia', async () => {
    respuestas.set('POST /rest/v1/clientes_externos_de_familias', () => []);

    const { estado } = await pedir('PUT', `/${FAMILIA}`, {
      conexion: 'facturacion',
      cliente_externo: 'CLI-0007',
    });
    assert.equal(estado, 200);

    const guardado = llamadas.find((l) => l.clave === 'POST /rest/v1/clientes_externos_de_familias');
    assert.equal(guardado.cuerpo.cliente_externo, 'CLI-0007');
    assert.equal(guardado.cuerpo.prestadora_id, PRESTADORA);
    assert.equal(guardado.cuerpo.conexion, 'facturacion');
  });

  it('la referencia vacía borra el apareo, que es una decisión legítima', async () => {
    respuestas.set('DELETE /rest/v1/clientes_externos_de_familias', () => []);

    const { estado, cuerpo } = await pedir('PUT', `/${FAMILIA}`, {
      conexion: 'facturacion',
      cliente_externo: '   ',
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.cliente_externo, '');

    const borrado = llamadas.find((l) => l.clave === 'DELETE /rest/v1/clientes_externos_de_familias');
    assert.ok(borrado.url.includes(`prestadora_id=eq.${PRESTADORA}`));
    assert.ok(borrado.url.includes(`familia_id=eq.${FAMILIA}`));
    assert.equal(llamadas.some((l) => l.clave === 'POST /rest/v1/clientes_externos_de_familias'), false);
  });

  it('una Familia de otra Prestadora no se aparea', async () => {
    respuestas.set('GET /rest/v1/familias', () => []);

    const { estado } = await pedir('PUT', `/${OTRA_FAMILIA}`, {
      conexion: 'facturacion',
      cliente_externo: 'CLI-0009',
    });
    assert.equal(estado, 404);
    assert.equal(llamadas.some((l) => l.clave === 'POST /rest/v1/clientes_externos_de_familias'), false);
  });

  it('una referencia demasiado larga se rechaza antes de tocar la base', async () => {
    const { estado } = await pedir('PUT', `/${FAMILIA}`, {
      conexion: 'facturacion',
      cliente_externo: 'X'.repeat(129),
    });
    assert.equal(estado, 400);
    assert.equal(llamadas.some((l) => l.clave === 'POST /rest/v1/clientes_externos_de_familias'), false);
  });

  it('quien coordina turnos no aparea clientes de un software de facturación', async () => {
    rolDelUsuario = 'coordinador';

    const { estado } = await pedir('PUT', `/${FAMILIA}`, {
      conexion: 'facturacion',
      cliente_externo: 'CLI-0007',
    });
    assert.equal(estado, 403);
    assert.equal(llamadas.some((l) => l.clave === 'POST /rest/v1/clientes_externos_de_familias'), false);
  });
});

describe('el apareo de a muchos', () => {
  it('anota lo nuevo, deja lo igual y borra lo que se vació', async () => {
    respuestas.set('POST /rest/v1/clientes_externos_de_familias', () => []);
    respuestas.set('DELETE /rest/v1/clientes_externos_de_familias', () => []);

    const { estado, cuerpo } = await pedir('POST', '/importar', {
      conexion: 'facturacion',
      filas: [
        { familia_id: FAMILIA, cliente_externo: '' },
        { familia_id: OTRA_FAMILIA, cliente_externo: 'CLI-0002' },
      ],
    });
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo.resultados.map((r) => r.resultado), ['borrado', 'apareado']);
  });

  it('el archivo bajado y subido sin tocar nada no borra nada', async () => {
    const { cuerpo } = await pedir('POST', '/importar', {
      conexion: 'facturacion',
      filas: [
        { familia_id: FAMILIA, cliente_externo: 'CLI-0001' },
        { familia_id: OTRA_FAMILIA, cliente_externo: '' },
      ],
    });
    assert.deepEqual(cuerpo.resultados.map((r) => r.resultado), ['sin_cambio', 'sin_cambio']);
    assert.equal(llamadas.some((l) => l.clave.startsWith('DELETE ')), false);
    assert.equal(llamadas.some((l) => l.clave === 'POST /rest/v1/clientes_externos_de_familias'), false);
  });

  it('una Familia que no es de esta Prestadora se rechaza y no se escribe', async () => {
    const { cuerpo } = await pedir('POST', '/importar', {
      conexion: 'facturacion',
      filas: [{ familia_id: '77777777-7777-7777-7777-777777777777', cliente_externo: 'CLI-0003' }],
    });
    assert.deepEqual(cuerpo.resultados, [
      { familia_id: '77777777-7777-7777-7777-777777777777', resultado: 'rechazado', motivo: 'no_encontrada' },
    ]);
    assert.equal(llamadas.some((l) => l.clave === 'POST /rest/v1/clientes_externos_de_familias'), false);
  });

  it('un identificador mal escrito se rechaza sin cortar el archivo entero', async () => {
    respuestas.set('POST /rest/v1/clientes_externos_de_familias', () => []);

    const { cuerpo } = await pedir('POST', '/importar', {
      conexion: 'facturacion',
      filas: [
        { familia_id: 'CLI-0004', cliente_externo: 'CLI-0004' },
        { familia_id: OTRA_FAMILIA, cliente_externo: 'CLI-0005' },
      ],
    });
    assert.equal(cuerpo.resultados[0].resultado, 'rechazado');
    assert.equal(cuerpo.resultados[0].motivo, 'familia_id');
    assert.equal(cuerpo.resultados[1].resultado, 'apareado');
  });

  it('la misma Familia dos veces en el mismo archivo entra una sola vez', async () => {
    respuestas.set('POST /rest/v1/clientes_externos_de_familias', () => []);

    const { cuerpo } = await pedir('POST', '/importar', {
      conexion: 'facturacion',
      filas: [
        { familia_id: OTRA_FAMILIA, cliente_externo: 'CLI-0006' },
        { familia_id: OTRA_FAMILIA, cliente_externo: 'CLI-0007' },
      ],
    });
    assert.deepEqual(cuerpo.resultados.map((r) => r.resultado), ['apareado', 'rechazado']);
    assert.equal(llamadas.filter((l) => l.clave === 'POST /rest/v1/clientes_externos_de_familias').length, 1);
  });

  it('un archivo sin filas no entra', async () => {
    const { estado } = await pedir('POST', '/importar', { conexion: 'facturacion', filas: [] });
    assert.equal(estado, 400);
  });

  it('dos Familias sobre el mismo cliente del otro lado no pasan', async () => {
    respuestas.set('POST /rest/v1/clientes_externos_de_familias', () => ({
      __estado: 409,
      __cuerpo: { code: '23505', message: 'duplicate key value violates unique constraint' },
    }));

    const { cuerpo } = await pedir('POST', '/importar', {
      conexion: 'facturacion',
      filas: [{ familia_id: OTRA_FAMILIA, cliente_externo: 'CLI-0001' }],
    });
    assert.equal(cuerpo.resultados[0].resultado, 'rechazado');
    assert.equal(cuerpo.resultados[0].motivo, 'cliente_repetido');
  });

  // El mismo choque, pero apareando de a una. Lo que se comprueba es que salga con un motivo que
  // la pantalla pueda explicar y no como falla del sistema, que taparía la explicación.
  it('aparear de a una con un cliente que ya es de otra Familia se explica, no se rompe', async () => {
    respuestas.set('POST /rest/v1/clientes_externos_de_familias', () => ({
      __estado: 409,
      __cuerpo: { code: '23505', message: 'duplicate key value violates unique constraint' },
    }));

    const { estado, cuerpo } = await pedir('PUT', `/${FAMILIA}`, {
      conexion: 'facturacion',
      cliente_externo: 'CLI-0001',
    });
    assert.equal(estado, 409);
    assert.equal(cuerpo.motivo, 'cliente_externo_ya_apareado');
  });
});
