/**
 * El registro de auditoría se entrega de a una Organización por vez.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Hasta el 2026-09-08 esta ruta le entregaba al Superadmin el
 * registro de auditoría de todas las Prestadoras a la vez, mientras que la base —desde la
 * migración `20260822180000`, política `superadmin_lee_auditoria_de_su_sesion_activa`— sólo le
 * dejaba leer el de la Prestadora con la sesión de soporte abierta. Los dos lados decían cosas
 * distintas; era el pendiente #158. El Desarrollador resolvió que manda el alcance de la base:
 * una Prestadora por vez, la de la sesión de soporte, y para mirar otra se abre la sesión sobre
 * esa otra. Fuera de una sesión de soporte no se alcanza ninguna Prestadora real, sólo la
 * Organización ficticia de pruebas.
 *
 * Lo que se prueba no es que el código llame a `.eq()` —eso sería probar la biblioteca—, sino
 * qué termina recibiendo quien pregunta. La base de mentira aplica de verdad el filtro
 * `prestadora_id=eq.…` que le llegue: si alguien vuelve a sacar el filtro, la respuesta trae
 * las filas de las tres Organizaciones y estas pruebas fallan.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const SANDBOX = '00000000-0000-0000-0000-00000000000a';
const PRESTADORA_A = '11111111-1111-1111-1111-111111111111';
const PRESTADORA_B = '22222222-2222-2222-2222-222222222222';
const SUPERADMIN = '33333333-3333-3333-3333-333333333333';
const SESION = '44444444-4444-4444-4444-444444444444';

/* Tres Organizaciones con datos cargados, que es como se prueba un aislamiento: se ven los
   propios y no se ve ninguno del otro. Una consulta que devuelve vacío no probaría nada. */
const REGISTRO = [
  { id: 'ev-sandbox', prestadora_id: SANDBOX, tipo_evento: 'login', detalle: null, created_at: '2026-09-01T10:00:00Z' },
  { id: 'ev-a-1', prestadora_id: PRESTADORA_A, tipo_evento: 'login', detalle: null, created_at: '2026-09-02T10:00:00Z' },
  { id: 'ev-a-2', prestadora_id: PRESTADORA_A, tipo_evento: 'mutacion', detalle: { metodo: 'PATCH', ruta: '/api/panel/pacientes/x' }, created_at: '2026-09-02T11:00:00Z' },
  { id: 'ev-b-1', prestadora_id: PRESTADORA_B, tipo_evento: 'mutacion', detalle: { metodo: 'DELETE', ruta: '/api/panel/asistentes/y' }, created_at: '2026-09-03T10:00:00Z' },
];

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, con su dirección entera —filtros incluidos—. */
let llamadas = [];

let rolDelUsuario = 'superadmin';
let prestadoraDelUsuario = SANDBOX;
/** La sesión de soporte abierta, o `null` si no hay ninguna. */
let sesionDeSoporte = null;

function sesionVigenteSobre(prestadoraId) {
  const ahora = Date.now();
  return {
    id: SESION,
    prestadora_id: prestadoraId,
    expira_at: new Date(ahora + 30 * 60 * 1000).toISOString(),
    ultima_actividad_at: new Date(ahora - 10 * 1000).toISOString(),
  };
}

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const url = new URL(req.url, 'http://interno');
    const clave = `${req.method} ${url.pathname}`;
    llamadas.push({ clave, url });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada(url) : preparada;
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
const { panelAuditoriaRouter } = await import('../panelAuditoria.js');

