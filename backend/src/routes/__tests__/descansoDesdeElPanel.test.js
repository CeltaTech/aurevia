/**
 * El descanso adentro de la guardia, anotado por la Coordinadora.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA RUTA. La que estuvo cuarenta y ocho horas adentro puede haberse olvidado de
 * marcar el rato en que durmió, y ese rato igual existió. Desde el navegador no se puede escribir:
 * la migración que crea la tabla sólo le dio permiso de lectura a quien tiene sesión.
 *
 * Los casos están escritos por el error que evitan:
 *
 *   1. QUE EL DESCANSO SE CONVIERTA EN UN DESCUENTO O EN UNA FALTA. Anotar un descanso no toca la
 *      guardia. Se comprueba mirando qué se escribió, no lo que la ruta dice de sí misma.
 *   2. QUE UNA PRESTADORA ALCANCE LA GUARDIA DE OTRA. El motor entra con la llave de servicio y se
 *      saltea la protección por fila: lo único que separa a una de otra son los filtros de cada
 *      consulta.
 *   3. QUE ENTRE UN RATO IMPOSIBLE. Un fin anterior al principio rompe la restricción de la base, y
 *      el texto crudo de esa restricción nombra tablas y columnas.
 *   4. QUE SE ANOTE UN DESCANSO QUE TODAVÍA NO PASÓ. Acá se registra lo que ya ocurrió.
 *
 * Los datos son inventados.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTRA_PRESTADORA = '99999999-9999-4999-8999-999999999999';
const USUARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GUARDIA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GUARDIA_DE_OTRA_PRESTADORA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DESCANSO = '22222222-2222-4222-8222-222222222222';

const respuestas = new Map();
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
const { panelGuardiasRouter } = await import('../panelGuardias.js');

const app = express();
app.use(express.json());
app.use('/api/panel/guardias', panelGuardiasRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/panel/guardias`;

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
  const respuesta = await fetch(`${DIRECCION}${ruta}`, opciones);
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

function filasQuePasanLosFiltros(url, filas) {
  const parametros = new URL(url, 'http://interno').searchParams;
  return filas.filter((fila) =>
    [...parametros.entries()].every(([campo, condicion]) => {
      if (!Object.hasOwn(fila, campo)) return true;
      if (condicion === 'is.null') return fila[campo] === null || fila[campo] === undefined;
      if (condicion.startsWith('eq.')) return String(fila[campo]) === condicion.slice(3);
      return true;
    })
  );
}

/** Los descansos que el motor dio de alta en este pedido. */
function descansosAnotados() {
  return llamadas
    .filter((l) => l.clave === 'POST /rest/v1/descansos_guardia')
    .map((l) => (Array.isArray(l.cuerpo) ? l.cuerpo[0] : l.cuerpo));
}

/** Un rato de la noche anterior, ya terminado. */
const ANOCHE = {
  inicio_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
  fin_at: new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString(),
};

let guardiasEnLaBase;
let descansosEnLaBase;

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  guardiasEnLaBase = [
    { id: GUARDIA, prestadora_id: PRESTADORA },
    { id: GUARDIA_DE_OTRA_PRESTADORA, prestadora_id: OTRA_PRESTADORA },
  ];
  descansosEnLaBase = [];

  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'coordinador', prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/guardias', ({ url }) => filasQuePasanLosFiltros(url, guardiasEnLaBase));
  respuestas.set('GET /rest/v1/descansos_guardia', ({ url }) =>
    filasQuePasanLosFiltros(url, descansosEnLaBase)
  );
  respuestas.set('POST /rest/v1/descansos_guardia', ({ cuerpo }) => {
    const fila = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
    return [{ id: DESCANSO, ...fila }];
  });
});

