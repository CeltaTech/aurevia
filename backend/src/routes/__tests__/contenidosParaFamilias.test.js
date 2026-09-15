/**
 * La biblioteca que cada Prestadora escribe para sus Familias, de las dos puntas.
 *
 *   npm test --prefix backend
 *
 * Se prueban juntas la punta que escribe —el Panel— y la que lee —la aplicación de la Familia—,
 * porque son las dos mitades de la misma decisión: lo que no está publicado no sale, y lo de una
 * Prestadora no se ve desde otra. Separadas, cada archivo podría pasar solo y la pareja fallar.
 *
 * Los casos están escritos por el error que evitan:
 *
 *   1. QUE UNA PRESTADORA VEA O TOQUE EL CONTENIDO DE OTRA. El motor entra a la base con la llave
 *      de servicio y se saltea la protección por fila, así que lo único que separa a una de otra
 *      son los filtros escritos en cada consulta. Si falta uno, no falla nada: contesta de más.
 *   2. QUE UN BORRADOR LLEGUE A UNA FAMILIA. Publicar es una decisión de quien escribe, y hasta
 *      que la toma lo escrito existe sólo del lado del Panel.
 *   3. QUE ESCRIBA QUIEN LA PRESTADORA NO HABILITÓ. Leer la biblioteca es de cualquiera del
 *      Panel —un borrador hay que poder revisarlo—; escribirla es una acción del catálogo de
 *      permisos, y quien niega de verdad es el motor.
 *   4. QUE UN ENLACE LLEVE A CUALQUIER LADO. Lo que se guarda termina en un enlace que toca una
 *      Familia, así que se admite una dirección cifrada y nada más.
 *
 * Los datos son inventados.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USUARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FAMILIA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const CONTENIDO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, con la dirección entera: los filtros van ahí. */
let llamadas = [];

let rolDelUsuario = 'admin_prestadora';
let permisoOtorgado = true;

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
    const valor = typeof preparada === 'function' ? preparada({ url: req.url, cuerpo: crudo ? JSON.parse(crudo) : null }) : preparada;
    if (valor === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `la prueba no preparó respuesta para ${clave}` }));
      return;
    }

    // Así se imita el choque contra el índice único del título.
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

// El import va después de dejar puestas las variables de entorno: la conexión a la base se arma
// en el momento en que se importa, y con la dirección que haya en ese instante.
const { default: express } = await import('express');
await import('express-async-errors');
const { panelContenidosRouter } = await import('../panelContenidos.js');
const { appFamiliasRouter } = await import('../appFamilias.js');

const app = express();
app.use(express.json());
app.use('/api/panel/contenidos', panelContenidosRouter);
app.use('/api/app-familias', appFamiliasRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const RAIZ = `http://127.0.0.1:${motor.address().port}`;

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

const enElPanel = (ruta, metodo = 'GET', cuerpo) => pedir(metodo, `/api/panel/contenidos${ruta}`, cuerpo);
const enLaFamilia = (ruta) => pedir('GET', `/api/app-familias${ruta}`);

const CONTENIDO_EN_LA_BASE = {
  id: CONTENIDO,
  titulo: 'Cómo levantar a alguien de la cama sin lastimarse',
  cuerpo: 'Primero se acerca la silla…',
  enlace_url: null,
  orden: 0,
  publicado: false,
  created_at: '2026-09-01T10:00:00Z',
  updated_at: '2026-09-01T10:00:00Z',
};

/** La sesión de alguien del Panel. El rol y el permiso los cambia cada prueba. */
function sesionDelPanel() {
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: rolDelUsuario, prestadora_id: PRESTADORA }]);
  respuestas.set('POST /rest/v1/rpc/tiene_permiso_de', () => permisoOtorgado);
}

/** La sesión de la titular de una Familia. */
function sesionDeLaFamilia() {
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'familia', prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/familias', () => [{ id: FAMILIA }]);
  respuestas.set('GET /rest/v1/miembros_familia', () => []);
}

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  rolDelUsuario = 'admin_prestadora';
  permisoOtorgado = true;
  sesionDelPanel();
});

/** Todas las direcciones con las que se consultó la biblioteca en este pedido. */
function consultasALaBiblioteca() {
  return llamadas.filter((l) => l.clave.endsWith('/rest/v1/contenidos_para_familias'));
}

// ---------------------------------------------------------------------------------------
// Qué se admite antes de tocar la base
// ---------------------------------------------------------------------------------------

