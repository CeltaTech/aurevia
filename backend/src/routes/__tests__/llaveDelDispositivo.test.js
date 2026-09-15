/**
 * Entrar con la llave del teléfono: los caminos que no dependen de la criptografía.
 *
 *   npm test --prefix backend
 *
 * Verificar una firma lo hace una librería y no tiene sentido probarla de nuevo. Lo que sí hay que
 * probar es todo lo que la rodea, que es lo que deja pasar o no, y que está escrito acá adentro.
 * Los casos están por el error que evitan:
 *
 *   1. QUE LA PANTALLA DE INGRESO SIRVA PARA AVERIGUAR QUIÉN TIENE CUENTA. La llave que no existe
 *      y la que fue revocada tienen que contestar exactamente lo mismo —mismo código, mismo
 *      cuerpo— o alguien puede ir probando hasta saber quién es cliente de quién
 *      (`celtatech/CLAUDE.md` §6).
 *   2. QUE UNA LLAVE CRUCE DE APLICACIÓN. Una llave dada de alta en la aplicación del Asistente no
 *      puede servir para entrar a la de la Familia: son dos permisos distintos.
 *   3. QUE UNA PRESTADORA ALCANCE LA LLAVE DE OTRA. El motor entra con la llave de servicio y se
 *      saltea la protección por fila, así que lo único que separa a una de otra son los filtros
 *      escritos en cada consulta.
 *   4. QUE SE PUEDA SACAR UNA LLAVE AJENA. La baja filtra por la persona de la sesión, así que
 *      tener el identificador de la llave de otro no alcanza.
 *   5. QUE LA PANTALLA VEA LA CREDENCIAL. Lo que se lista son fechas, nunca la mitad pública de la
 *      llave ni su identificador.
 *
 * La base falsa honra los filtros de la dirección a propósito: si alguien saca el filtro por
 * Prestadora, la prueba de aislamiento deja de pasar.
 *
 * Los datos son inventados.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTRA_PRESTADORA = '99999999-9999-4999-8999-999999999999';
const USUARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTRA_PERSONA = '88888888-8888-4888-8888-888888888888';
const LLAVE = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const LLAVE_AJENA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const LLAVE_DE_OTRA_PRESTADORA = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const CREDENCIAL_VIVA = 'Y3JlZGVuY2lhbC12aXZh';
const CREDENCIAL_REVOCADA = 'Y3JlZGVuY2lhbC1yZXZvY2FkYQ';
const CREDENCIAL_DESCONOCIDA = 'Y3JlZGVuY2lhbC1xdWUtbm8tZXhpc3Rl';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, con la dirección entera: los filtros van ahí. */
let llamadas = [];

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
process.env.PWA_ASISTENTES_URL = 'https://asistentes.ejemplo.com';
process.env.PWA_FAMILIAS_URL = 'https://familias.ejemplo.com';

// El import va después de dejar puestas las variables de entorno: la conexión a la base se arma
// en el momento en que se importa, y con la dirección que haya en ese instante.
const { default: express } = await import('express');
await import('express-async-errors');
const { llaveDelDispositivoRouter, routerDeLlavesConSesion } = await import('../llaveDelDispositivo.js');
const { requiereRolAsistente } = await import('../../middleware/requiereRolAsistente.js');

const app = express();
app.use(express.json());
app.use('/api/llave-de-dispositivo', llaveDelDispositivoRouter);
app.use('/api/app-asistentes/llaves', requiereRolAsistente, routerDeLlavesConSesion('asistente'));
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const RAIZ = `http://127.0.0.1:${motor.address().port}`;

after(() => {
  motor.close();
  baseFalsa.close();
});

