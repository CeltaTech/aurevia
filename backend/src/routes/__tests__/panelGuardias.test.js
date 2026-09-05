/**
 * Marcar una guardia como ausente, por la puerta del motor.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Hasta el 2026-09-05 esta operación estaba escrita dos veces: el
 * motor la hacía para la detección automática y el Panel la hacía a mano contra la base. Eran
 * dos versiones de la misma decisión y daban distinto. Ahora hay una sola, y esta ruta es por
 * donde entra el botón del Panel.
 *
 * Se prueba el camino entero contra una base de mentira: se entra con un rol, se pide la ruta y
 * se mira qué terminó escribiendo el motor. Lo que se mira no es que conteste 200, sino **qué
 * guardia quedó anotada como saliente en el incidente de relevo**, que es el dato por el que
 * existe la operación.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const GUARDIA_AJENA = '99999999-9999-9999-9999-999999999999';
const USUARIO = '22222222-2222-2222-2222-222222222222';
const GUARDIA = '33333333-3333-3333-3333-333333333333';
const ASISTENTE = '44444444-4444-4444-4444-444444444444';
const ELLA = '55555555-5555-5555-5555-555555555555';
const EL = '66666666-6666-6666-6666-666666666666';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, con la dirección entera: los filtros van ahí. */
let llamadas = [];

let rolDelUsuario = 'coordinador';

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

    // `.single()` y `.maybeSingle()` piden una fila sola con este encabezado.
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