describe('qué contenido se admite', () => {
  it('sin título no hay contenido', async () => {
    const { estado, cuerpo } = await enElPanel('/', 'POST', { titulo: '   ', cuerpo: 'algo' });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'faltan_datos');
    assert.equal(consultasALaBiblioteca().length, 0);
  });

  it('sin texto tampoco', async () => {
    const { estado, cuerpo } = await enElPanel('/', 'POST', { titulo: 'Algo', cuerpo: '' });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'faltan_datos');
  });

  it('un enlace que no es una dirección cifrada se rechaza', async () => {
    for (const enlace of ['http://ejemplo.invalido/a', 'javascript:alert(1)', 'ejemplo.invalido']) {
      const { estado, cuerpo } = await enElPanel('/', 'POST', {
        titulo: 'Algo',
        cuerpo: 'Texto',
        enlace_url: enlace,
      });
      assert.equal(estado, 400, `este enlace no debería haberse admitido: ${enlace}`);
      assert.equal(cuerpo.motivo, 'enlace_invalido');
    }
    assert.equal(consultasALaBiblioteca().length, 0);
  });

  it('un orden que no es un número entero se rechaza', async () => {
    const { estado, cuerpo } = await enElPanel('/', 'POST', { titulo: 'Algo', cuerpo: 'Texto', orden: '2,5' });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'orden_invalido');
  });

  it('el enlace vacío se guarda sin enlace, no con una cadena vacía', async () => {
    respuestas.set('POST /rest/v1/contenidos_para_familias', ({ cuerpo }) => [{ ...CONTENIDO_EN_LA_BASE, ...cuerpo }]);
    await enElPanel('/', 'POST', { titulo: 'Algo', cuerpo: 'Texto', enlace_url: '   ' });

    const escritura = llamadas.find((l) => l.clave === 'POST /rest/v1/contenidos_para_familias');
    assert.equal(escritura.cuerpo.enlace_url, null);
  });

  it('una pieza nueva nace sin publicar', async () => {
    respuestas.set('POST /rest/v1/contenidos_para_familias', ({ cuerpo }) => [{ ...CONTENIDO_EN_LA_BASE, ...cuerpo }]);
    await enElPanel('/', 'POST', { titulo: 'Algo', cuerpo: 'Texto' });

    const escritura = llamadas.find((l) => l.clave === 'POST /rest/v1/contenidos_para_familias');
    assert.equal(escritura.cuerpo.publicado, false);
    assert.equal(escritura.cuerpo.prestadora_id, PRESTADORA);
    assert.equal(escritura.cuerpo.creado_por, USUARIO);
  });

  it('dos piezas con el mismo título no conviven, y se dice cuál es el problema', async () => {
    respuestas.set('POST /rest/v1/contenidos_para_familias', () => ({
      __estado: 409,
      __cuerpo: { code: '23505', message: 'duplicate key value violates unique constraint' },
    }));

    const { estado, cuerpo } = await enElPanel('/', 'POST', { titulo: 'Algo', cuerpo: 'Texto' });
    assert.equal(estado, 409);
    assert.equal(cuerpo.motivo, 'titulo_de_contenido_repetido');
  });
});

// ---------------------------------------------------------------------------------------
// Quién escribe y quién lee, del lado del Panel
// ---------------------------------------------------------------------------------------

describe('quién toca la biblioteca', () => {
  it('sin el permiso no se escribe, aunque la pantalla haya mostrado el botón', async () => {
    permisoOtorgado = false;
    rolDelUsuario = 'coordinador';

    for (const [metodo, ruta, cuerpo] of [
      ['POST', '/', { titulo: 'Algo', cuerpo: 'Texto' }],
      ['PATCH', `/${CONTENIDO}`, { titulo: 'Otro' }],
      ['DELETE', `/${CONTENIDO}`, undefined],
    ]) {
      const { estado } = await enElPanel(ruta, metodo, cuerpo);
      assert.equal(estado, 403, `${metodo} ${ruta} debería haberse negado`);
    }
    assert.equal(consultasALaBiblioteca().length, 0);
  });

  it('sin el permiso sí se lee: un borrador hay que poder revisarlo', async () => {
    permisoOtorgado = false;
    rolDelUsuario = 'coordinador';
    respuestas.set('GET /rest/v1/contenidos_para_familias', () => [CONTENIDO_EN_LA_BASE]);

    const { estado, cuerpo } = await enElPanel('/');
    assert.equal(estado, 200);
    assert.equal(cuerpo.contenidos.length, 1);
  });

  it('quien no es del Panel no entra', async () => {
    rolDelUsuario = 'familia';
    const { estado } = await enElPanel('/');
    assert.equal(estado, 403);
  });
});

// ---------------------------------------------------------------------------------------
// El aislamiento entre Prestadoras
// ---------------------------------------------------------------------------------------

