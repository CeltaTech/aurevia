/**
 * El botón de emergencia de la guardia en curso, de las dos puntas.
 *
 *   npm test --prefix backend
 *
 * Se prueban juntas la punta que avisa —la aplicación del Asistente— y la que atiende —el Panel—,
 * porque son las dos mitades de la misma decisión. Los casos están escritos por el error que
 * evitan:
 *
 *   1. QUE EL AVISO SE PIERDA. Si el envío al Coordinador falla, la emergencia ya quedó guardada y
 *      quien la reportó recibe que salió bien: su acto no depende de que WhatsApp conteste. La
 *      fila queda sin marca de notificada y el proceso de fondo la reintenta.
 *   2. QUE EL DETALLE SALGA POR UN CANAL PÚBLICO. El texto que escribió el Asistente es
 *      información sensible (`celtatech/CLAUDE.md` §6): el aviso dice de qué guardia se trata y
 *      nada más, y el texto se lee entrando al Panel.
 *   3. QUE UNA PRESTADORA ALCANCE LA EMERGENCIA DE OTRA. El motor entra a la base con la llave de
 *      servicio y se saltea la protección por fila, así que lo único que separa a una de otra son
 *      los filtros escritos en cada consulta.
 *   4. QUE SE PIERDA EL MOMENTO EN QUE PASÓ. El aviso puede quedar media hora en la cola sin
 *      conexión, y esa media hora es justamente el dato.
 *
 * La base falsa honra los filtros de la dirección a propósito: si alguien saca el filtro por
 * Prestadora, las pruebas de aislamiento dejan de pasar.
 *
 * Los datos son inventados.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTRA_PRESTADORA = '99999999-9999-4999-8999-999999999999';
const USUARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTRO_ASISTENTE = '88888888-8888-4888-8888-888888888888';
const GUARDIA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GUARDIA_DE_OTRA_PRESTADORA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const GUARDIA_DE_OTRO_ASISTENTE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const PACIENTE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const EMERGENCIA = '11111111-1111-4111-8111-111111111111';

const DETALLE = 'El Paciente se cayó en el baño y no puede levantarse. Llamé al 107.';

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

// El import va después de dejar puestas las variables de entorno: la conexión a la base se arma
// en el momento en que se importa, y con la dirección que haya en ese instante.
const { default: express } = await import('express');
await import('express-async-errors');
const { appAsistentesRouter } = await import('../appAsistentes.js');
const { panelEmergenciasRouter } = await import('../panelEmergencias.js');

const app = express();
app.use(express.json());
app.use('/api/app-asistentes', appAsistentesRouter);
app.use('/api/panel/emergencias', panelEmergenciasRouter);
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

const desdeElTelefono = (id, cuerpo) => pedir('POST', `/api/app-asistentes/guardias/${id}/emergencia`, cuerpo);
const enElPanel = (ruta, metodo = 'GET', cuerpo) => pedir(metodo, `/api/panel/emergencias${ruta}`, cuerpo);

/** Qué rol tiene la sesión que llega. Lo cambia cada prueba que lo necesita. */
let rolDelUsuario = 'asistente';
/** Las guardias que hay en la base falsa, de tres dueños distintos. */
let guardiasEnLaBase;
/** Las emergencias ya anotadas. */
let emergenciasEnLaBase;

function guardiaDePrueba(extra = {}) {
  return {
    id: GUARDIA,
    prestadora_id: PRESTADORA,
    asistente_id: USUARIO,
    paciente_id: PACIENTE,
    fecha: '2026-09-15',
    hora_inicio: '14:00',
    hora_fin: '20:00',
    estado: 'programada',
    checkin_at: null,
    checkout_at: null,
    ...extra,
  };
}

function emergenciaDePrueba(extra = {}) {
  return {
    id: EMERGENCIA,
    prestadora_id: PRESTADORA,
    guardia_id: GUARDIA,
    reportado_por: USUARIO,
    reportado_at: '2026-09-15T17:20:00Z',
    detalle: DETALLE,
    atendida_at: null,
    atendida_por: null,
    atendida_nota: null,
    ...extra,
  };
}

