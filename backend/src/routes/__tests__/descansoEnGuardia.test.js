/**
 * El descanso adentro de la guardia.
 *
 *   npm test --prefix backend
 *
 * En una guardia de 24, 48 o 72 horas la Asistente descansa en el domicilio, generalmente de
 * noche, cuando el Paciente duerme, SIN DEJAR DE ESTAR DISPONIBLE. Los casos están escritos por el
 * error que evitan:
 *
 *   1. QUE EL DESCANSO SE CONVIERTA EN UN DESCUENTO. La guardia se paga por lo que dura. Ninguna
 *      de estas dos rutas toca la guardia, y esta prueba lo comprueba mirando qué se escribió: si
 *      alguien agrega un descuento de horas, deja de pasar.
 *   2. QUE INTERRUMPA EL TURNO. Descansar disponible no es irse: la guardia no se cierra, no se
 *      abre ningún hueco y no se marca ninguna ausencia.
 *   3. QUE QUEDEN DOS DESCANSOS ABIERTOS. Terminar sin haber empezado, o empezar de nuevo sin
 *      haber cerrado, dejaría una pantalla con dos botones y sin saber cuál es cuál.
 *   4. QUE UNA PRESTADORA ALCANCE LA GUARDIA DE OTRA. El motor entra con la llave de servicio y se
 *      saltea la protección por fila: lo único que separa a una de otra son los filtros de cada
 *      consulta.
 *   5. QUE SE PIERDA EL MOMENTO EN QUE PASÓ. El aviso puede quedar en la cola sin conexión, y ese
 *      rato es justamente el dato.
 *
 * Los datos son inventados.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTRA_PRESTADORA = '99999999-9999-4999-8999-999999999999';
const USUARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
// El Legajo de esa persona en esta Prestadora, que es otro número que el de la cuenta.
const LEGAJO = 'bbbbbbbb-bbbb-4bbb-8bbb-b0000000000b';
const OTRO_ASISTENTE = '88888888-8888-4888-8888-888888888888';
const GUARDIA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GUARDIA_DE_OTRA_PRESTADORA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const GUARDIA_DE_OTRO_ASISTENTE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PACIENTE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
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
const { appAsistentesRouter } = await import('../appAsistentes.js');

const app = express();
app.use(express.json());
app.use('/api/app-asistentes', appAsistentesRouter);
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

const empezar = (id, cuerpo) => pedir('POST', `/api/app-asistentes/guardias/${id}/descanso/empezar`, cuerpo);
const terminar = (id, cuerpo) => pedir('POST', `/api/app-asistentes/guardias/${id}/descanso/terminar`, cuerpo);

let guardiasEnLaBase;
let descansosEnLaBase;

function guardiaDePrueba(extra = {}) {
  return {
    id: GUARDIA,
    prestadora_id: PRESTADORA,
    asistente_id: LEGAJO,
    paciente_id: PACIENTE,
    fecha: '2026-09-12',
    hora_inicio: '08:00',
    hora_fin: '08:00',
    dias_hasta_el_fin: 2, // la guardia de fin de semana: sábado a la mañana, lunes a la mañana
    estado: 'programada',
    checkin_at: '2026-09-12T11:00:00Z',
    checkout_at: null,
    ...extra,
  };
}

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

/** Los descansos que el motor dio de alta en este pedido. */
function descansosAnotados() {
  return llamadas
    .filter((l) => l.clave === 'POST /rest/v1/descansos_guardia')
    .map((l) => (Array.isArray(l.cuerpo) ? l.cuerpo[0] : l.cuerpo));
}