async function pedir(metodo, ruta) {
  const respuesta = await fetch(`${DIRECCION}${ruta}`, {
    method: metodo,
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** La guardia que quedó vacía: sábado a la mañana, con Asistente asignado y todavía programada. */
const GUARDIA_VACIA = {
  id: GUARDIA,
  prestadora_id: PRESTADORA,
  paciente_id: ELLA,
  fecha: '2026-09-05',
  hora_inicio: '08:00',
  estado: 'programada',
  asistente_id: ASISTENTE,
};

/**
 * Lo que devuelve `guardia_pacientes` según cuál de las dos consultas sea.
 *
 * Las dos caen en la misma tabla y se distinguen por lo que piden: una pregunta a quiénes cubre
 * el turno (`pacientes(...)`) y la otra busca las guardias candidatas (`guardias!inner(...)`).
 */
function guardiaPacientes({ pacientes = [ELLA], candidatas = [] }) {
  return ({ url }) => {
    const select = new URL(url, 'http://interno').searchParams.get('select') ?? '';
    if (select.startsWith('guardias')) return candidatas.map((g) => ({ guardias: g }));
    return pacientes.map((id) => ({ guardia_id: GUARDIA, pacientes: { id } }));
  };
}

function incidenteInsertado() {
  return llamadas.find((l) => l.clave === 'POST /rest/v1/incidentes_relevo')?.cuerpo;
}

beforeEach(() => {
  llamadas = [];
  rolDelUsuario = 'coordinador';
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: rolDelUsuario, prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/guardias', () => [GUARDIA_VACIA]);
  respuestas.set('PATCH /rest/v1/guardias', () => []);
  respuestas.set('POST /rest/v1/incidentes_relevo', () => []);
  respuestas.set('GET /rest/v1/guardia_pacientes', guardiaPacientes({}));
});

describe('marcar ausente', () => {
  it('es trabajo del Coordinador: la ausencia se marca y el incidente se abre', async () => {
    const { estado, cuerpo } = await pedir('POST', `/${GUARDIA}/ausente`);
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);

    const cambio = llamadas.find((l) => l.clave === 'PATCH /rest/v1/guardias');
    assert.deepEqual(cambio.cuerpo, { estado: 'ausente' });

    const incidente = incidenteInsertado();
    assert.equal(incidente.prestadora_id, PRESTADORA);
    assert.equal(incidente.guardia_entrante_id, GUARDIA);
    assert.equal(incidente.nivel_actual, 1);
  });

  it('la guardia se busca acotada a la Prestadora activa', async () => {
    await pedir('POST', `/${GUARDIA}/ausente`);
    const lectura = llamadas.find((l) => l.clave === 'GET /rest/v1/guardias');
    assert.match(decodeURIComponent(lectura.url), new RegExp(`prestadora_id=eq\\.${PRESTADORA}`));
  });

  it('una guardia de otra Prestadora no se distingue de una que no existe', async () => {
    // La base contesta vacío porque el filtro de arriba la dejó afuera. Lo que se comprueba es
    // que el motor no cuenta la diferencia: es un 404 igual que el de un identificador inventado.
    respuestas.set('GET /rest/v1/guardias', () => []);
    const { estado, cuerpo } = await pedir('POST', `/${GUARDIA_AJENA}/ausente`);
    assert.equal(estado, 404);
    assert.equal(llamadas.some((l) => l.clave === 'PATCH /rest/v1/guardias'), false);
    assert.equal(incidenteInsertado(), undefined);
    assert.doesNotMatch(cuerpo.error, /prestadora/i);
  });

  it('sin Asistente asignado no hay ausencia: nadie faltó', async () => {
    respuestas.set('GET /rest/v1/guardias', () => [{ ...GUARDIA_VACIA, asistente_id: null }]);
    const { estado } = await pedir('POST', `/${GUARDIA}/ausente`);
    assert.equal(estado, 400);
    assert.equal(llamadas.some((l) => l.clave === 'PATCH /rest/v1/guardias'), false);
    assert.equal(incidenteInsertado(), undefined);
  });

  it('una guardia ya completada no se marca ausente', async () => {
    respuestas.set('GET /rest/v1/guardias', () => [{ ...GUARDIA_VACIA, estado: 'completada' }]);
    const { estado } = await pedir('POST', `/${GUARDIA}/ausente`);
    assert.equal(estado, 400);
    assert.equal(llamadas.some((l) => l.clave === 'PATCH /rest/v1/guardias'), false);
  });

  it('sin sesión no se llega', async () => {
    const respuesta = await fetch(`${DIRECCION}/${GUARDIA}/ausente`, { method: 'POST' });
    assert.equal(respuesta.status, 401);
  });
});

describe('quién se quedó esperando el relevo', () => {
  it('la guardia de noche que empezó el día anterior', async () => {
    respuestas.set(
      'GET /rest/v1/guardia_pacientes',
      guardiaPacientes({
        candidatas: [{ id: 'noche-anterior', fecha: '2026-09-04', hora_inicio: '22:00', hora_fin: '06:00' }],
      })
    );
    await pedir('POST', `/${GUARDIA}/ausente`);
    assert.equal(incidenteInsertado().guardia_saliente_id, 'noche-anterior');
  });

  // La misma prueba que en `utils/__tests__/marcarAusente.test.js`, pero por el camino entero:
  // acá se comprueba además que la consulta pida los DOS días. Filtrando por uno solo, la
  // guardia de noche no llegaba nunca a la elección.
  it('la consulta mira el día del turno y el anterior', async () => {
    await pedir('POST', `/${GUARDIA}/ausente`);
    const busqueda = llamadas.filter((l) => l.clave === 'GET /rest/v1/guardia_pacientes').at(-1);
    const direccion = decodeURIComponent(busqueda.url);
    assert.match(direccion, /2026-09-04/);
    assert.match(direccion, /2026-09-05/);
  });

  it('la guardia de noche del mismo día no es la saliente: todavía no había empezado', async () => {
    respuestas.set(
      'GET /rest/v1/guardia_pacientes',
      guardiaPacientes({
        candidatas: [{ id: 'noche-siguiente', fecha: '2026-09-05', hora_inicio: '22:00', hora_fin: '06:00' }],
      })
    );
    await pedir('POST', `/${GUARDIA}/ausente`);
    assert.equal(incidenteInsertado().guardia_saliente_id, null);
  });

  // El caso que el Panel perdía: la guardia cubre a un matrimonio, y la persona que estuvo antes
  // vino a cuidar al otro. Buscando por un solo Paciente esa guardia no aparecía y el incidente
  // salía como «Ausente sin relevo previo», que es la alerta más grave del sistema.
  it('se busca por todos los Pacientes del turno, no por uno', async () => {
    respuestas.set(
      'GET /rest/v1/guardia_pacientes',
      guardiaPacientes({
        pacientes: [ELLA, EL],
        candidatas: [{ id: 'la-del-marido', fecha: '2026-09-05', hora_inicio: '00:00', hora_fin: '08:00' }],
      })
    );
    await pedir('POST', `/${GUARDIA}/ausente`);

    const busqueda = llamadas.filter((l) => l.clave === 'GET /rest/v1/guardia_pacientes').at(-1);
    const direccion = decodeURIComponent(busqueda.url);
    assert.match(direccion, new RegExp(ELLA));
    assert.match(direccion, new RegExp(EL));
    assert.equal(incidenteInsertado().guardia_saliente_id, 'la-del-marido');
  });

  it('sin ninguna guardia anterior queda «ausente sin relevo previo»', async () => {
    await pedir('POST', `/${GUARDIA}/ausente`);
    assert.equal(incidenteInsertado().guardia_saliente_id, null);
  });
});