/**
 * La base falsa filtra de verdad por los `eq` y los `in` que vengan en la dirección.
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
      if (condicion.startsWith('in.')) {
        const adentro = condicion.slice(3).replace(/^\(|\)$/g, '').split(',').map((v) => v.replace(/^"|"$/g, ''));
        return adentro.includes(String(fila[campo]));
      }
      return true;
    })
  );
}

/** Las emergencias que el motor dio de alta en este pedido. */
function emergenciasAnotadas() {
  return llamadas
    .filter((l) => l.clave === 'POST /rest/v1/emergencias_guardia')
    .map((l) => (Array.isArray(l.cuerpo) ? l.cuerpo[0] : l.cuerpo));
}

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  rolDelUsuario = 'asistente';
  guardiasEnLaBase = [
    guardiaDePrueba(),
    guardiaDePrueba({ id: GUARDIA_DE_OTRA_PRESTADORA, prestadora_id: OTRA_PRESTADORA }),
    guardiaDePrueba({ id: GUARDIA_DE_OTRO_ASISTENTE, asistente_id: OTRO_ASISTENTE }),
  ];
  emergenciasEnLaBase = [emergenciaDePrueba()];

  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: rolDelUsuario, prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/guardias', ({ url }) => filasQuePasanLosFiltros(url, guardiasEnLaBase));
  respuestas.set('GET /rest/v1/emergencias_guardia', ({ url }) =>
    filasQuePasanLosFiltros(url, emergenciasEnLaBase)
  );
  respuestas.set('POST /rest/v1/emergencias_guardia', () => [{ id: EMERGENCIA }]);
  respuestas.set('PATCH /rest/v1/emergencias_guardia', () => []);
  respuestas.set('GET /rest/v1/asistentes', ({ url }) =>
    filasQuePasanLosFiltros(url, [{ id: USUARIO, prestadora_id: PRESTADORA, nombre: 'Marta Ledesma' }])
  );
  respuestas.set('GET /rest/v1/pacientes', ({ url }) =>
    filasQuePasanLosFiltros(url, [{ id: PACIENTE, prestadora_id: PRESTADORA, nombre: 'Elsa Puig' }])
  );
  // El aviso al Coordinador pasa por acá antes de salir. Sin configuración cargada el evento se
  // considera encendido, y el correo no sale porque en las pruebas no hay servidor de correo.
  respuestas.set('GET /rest/v1/configuracion_notificaciones', () => []);
  respuestas.set('GET /rest/v1/configuracion_prestadora', () => []);
  respuestas.set('GET /rest/v1/prestadoras', () => [{ idioma: 'es-AR' }]);
});

// ============================================================================
// La punta que avisa: la aplicación del Asistente
// ============================================================================