describe('anotar un descanso desde el Panel', () => {
  it('queda guardado con quién lo cargó y con la Prestadora de la guardia', async () => {
    const { estado, cuerpo } = await pedir('POST', `/${GUARDIA}/descansos`, ANOCHE);
    assert.equal(estado, 201);
    assert.equal(cuerpo.descanso.id, DESCANSO);

    const [anotado] = descansosAnotados();
    assert.ok(anotado, 'el descanso tiene que quedar guardado');
    assert.equal(anotado.guardia_id, GUARDIA);
    assert.equal(anotado.prestadora_id, PRESTADORA);
    assert.equal(anotado.registrado_por, USUARIO);
    assert.equal(anotado.inicio_at, ANOCHE.inicio_at);
    assert.equal(anotado.fin_at, ANOCHE.fin_at);
    assert.equal(anotado.nota, null);
  });

  // La misma regla de fondo que del lado de la Asistente: descansar disponible no es irse, y
  // anotarlo después tampoco puede convertirse en un descuento ni en una falta.
  it('no toca la guardia: ni la cierra, ni le descuenta nada, ni marca una ausencia', async () => {
    await pedir('POST', `/${GUARDIA}/descansos`, ANOCHE);
    const escrituras = llamadas.filter((l) => l.clave.startsWith('PATCH') || l.clave.startsWith('POST /rest/v1/'));
    for (const escritura of escrituras) {
      assert.ok(
        escritura.clave.endsWith('/descansos_guardia'),
        `anotar un descanso no puede escribir en ${escritura.clave}`
      );
    }
  });

  it('la nota se guarda cuando hay algo que decir', async () => {
    await pedir('POST', `/${GUARDIA}/descansos`, { ...ANOCHE, nota: '  Lo avisó por teléfono.  ' });
    assert.equal(descansosAnotados()[0].nota, 'Lo avisó por teléfono.');
  });

  it('la guardia se busca acotada a la Prestadora activa', async () => {
    await pedir('POST', `/${GUARDIA}/descansos`, ANOCHE);
    const lectura = llamadas.find((l) => l.clave === 'GET /rest/v1/guardias');
    assert.match(decodeURIComponent(lectura.url), new RegExp(`prestadora_id=eq\\.${PRESTADORA}`));
  });

  it('la guardia de otra Prestadora no se distingue de una que no existe', async () => {
    const { estado, cuerpo } = await pedir('POST', `/${GUARDIA_DE_OTRA_PRESTADORA}/descansos`, ANOCHE);
    assert.equal(estado, 404);
    assert.equal(descansosAnotados().length, 0);
    assert.doesNotMatch(cuerpo.error, /prestadora/i);
  });

  it('un fin anterior al principio no llega a la base', async () => {
    const { estado, cuerpo } = await pedir('POST', `/${GUARDIA}/descansos`, {
      inicio_at: ANOCHE.fin_at,
      fin_at: ANOCHE.inicio_at,
    });
    assert.equal(estado, 400);
    assert.equal(descansosAnotados().length, 0);
    // El motivo sale entendible: nada de nombres de tablas ni de restricciones.
    assert.doesNotMatch(cuerpo.error, /descansos_guardia|check|constraint/i);
  });

  it('un descanso que todavía no pasó no se anota', async () => {
    const { estado } = await pedir('POST', `/${GUARDIA}/descansos`, {
      inicio_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      fin_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    });
    assert.equal(estado, 400);
    assert.equal(descansosAnotados().length, 0);
  });

  it('sin principio o sin fin no se anota nada', async () => {
    const { estado } = await pedir('POST', `/${GUARDIA}/descansos`, { inicio_at: ANOCHE.inicio_at });
    assert.equal(estado, 400);
    assert.equal(descansosAnotados().length, 0);
  });

  it('sin sesión no se llega', async () => {
    const respuesta = await fetch(`${DIRECCION}/${GUARDIA}/descansos`, { method: 'POST' });
    assert.equal(respuesta.status, 401);
  });
});

describe('ver los descansos de una guardia', () => {
  it('devuelve los de esa guardia y los pide acotados a la Prestadora', async () => {
    descansosEnLaBase = [
      { id: DESCANSO, guardia_id: GUARDIA, prestadora_id: PRESTADORA, ...ANOCHE, nota: null },
      { id: 'otro', guardia_id: 'otra-guardia', prestadora_id: PRESTADORA, ...ANOCHE, nota: null },
    ];
    const { estado, cuerpo } = await pedir('GET', `/${GUARDIA}/descansos`);
    assert.equal(estado, 200);
    assert.equal(cuerpo.descansos.length, 1);
    assert.equal(cuerpo.descansos[0].id, DESCANSO);

    const lectura = llamadas.find((l) => l.clave === 'GET /rest/v1/descansos_guardia');
    assert.match(decodeURIComponent(lectura.url), new RegExp(`prestadora_id=eq\\.${PRESTADORA}`));
  });

  it('una guardia sin descansos devuelve la lista vacía, no un error', async () => {
    const { estado, cuerpo } = await pedir('GET', `/${GUARDIA}/descansos`);
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo.descansos, []);
  });

  it('la guardia de otra Prestadora no existe para esta sesión', async () => {
    const { estado } = await pedir('GET', `/${GUARDIA_DE_OTRA_PRESTADORA}/descansos`);
    assert.equal(estado, 404);
  });
});