async function pedir(metodo, ruta, cuerpo) {
  const opciones = {
    method: metodo,
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
  };
  if (cuerpo !== undefined) opciones.body = JSON.stringify(cuerpo);
  const respuesta = await fetch(`${RAIZ}${ruta}`, opciones);
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/**
 * La base falsa filtra de verdad por los `eq` y los `is` que vengan en la dirección.
 *
 * Es lo que convierte la prueba de aislamiento en una prueba: una base que contestara siempre la
 * misma fila daría 200 aunque el motor consultara sin filtrar por Prestadora.
 */
function filasQuePasanLosFiltros(url, filas) {
  const parametros = new URL(url, 'http://interno').searchParams;
  return filas.filter((fila) =>
    [...parametros.entries()].every(([campo, condicion]) => {
      if (!Object.hasOwn(fila, campo)) return true;
      if (condicion === 'is.null') return fila[campo] === null || fila[campo] === undefined;
      if (condicion === 'not.is.null') return fila[campo] !== null && fila[campo] !== undefined;
      if (condicion.startsWith('eq.')) return String(fila[campo]) === condicion.slice(3);
      return true;
    })
  );
}

/** Las llaves que hay en la base falsa, de tres dueños distintos. */
let llavesEnLaBase;

function llaveDePrueba(extra = {}) {
  return {
    id: LLAVE,
    prestadora_id: PRESTADORA,
    usuario_id: USUARIO,
    rol: 'asistente',
    credencial_id: CREDENCIAL_VIVA,
    clave_publica: 'bWl0YWQtcHVibGljYQ',
    contador: 3,
    transportes: ['internal'],
    creada_en: '2026-09-01T10:00:00Z',
    ultimo_uso_en: '2026-09-14T08:00:00Z',
    revocada_en: null,
    ...extra,
  };
}

beforeEach(() => {
  llamadas = [];
  respuestas.clear();

  llavesEnLaBase = [
    llaveDePrueba(),
    llaveDePrueba({
      id: LLAVE_AJENA,
      usuario_id: OTRA_PERSONA,
      credencial_id: 'Y3JlZGVuY2lhbC1hamVuYQ',
      creada_en: '2026-09-02T10:00:00Z',
    }),
    llaveDePrueba({
      id: LLAVE_DE_OTRA_PRESTADORA,
      prestadora_id: OTRA_PRESTADORA,
      credencial_id: 'Y3JlZGVuY2lhbC1kZS1vdHJh',
      creada_en: '2026-09-03T10:00:00Z',
    }),
    llaveDePrueba({
      id: '77777777-7777-4777-8777-777777777777',
      credencial_id: CREDENCIAL_REVOCADA,
      revocada_en: '2026-09-10T10:00:00Z',
      creada_en: '2026-09-04T10:00:00Z',
    }),
  ];

  // La sesión que llega: un Asistente de la Prestadora de prueba.
  respuestas.set('GET /auth/v1/user', { id: USUARIO, aud: 'authenticated' });
  respuestas.set('GET /rest/v1/usuarios', ({ url }) =>
    filasQuePasanLosFiltros(url, [
      { id: USUARIO, rol: 'asistente', prestadora_id: PRESTADORA, nombre: 'Ana Prueba', email: 'ana@ejemplo.com' },
      { id: OTRA_PERSONA, rol: 'asistente', prestadora_id: PRESTADORA, nombre: 'Bruno Prueba', email: 'bruno@ejemplo.com' },
    ])
  );
  respuestas.set('GET /rest/v1/llaves_de_dispositivo', ({ url }) =>
    filasQuePasanLosFiltros(url, llavesEnLaBase)
  );
  respuestas.set('POST /rest/v1/desafios_de_llave', []);
});

const entrar = (cuerpo) => pedir('POST', '/api/llave-de-dispositivo/entrar', cuerpo);
const misLlaves = () => pedir('GET', '/api/app-asistentes/llaves');

/** Una respuesta del navegador con el mínimo que la ruta lee antes de verificar nada. */
function respuestaDelNavegador(credencialId, desafio = 'un-desafio') {
  const clientData = Buffer.from(JSON.stringify({ challenge: desafio })).toString('base64url');
  return {
    id: credencialId,
    rawId: credencialId,
    type: 'public-key',
    response: { clientDataJSON: clientData, authenticatorData: 'YQ', signature: 'YQ' },
    clientExtensionResults: {},
  };
}

describe('la pantalla de ingreso no dice quién tiene cuenta', () => {
  it('la credencial desconocida y la revocada contestan exactamente lo mismo', async () => {
    const desconocida = await entrar({
      rol: 'asistente',
      respuesta: respuestaDelNavegador(CREDENCIAL_DESCONOCIDA),
    });
    const revocada = await entrar({
      rol: 'asistente',
      respuesta: respuestaDelNavegador(CREDENCIAL_REVOCADA),
    });

    assert.equal(desconocida.estado, 401);
    assert.deepEqual(desconocida, revocada);
    assert.equal(desconocida.cuerpo.motivo, 'llave_no_sirve');
  });

  it('el aviso no nombra ninguna tabla, columna ni identificador', async () => {
    const { cuerpo } = await entrar({
      rol: 'asistente',
      respuesta: respuestaDelNavegador(CREDENCIAL_REVOCADA),
    });
    const texto = JSON.stringify(cuerpo);
    assert.ok(!texto.includes('llaves_de_dispositivo'));
    assert.ok(!texto.includes('revocada'));
    assert.ok(!texto.includes(CREDENCIAL_REVOCADA));
  });

  it('no se pide el correo para entrar: el desafío se emite sin saber de quién es', async () => {
    const { estado, cuerpo } = await pedir('POST', '/api/llave-de-dispositivo/entrar/desafio', {
      rol: 'asistente',
    });
    assert.equal(estado, 200);
    assert.ok(cuerpo.challenge);
    assert.deepEqual(cuerpo.allowCredentials ?? [], []);
  });

  it('el desafío queda guardado con vencimiento, y sin Prestadora porque todavía no se sabe', async () => {
    await pedir('POST', '/api/llave-de-dispositivo/entrar/desafio', { rol: 'asistente' });
    const guardado = llamadas.find((l) => l.clave === 'POST /rest/v1/desafios_de_llave');
    assert.equal(guardado.cuerpo.para, 'entrada');
    assert.equal(guardado.cuerpo.rol, 'asistente');
    assert.equal(guardado.cuerpo.prestadora_id, null);
    assert.equal(guardado.cuerpo.usuario_id, null);
    assert.ok(new Date(guardado.cuerpo.vence_en) > new Date());
  });

  it('un rol que no tiene aplicación no emite ningún desafío', async () => {
    const { estado } = await pedir('POST', '/api/llave-de-dispositivo/entrar/desafio', {
      rol: 'coordinador',
    });
    assert.equal(estado, 400);
    assert.equal(llamadas.filter((l) => l.clave === 'POST /rest/v1/desafios_de_llave').length, 0);
  });
});

describe('una llave no cruza de aplicación', () => {
  it('la llave del Asistente no sirve para entrar a la de la Familia', async () => {
    const { estado } = await entrar({
      rol: 'familia',
      respuesta: respuestaDelNavegador(CREDENCIAL_VIVA),
    });
    assert.equal(estado, 401);
  });

  it('y la consulta filtra por rol, no lo comprueba después', async () => {
    await entrar({ rol: 'familia', respuesta: respuestaDelNavegador(CREDENCIAL_VIVA) });
    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/llaves_de_dispositivo');
    assert.ok(consulta.url.includes('rol=eq.familia'));
  });
});

describe('las llaves propias', () => {
  it('se listan las propias y ninguna más', async () => {
    const { estado, cuerpo } = await misLlaves();
    assert.equal(estado, 200);
    assert.deepEqual(
      cuerpo.llaves.map((l) => l.id),
      [LLAVE]
    );
  });

  it('la consulta filtra por Prestadora, que es lo único que aísla', async () => {
    await misLlaves();
    const consulta = llamadas.find(
      (l) => l.clave === 'GET /rest/v1/llaves_de_dispositivo' && l.url.includes('creada_en')
    );
    assert.ok(consulta.url.includes(`prestadora_id=eq.${PRESTADORA}`));
    assert.ok(consulta.url.includes(`usuario_id=eq.${USUARIO}`));
    assert.ok(consulta.url.includes('revocada_en=is.null'));
  });

  it('lo que se manda son fechas, nunca la credencial ni la mitad pública de la llave', async () => {
    const { cuerpo } = await misLlaves();
    const texto = JSON.stringify(cuerpo);
    assert.ok(!texto.includes(CREDENCIAL_VIVA));
    assert.ok(!texto.includes('bWl0YWQtcHVibGljYQ'));
    assert.deepEqual(Object.keys(cuerpo.llaves[0]).sort(), ['agregadaEn', 'id', 'ultimoUsoEn']);
  });
});

describe('la baja', () => {
  beforeEach(() => {
    respuestas.set('PATCH /rest/v1/llaves_de_dispositivo', ({ url }) =>
      filasQuePasanLosFiltros(url, llavesEnLaBase).map((fila) => ({ id: fila.id }))
    );
  });

  it('saca la propia', async () => {
    const { estado, cuerpo } = await pedir('DELETE', `/api/app-asistentes/llaves/${LLAVE}`);
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
  });

  it('marca en vez de borrar, para que quede constancia', async () => {
    await pedir('DELETE', `/api/app-asistentes/llaves/${LLAVE}`);
    const baja = llamadas.find((l) => l.clave === 'PATCH /rest/v1/llaves_de_dispositivo');
    assert.ok(baja.cuerpo.revocada_en);
    assert.equal(llamadas.filter((l) => l.clave.startsWith('DELETE ')).length, 0);
  });

  it('la de otra persona no se puede sacar, aunque se tenga el identificador', async () => {
    const { estado } = await pedir('DELETE', `/api/app-asistentes/llaves/${LLAVE_AJENA}`);
    assert.equal(estado, 404);
  });

  it('la de otra Prestadora tampoco, y contesta lo mismo que una que no existe', async () => {
    const deOtra = await pedir('DELETE', `/api/app-asistentes/llaves/${LLAVE_DE_OTRA_PRESTADORA}`);
    const inventada = await pedir('DELETE', '/api/app-asistentes/llaves/00000000-0000-4000-8000-000000000000');
    assert.equal(deOtra.estado, 404);
    assert.deepEqual(deOtra, inventada);
  });
});

describe('sin sesión no se administra nada', () => {
  it('listar las llaves propias pide sesión', async () => {
    respuestas.set('GET /auth/v1/user', { __estado: 401, __cuerpo: { message: 'sin token' } });
    const { estado } = await misLlaves();
    assert.equal(estado, 401);
  });

  it('y un rol que no es el de la aplicación tampoco entra', async () => {
    respuestas.set('GET /rest/v1/usuarios', [{ rol: 'familia', prestadora_id: PRESTADORA }]);
    const { estado } = await misLlaves();
    assert.equal(estado, 403);
  });
});