describe('el contenido de una Prestadora no se ve ni se toca desde otra', () => {
  it('toda consulta del Panel lleva el filtro de Prestadora escrito', async () => {
    respuestas.set('GET /rest/v1/contenidos_para_familias', () => [CONTENIDO_EN_LA_BASE]);
    respuestas.set('PATCH /rest/v1/contenidos_para_familias', () => [CONTENIDO_EN_LA_BASE]);
    respuestas.set('DELETE /rest/v1/contenidos_para_familias', () => [{ id: CONTENIDO }]);

    await enElPanel('/');
    await enElPanel(`/${CONTENIDO}`, 'PATCH', { publicado: true });
    await enElPanel(`/${CONTENIDO}`, 'DELETE');

    const consultas = consultasALaBiblioteca();
    assert.ok(consultas.length >= 4);
    for (const consulta of consultas) {
      assert.ok(
        consulta.url.includes(`prestadora_id=eq.${PRESTADORA}`),
        `esta consulta no filtró por Prestadora: ${consulta.url}`
      );
    }
  });

  it('una pieza de otra Prestadora no existe para ésta, y se contesta lo mismo que si no existiera', async () => {
    respuestas.set('GET /rest/v1/contenidos_para_familias', () => []);
    respuestas.set('DELETE /rest/v1/contenidos_para_familias', () => []);

    const cambio = await enElPanel(`/${CONTENIDO}`, 'PATCH', { publicado: true });
    assert.equal(cambio.estado, 404);
    assert.equal(cambio.cuerpo.motivo, 'no_encontrado');

    const borrado = await enElPanel(`/${CONTENIDO}`, 'DELETE');
    assert.equal(borrado.estado, 404);
    assert.equal(borrado.cuerpo.motivo, 'no_encontrado');
  });

  it('un cambio que trae sólo el interruptor no borra el texto que ya estaba', async () => {
    respuestas.set('GET /rest/v1/contenidos_para_familias', () => [CONTENIDO_EN_LA_BASE]);
    respuestas.set('PATCH /rest/v1/contenidos_para_familias', ({ cuerpo }) => [{ ...CONTENIDO_EN_LA_BASE, ...cuerpo }]);

    const { estado } = await enElPanel(`/${CONTENIDO}`, 'PATCH', { publicado: true });
    assert.equal(estado, 200);

    const escritura = llamadas.find((l) => l.clave === 'PATCH /rest/v1/contenidos_para_familias');
    assert.equal(escritura.cuerpo.titulo, CONTENIDO_EN_LA_BASE.titulo);
    assert.equal(escritura.cuerpo.cuerpo, CONTENIDO_EN_LA_BASE.cuerpo);
    assert.equal(escritura.cuerpo.publicado, true);
    assert.ok(escritura.cuerpo.updated_at, 'la fecha de modificación la escribe la ruta');
  });
});

// ---------------------------------------------------------------------------------------
// Lo que llega a la Familia
// ---------------------------------------------------------------------------------------

describe('la biblioteca del lado de la Familia', () => {
  beforeEach(() => {
    respuestas.clear();
    llamadas = [];
    sesionDeLaFamilia();
  });

  it('sale lo publicado de su Prestadora, y nada más', async () => {
    respuestas.set('GET /rest/v1/contenidos_para_familias', () => [
      { id: CONTENIDO, titulo: 'Algo', cuerpo: 'Texto', enlace_url: null, updated_at: '2026-09-01T10:00:00Z' },
    ]);

    const { estado, cuerpo } = await enLaFamilia('/contenidos');
    assert.equal(estado, 200);
    assert.equal(cuerpo.contenidos.length, 1);

    const consulta = consultasALaBiblioteca()[0];
    assert.ok(consulta.url.includes(`prestadora_id=eq.${PRESTADORA}`), consulta.url);
    assert.ok(consulta.url.includes('publicado=eq.true'), `un borrador no sale hacia la Familia: ${consulta.url}`);
  });

  it('no se manda nada de lo que es de adentro de la Prestadora', async () => {
    respuestas.set('GET /rest/v1/contenidos_para_familias', () => [
      { id: CONTENIDO, titulo: 'Algo', cuerpo: 'Texto', enlace_url: null, updated_at: '2026-09-01T10:00:00Z' },
    ]);

    await enLaFamilia('/contenidos');

    const consulta = consultasALaBiblioteca()[0];
    const pedido = new URL(consulta.url, 'http://interno').searchParams.get('select');
    for (const columna of ['creado_por', 'publicado', 'orden']) {
      assert.ok(!pedido.includes(columna), `esta columna no tiene por qué viajar: ${columna}`);
    }
  });

  it('quien no es de una Familia no entra', async () => {
    respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'coordinador', prestadora_id: PRESTADORA }]);
    const { estado } = await enLaFamilia('/contenidos');
    assert.equal(estado, 403);
  });
});