describe('avisar una emergencia desde la guardia', () => {
  it('queda guardada con el texto, con quién la avisó y con la Prestadora de la guardia', async () => {
    const { estado, cuerpo } = await desdeElTelefono(GUARDIA, { detalle: DETALLE });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.ok(cuerpo.reportadoAt);

    const [anotada] = emergenciasAnotadas();
    assert.ok(anotada, 'la emergencia tiene que quedar guardada');
    assert.equal(anotada.detalle, DETALLE);
    assert.equal(anotada.reportado_por, USUARIO);
    assert.equal(anotada.prestadora_id, PRESTADORA);
    assert.equal(anotada.guardia_id, GUARDIA);
  });

  it('sin detalle no hay emergencia: no se guarda una fila vacía', async () => {
    for (const cuerpoDelPedido of [{}, { detalle: '   ' }, { detalle: 42 }]) {
      llamadas = [];
      const { estado, cuerpo } = await desdeElTelefono(GUARDIA, cuerpoDelPedido);
      assert.equal(estado, 400);
      assert.equal(cuerpo.motivo, 'faltan_datos');
      assert.equal(emergenciasAnotadas().length, 0);
    }
  });

  it('el momento en que pasó viaja con el aviso: media hora en la cola no se pierde', async () => {
    const ocurrio = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { cuerpo } = await desdeElTelefono(GUARDIA, { detalle: DETALLE, ocurrido_at: ocurrio });
    assert.equal(cuerpo.reportadoAt, ocurrio);
    assert.equal(emergenciasAnotadas()[0].reportado_at, ocurrio);
  });

  it('una hora futura se descarta: es un reloj mal puesto, no un dato', async () => {
    const enUnRato = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { cuerpo } = await desdeElTelefono(GUARDIA, { detalle: DETALLE, ocurrido_at: enUnRato });
    assert.ok(Date.parse(cuerpo.reportadoAt) <= Date.now() + 1000);
    // Y una fecha que no es una fecha tampoco tira el aviso abajo.
    llamadas = [];
    const { estado } = await desdeElTelefono(GUARDIA, { detalle: DETALLE, ocurrido_at: 'el martes' });
    assert.equal(estado, 200);
    assert.ok(emergenciasAnotadas()[0].reportado_at);
  });

  it('el aviso al Coordinador sale en el mismo pedido, y la fila queda marcada', async () => {
    await desdeElTelefono(GUARDIA, { detalle: DETALLE });
    assert.ok(
      llamadas.some((l) => l.clave === 'GET /rest/v1/configuracion_notificaciones'),
      'el aviso al Coordinador tiene que salir en el momento'
    );
    const marcada = llamadas.find((l) => l.clave === 'PATCH /rest/v1/emergencias_guardia');
    assert.ok(marcada, 'la fila tiene que quedar marcada como notificada');
    assert.equal(marcada.cuerpo.veces_notificado, 1);
    assert.ok(marcada.cuerpo.ultima_notificacion_at);
  });

  it('si el aviso al Coordinador falla, la emergencia queda guardada igual', async () => {
    // El acto de quien reportó ya está hecho: devolverle un error lo dejaría creyendo que no avisó,
    // y además cortaría la cola sin conexión entera, que es peor todavía.
    //
    // Se rompe el envío de verdad, no un paso de adorno: la Prestadora tiene servidor de correo
    // propio configurado y ese servidor no contesta. La dirección es local y el puerto está
    // cerrado, así que la conexión se rechaza en el momento y la prueba no sale a la red.
    process.env.SMTP_USER = 'avisos@ejemplo.test';
    respuestas.set('GET /rest/v1/configuracion_notificaciones', () => [
      { emails: ['coordinacion@ejemplo.test'], activo: true, whatsapp_activo: false },
    ]);
    respuestas.set('GET /rest/v1/configuracion_email_prestadora', () => [
      {
        activo: true,
        credencial_secret_id: 'una-referencia',
        host: '127.0.0.1',
        puerto: 1,
        direccion_remitente: 'avisos@ejemplo.test',
      },
    ]);
    respuestas.set('POST /rest/v1/rpc/leer_credencial_smtp_prestadora', () => 'clave-de-mentira');

    try {
      const { estado, cuerpo } = await desdeElTelefono(GUARDIA, { detalle: DETALLE });
      assert.equal(estado, 200);
      assert.equal(cuerpo.ok, true);
      assert.equal(emergenciasAnotadas().length, 1);
      // Y queda sin marca de notificada, que es lo que la deja al alcance de un reintento.
      assert.equal(llamadas.filter((l) => l.clave === 'PATCH /rest/v1/emergencias_guardia').length, 0);
    } finally {
      delete process.env.SMTP_USER;
    }
  });

  it('la guardia de otra Prestadora no existe para este Asistente', async () => {
    const { estado } = await desdeElTelefono(GUARDIA_DE_OTRA_PRESTADORA, { detalle: DETALLE });
    assert.equal(estado, 404);
    assert.equal(emergenciasAnotadas().length, 0);
  });

  it('la guardia de otro Asistente de la misma Prestadora tampoco', async () => {
    const { estado } = await desdeElTelefono(GUARDIA_DE_OTRO_ASISTENTE, { detalle: DETALLE });
    assert.equal(estado, 404);
    assert.equal(emergenciasAnotadas().length, 0);
  });
});

// ============================================================================
// La punta que atiende: el Panel
// ============================================================================