/** Los cierres de descanso de este pedido. */
function cierres() {
  return llamadas.filter((l) => l.clave === 'PATCH /rest/v1/descansos_guardia').map((l) => l.cuerpo);
}

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  guardiasEnLaBase = [
    guardiaDePrueba(),
    guardiaDePrueba({ id: GUARDIA_DE_OTRA_PRESTADORA, prestadora_id: OTRA_PRESTADORA }),
    guardiaDePrueba({ id: GUARDIA_DE_OTRO_ASISTENTE, asistente_id: OTRO_ASISTENTE }),
  ];
  descansosEnLaBase = [];

  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'asistente', prestadora_id: PRESTADORA }]);
  // El Legajo con el que entra la sesión: lo busca el middleware por la cuenta y la Prestadora.
  respuestas.set('GET /rest/v1/asistentes', () => [{ id: LEGAJO, prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/guardias', ({ url }) => filasQuePasanLosFiltros(url, guardiasEnLaBase));
  respuestas.set('GET /rest/v1/descansos_guardia', ({ url }) =>
    filasQuePasanLosFiltros(url, descansosEnLaBase)
  );
  respuestas.set('POST /rest/v1/descansos_guardia', ({ cuerpo }) => {
    const fila = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
    return [{ id: DESCANSO, inicio_at: fila.inicio_at }];
  });
  respuestas.set('PATCH /rest/v1/descansos_guardia', () => []);
});

describe('empezar un descanso adentro de la guardia', () => {
  it('queda guardado con quién lo cargó y con la Prestadora de la guardia', async () => {
    const { estado, cuerpo } = await empezar(GUARDIA);
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);

    const [anotado] = descansosAnotados();
    assert.ok(anotado, 'el descanso tiene que quedar guardado');
    assert.equal(anotado.guardia_id, GUARDIA);
    assert.equal(anotado.prestadora_id, PRESTADORA);
    assert.equal(anotado.registrado_por, USUARIO);
    assert.ok(anotado.inicio_at);
    assert.equal(anotado.nota, null);
  });

  // Ésta es la regla de fondo, y la que más fácil se rompe sin darse cuenta: descansar disponible
  // no es irse. Si algún día alguien hace que empezar un descanso toque la guardia —cerrarla,
  // cambiarle el estado, descontarle horas—, esta prueba deja de pasar.
  it('no toca la guardia: ni la cierra, ni le descuenta nada, ni marca una ausencia', async () => {
    await empezar(GUARDIA);
    const escrituras = llamadas.filter((l) => l.clave.startsWith('PATCH') || l.clave.startsWith('POST /rest/v1/'));
    for (const escritura of escrituras) {
      assert.ok(
        escritura.clave.endsWith('/descansos_guardia'),
        `el descanso no puede escribir en ${escritura.clave}`
      );
    }
  });

  it('el momento en que empezó viaja con el aviso: el rato en la cola no se pierde', async () => {
    const hace40 = new Date(Date.now() - 40 * 60 * 1000).toISOString();
    await empezar(GUARDIA, { ocurrido_at: hace40 });
    assert.equal(descansosAnotados()[0].inicio_at, hace40);
  });

  it('una hora futura se descarta: es un reloj mal puesto, no un dato', async () => {
    const enUnRato = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await empezar(GUARDIA, { ocurrido_at: enUnRato });
    assert.ok(Date.parse(descansosAnotados()[0].inicio_at) <= Date.now() + 1000);
  });

  it('la nota es opcional y se guarda cuando hay algo que decir', async () => {
    await empezar(GUARDIA, { nota: 'La señora se durmió temprano.' });
    assert.equal(descansosAnotados()[0].nota, 'La señora se durmió temprano.');
  });

  it('la guardia de otra Prestadora no existe para esta sesión', async () => {
    const { estado } = await empezar(GUARDIA_DE_OTRA_PRESTADORA);
    assert.equal(estado, 404);
    assert.equal(descansosAnotados().length, 0);
  });

  it('la guardia de otra Asistente tampoco', async () => {
    const { estado } = await empezar(GUARDIA_DE_OTRO_ASISTENTE);
    assert.equal(estado, 404);
    assert.equal(descansosAnotados().length, 0);
  });
});

describe('terminar el descanso', () => {
  it('cierra el que estaba abierto', async () => {
    descansosEnLaBase = [
      { id: DESCANSO, guardia_id: GUARDIA, inicio_at: '2026-09-13T03:00:00.000Z', fin_at: null },
    ];
    const { estado, cuerpo } = await terminar(GUARDIA);
    assert.equal(estado, 200);
    assert.ok(cuerpo.finAt);
    assert.equal(cierres().length, 1);
    assert.equal(cierres()[0].fin_at, cuerpo.finAt);
  });

  it('sin ningún descanso abierto no se cierra nada', async () => {
    descansosEnLaBase = [];
    const { estado } = await terminar(GUARDIA);
    assert.equal(estado, 404);
    assert.equal(cierres().length, 0);
  });

  // Un fin anterior al inicio rompe la restricción de la base, y el error saldría como falla del
  // sistema delante de alguien que sólo apretó un botón.
  it('un reloj que da un fin anterior al inicio no rompe nada: vale la hora del motor', async () => {
    descansosEnLaBase = [
      { id: DESCANSO, guardia_id: GUARDIA, inicio_at: new Date(Date.now() - 60 * 1000).toISOString(), fin_at: null },
    ];
    const hace3horas = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
    const { estado, cuerpo } = await terminar(GUARDIA, { ocurrido_at: hace3horas });
    assert.equal(estado, 200);
    assert.ok(cuerpo.finAt > descansosEnLaBase[0].inicio_at);
  });

  it('tampoco toca la guardia al cerrar', async () => {
    descansosEnLaBase = [
      { id: DESCANSO, guardia_id: GUARDIA, inicio_at: '2026-09-13T03:00:00.000Z', fin_at: null },
    ];
    await terminar(GUARDIA);
    const escrituras = llamadas.filter((l) => l.clave.startsWith('PATCH') || l.clave.startsWith('POST /rest/v1/'));
    for (const escritura of escrituras) {
      assert.ok(
        escritura.clave.endsWith('/descansos_guardia'),
        `cerrar un descanso no puede escribir en ${escritura.clave}`
      );
    }
  });

  it('la guardia de otra Prestadora no existe para esta sesión', async () => {
    descansosEnLaBase = [
      { id: DESCANSO, guardia_id: GUARDIA_DE_OTRA_PRESTADORA, inicio_at: '2026-09-13T03:00:00.000Z', fin_at: null },
    ];
    const { estado } = await terminar(GUARDIA_DE_OTRA_PRESTADORA);
    assert.equal(estado, 404);
    assert.equal(cierres().length, 0);
  });
});