const app = express();
app.use(express.json());
app.use('/api/panel/auditoria', panelAuditoriaRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/panel/auditoria`;

after(() => {
  motor.close();
  baseFalsa.close();
});

async function pedirRegistro() {
  const respuesta = await fetch(DIRECCION, {
    headers: { Authorization: 'Bearer token-de-mentira' },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** La consulta al registro, tal como le llegó a la base. `undefined` si nunca se hizo. */
function consultaAlRegistro() {
  return llamadas.find((l) => l.clave === 'GET /rest/v1/auditoria_soporte_tecnico')?.url;
}

beforeEach(() => {
  llamadas = [];
  rolDelUsuario = 'superadmin';
  prestadoraDelUsuario = SANDBOX;
  sesionDeSoporte = null;
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: SUPERADMIN, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: rolDelUsuario, prestadora_id: prestadoraDelUsuario }]);
  // El segundo factor no es lo que se prueba acá: se lo deja apagado para que el candado de
  // `requiereRolPanel` no se meta en el medio.
  respuestas.set('GET /rest/v1/configuracion_plataforma', () => [{ mfa_admin_obligatorio: false }]);
  respuestas.set('GET /rest/v1/sesiones_soporte_tecnico', () => (sesionDeSoporte ? [sesionDeSoporte] : []));
  respuestas.set('PATCH /rest/v1/sesiones_soporte_tecnico', () => []);

  /* La base de mentira aplica el filtro de verdad. Es lo que hace que estas pruebas puedan
     fallar: sin filtro, contesta las cuatro filas de las tres Organizaciones. */
  respuestas.set('GET /rest/v1/auditoria_soporte_tecnico', (url) => {
    const filtro = url.searchParams.get('prestadora_id');
    if (!filtro) return REGISTRO;
    const prestadoraId = filtro.replace(/^eq\./, '');
    return REGISTRO.filter((fila) => fila.prestadora_id === prestadoraId);
  });
});

const organizacionesDe = (eventos) => [...new Set(eventos.map((e) => e.prestadora_id))].sort();

// ---------------------------------------------------------------------------------------

describe('el Superadmin ve la Prestadora de su sesión de soporte, y ninguna otra', () => {
  it('con la sesión abierta sobre una Prestadora, ve esa', async () => {
    sesionDeSoporte = sesionVigenteSobre(PRESTADORA_A);
    const { estado, cuerpo } = await pedirRegistro();

    assert.equal(estado, 200);
    assert.deepEqual(organizacionesDe(cuerpo.eventos), [PRESTADORA_A]);
    assert.equal(cuerpo.eventos.length, 2);
  });

  it('con la sesión abierta sobre otra Prestadora, ve la otra y no la primera', async () => {
    sesionDeSoporte = sesionVigenteSobre(PRESTADORA_B);
    const { cuerpo } = await pedirRegistro();

    assert.deepEqual(organizacionesDe(cuerpo.eventos), [PRESTADORA_B]);
    assert.ok(
      !cuerpo.eventos.some((e) => e.prestadora_id === PRESTADORA_A),
      'se coló el registro de una Prestadora sobre la que no hay sesión de soporte'
    );
  });

  it('nunca pide el registro sin decir de qué Organización', async () => {
    sesionDeSoporte = sesionVigenteSobre(PRESTADORA_A);
    await pedirRegistro();

    const consulta = consultaAlRegistro();
    assert.ok(consulta, 'el motor no consultó el registro');
    assert.equal(
      consulta.searchParams.get('prestadora_id'),
      `eq.${PRESTADORA_A}`,
      'la consulta salió sin acotar a una Organización: así se entrega el registro entero'
    );
  });
});

describe('sin sesión de soporte abierta no se alcanza ninguna Prestadora real', () => {
  it('el Superadmin sólo ve la Organización de pruebas', async () => {
    sesionDeSoporte = null;
    const { estado, cuerpo } = await pedirRegistro();

    assert.equal(estado, 200);
    assert.deepEqual(organizacionesDe(cuerpo.eventos), [SANDBOX]);
    assert.equal(consultaAlRegistro().searchParams.get('prestadora_id'), `eq.${SANDBOX}`);
  });

  it('una sesión vencida no cuenta como sesión abierta', async () => {
    sesionDeSoporte = {
      ...sesionVigenteSobre(PRESTADORA_A),
      expira_at: new Date(Date.now() - 60 * 1000).toISOString(),
    };
    const { cuerpo } = await pedirRegistro();

    assert.deepEqual(organizacionesDe(cuerpo.eventos), [SANDBOX]);
  });

  it('una sesión sin actividad en los últimos 5 minutos tampoco', async () => {
    sesionDeSoporte = {
      ...sesionVigenteSobre(PRESTADORA_A),
      ultima_actividad_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
    };
    const { cuerpo } = await pedirRegistro();

    assert.deepEqual(organizacionesDe(cuerpo.eventos), [SANDBOX]);
  });
});

describe('el Admin_prestadora ve lo suyo', () => {
  it('acotado a su propia Prestadora', async () => {
    rolDelUsuario = 'admin_prestadora';
    prestadoraDelUsuario = PRESTADORA_A;
    const { estado, cuerpo } = await pedirRegistro();

    assert.equal(estado, 200);
    assert.deepEqual(organizacionesDe(cuerpo.eventos), [PRESTADORA_A]);
  });

  it('y una sesión de soporte ajena no lo mueve de ahí', async () => {
    // La sesión de soporte es de superadmin: el middleware ni la consulta para otro rol. Si
    // alguna vez lo hiciera, este Admin_prestadora terminaría mirando otra Prestadora.
    rolDelUsuario = 'admin_prestadora';
    prestadoraDelUsuario = PRESTADORA_A;
    sesionDeSoporte = sesionVigenteSobre(PRESTADORA_B);
    const { cuerpo } = await pedirRegistro();

    assert.deepEqual(organizacionesDe(cuerpo.eventos), [PRESTADORA_A]);
  });
});

describe('falla cerrado', () => {
  it('sin Organización resuelta no se entrega nada, y no se toca la tabla', async () => {
    prestadoraDelUsuario = null;
    sesionDeSoporte = null;
    const { estado } = await pedirRegistro();

    assert.equal(estado, 403);
    assert.equal(consultaAlRegistro(), undefined, 'el motor consultó el registro antes de negar');
  });

  it('el Coordinador no entra al registro de auditoría', async () => {
    rolDelUsuario = 'coordinador';
    prestadoraDelUsuario = PRESTADORA_A;
    const { estado } = await pedirRegistro();

    assert.equal(estado, 403);
    assert.equal(consultaAlRegistro(), undefined, 'el motor consultó el registro antes de negar');
  });
});