describe('la bandeja del Panel', () => {
  beforeEach(() => {
    rolDelUsuario = 'coordinador';
  });

  it('trae las emergencias de la Organización, con quién y con quién se cuidaba', async () => {
    const { estado, cuerpo } = await enElPanel('/');
    assert.equal(estado, 200);
    assert.equal(cuerpo.emergencias.length, 1);
    assert.equal(cuerpo.emergencias[0].detalle, DETALLE);
    assert.equal(cuerpo.emergencias[0].guardia.asistente, 'Marta Ledesma');
    assert.equal(cuerpo.emergencias[0].guardia.paciente, 'Elsa Puig');
    assert.equal(cuerpo.emergencias[0].guardia.fecha, '2026-09-15');
  });

  it('todas las consultas van acotadas a la Prestadora de la sesión', async () => {
    await enElPanel('/');
    const consultadas = llamadas.filter((l) => l.clave.startsWith('GET /rest/v1/'));
    for (const tabla of ['emergencias_guardia', 'guardias', 'asistentes', 'pacientes']) {
      const consulta = consultadas.find((l) => l.clave.endsWith(`/${tabla}`));
      assert.ok(consulta, `tiene que haberse consultado ${tabla}`);
      assert.ok(consulta.url.includes(`prestadora_id=eq.${PRESTADORA}`), consulta.url);
    }
  });

  it('la emergencia de otra Prestadora no aparece', async () => {
    emergenciasEnLaBase = [emergenciaDePrueba({ prestadora_id: OTRA_PRESTADORA })];
    const { estado, cuerpo } = await enElPanel('/');
    assert.equal(estado, 200);
    assert.equal(cuerpo.emergencias.length, 0);
  });

  it('el filtro de las que esperan pide sólo las que nadie atendió', async () => {
    await enElPanel('/?estado=sin_atender');
    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/emergencias_guardia');
    assert.ok(consulta.url.includes('atendida_at=is.null'), consulta.url);
  });

  it('marcarla atendida deja quién, cuándo y qué se hizo', async () => {
    const { estado, cuerpo } = await enElPanel(`/${EMERGENCIA}/atencion`, 'POST', {
      nota: 'Llamé a la Familia y mandé un sustituto.',
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);

    const escritura = llamadas.find((l) => l.clave === 'PATCH /rest/v1/emergencias_guardia');
    assert.ok(escritura, 'la atención tiene que quedar guardada');
    assert.equal(escritura.cuerpo.atendida_por, USUARIO);
    assert.ok(escritura.cuerpo.atendida_at);
    assert.equal(escritura.cuerpo.atendida_nota, 'Llamé a la Familia y mandé un sustituto.');
    assert.ok(escritura.url.includes(`prestadora_id=eq.${PRESTADORA}`), escritura.url);
  });

  it('la nota es opcional, y en blanco se guarda en blanco y no como texto vacío', async () => {
    await enElPanel(`/${EMERGENCIA}/atencion`, 'POST', { nota: '   ' });
    const escritura = llamadas.find((l) => l.clave === 'PATCH /rest/v1/emergencias_guardia');
    assert.equal(escritura.cuerpo.atendida_nota, null);
  });

  it('la que ya atendió alguien no se vuelve a marcar', async () => {
    emergenciasEnLaBase = [
      emergenciaDePrueba({ atendida_at: '2026-09-15T17:40:00Z', atendida_por: USUARIO }),
    ];
    const { estado, cuerpo } = await enElPanel(`/${EMERGENCIA}/atencion`, 'POST', { nota: 'otra vez' });
    assert.equal(estado, 409);
    assert.equal(cuerpo.motivo, 'ya_resuelta');
    assert.equal(llamadas.filter((l) => l.clave === 'PATCH /rest/v1/emergencias_guardia').length, 0);
  });

  it('la de otra Prestadora contesta lo mismo que la que no existe', async () => {
    emergenciasEnLaBase = [emergenciaDePrueba({ prestadora_id: OTRA_PRESTADORA })];
    const deOtra = await enElPanel(`/${EMERGENCIA}/atencion`, 'POST', { nota: 'algo' });

    emergenciasEnLaBase = [];
    const inexistente = await enElPanel(`/${EMERGENCIA}/atencion`, 'POST', { nota: 'algo' });

    assert.equal(deOtra.estado, 404);
    assert.deepEqual(deOtra.cuerpo, inexistente.cuerpo);
    assert.equal(llamadas.filter((l) => l.clave === 'PATCH /rest/v1/emergencias_guardia').length, 0);
  });

  it('un Asistente no entra a la bandeja del Panel', async () => {
    rolDelUsuario = 'asistente';
    const { estado } = await enElPanel('/');
    assert.equal(estado, 403);
  });
});
