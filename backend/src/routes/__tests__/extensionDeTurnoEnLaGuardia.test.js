/**
 * El «no puedo continuar» de quien se quedó esperando el relevo.
 *
 *   npm test --prefix backend
 *
 * QUÉ PROTEGEN ESTOS CASOS:
 *
 *   1. QUE EL AVISO SE PIERDA. Si el envío al Coordinador falla, el aviso ya quedó guardado y
 *      quien lo apretó recibe que salió bien. Su acto no depende de que el correo conteste, y la
 *      fila queda sin marca de notificada, que es lo que la deja al alcance de un reintento.
 *   2. QUE EL DETALLE SALGA POR UN CANAL PÚBLICO. Lo que escribió es información sensible
 *      (`celtatech/CLAUDE.md` §6): el aviso dice de qué turno se trata y nada más.
 *   3. QUE SE APRIETE DOS VECES. Se avisa una sola vez por extensión: apretarlo de nuevo devuelve
 *      la misma hora y no vuelve a escribir ni a avisar.
 *   4. QUE SE AVISE SIN ESTAR DE MÁS. Sin extensión abierta no hay nada que avisar por acá: el
 *      turno está corriendo y para eso está el botón de emergencia.
 *   5. QUE UNA PRESTADORA ALCANCE LA EXTENSIÓN DE OTRA. El motor entra con la llave de servicio y
 *      se saltea la protección por fila: lo único que separa a una de otra son los filtros.
 *   6. QUE SE PIERDA EL MOMENTO. El aviso puede quedar en la cola sin conexión, y esa demora es
 *      justamente el dato.
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
const GUARDIA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const GUARDIA_DE_OTRA_PRESTADORA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PACIENTE = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const EXTENSION = '22222222-2222-4222-8222-222222222222';

const DETALLE = 'Me descompuse y no puedo seguir de pie.';

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

async function desdeElTelefono(id, cuerpo) {
  const respuesta = await fetch(`${RAIZ}/api/app-asistentes/guardias/${id}/no-puedo-continuar`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo ?? {}),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

let guardiasEnLaBase;
let extensionesEnLaBase;

/**
 * La base falsa filtra de verdad por los `eq` y los `is` de la dirección: sin esto, la prueba de
 * aislamiento pasaría aunque el motor consultara sin filtrar por Prestadora.
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

const escrituras = () => llamadas.filter((l) => l.clave === 'PATCH /rest/v1/extensiones_de_turno');

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  guardiasEnLaBase = [
    {
      id: GUARDIA,
      prestadora_id: PRESTADORA,
      asistente_id: LEGAJO,
      paciente_id: PACIENTE,
      fecha: '2026-09-15',
      hora_inicio: '22:00',
      hora_fin: '06:00',
      estado: 'programada',
      checkin_at: '2026-09-15T22:01:00Z',
      checkout_at: null,
    },
    {
      id: GUARDIA_DE_OTRA_PRESTADORA,
      prestadora_id: OTRA_PRESTADORA,
      asistente_id: LEGAJO,
      paciente_id: PACIENTE,
      fecha: '2026-09-15',
      hora_inicio: '22:00',
      hora_fin: '06:00',
      estado: 'programada',
      checkin_at: '2026-09-15T22:01:00Z',
      checkout_at: null,
    },
  ];
  extensionesEnLaBase = [
    {
      id: EXTENSION,
      prestadora_id: PRESTADORA,
      guardia_id: GUARDIA,
      hasta_at: null,
      no_puede_continuar_at: null,
    },
  ];

  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'asistente', prestadora_id: PRESTADORA }]);
  // El Legajo con el que entra la sesión: lo busca el middleware por la cuenta y la Prestadora.
  respuestas.set('GET /rest/v1/asistentes', () => [{ id: LEGAJO, prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/guardias', ({ url }) => filasQuePasanLosFiltros(url, guardiasEnLaBase));
  respuestas.set('GET /rest/v1/extensiones_de_turno', ({ url }) =>
    filasQuePasanLosFiltros(url, extensionesEnLaBase)
  );
  respuestas.set('PATCH /rest/v1/extensiones_de_turno', () => []);
  // El aviso al Coordinador pasa por acá antes de salir. Sin configuración cargada el evento se
  // considera encendido, y el correo no sale porque en las pruebas no hay servidor de correo.
  respuestas.set('GET /rest/v1/configuracion_notificaciones', () => []);
  respuestas.set('GET /rest/v1/configuracion_prestadora', () => []);
  respuestas.set('GET /rest/v1/prestadoras', () => [{ idioma: 'es-AR' }]);
});

describe('avisar que no puede continuar la extensión', () => {
  it('queda guardado en la extensión abierta, con el detalle y la hora', async () => {
    const { estado, cuerpo } = await desdeElTelefono(GUARDIA, { detalle: DETALLE });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.ok(cuerpo.avisadoAt);

    const [escritura] = escrituras();
    assert.ok(escritura, 'el aviso tiene que quedar guardado');
    assert.equal(escritura.cuerpo.no_puede_continuar_detalle, DETALLE);
    assert.ok(escritura.cuerpo.no_puede_continuar_at);
    assert.ok(escritura.url.includes(`prestadora_id=eq.${PRESTADORA}`), escritura.url);
  });

  it('el detalle es opcional: quien está en el medio de algo puede no poder escribir nada', async () => {
    const { estado, cuerpo } = await desdeElTelefono(GUARDIA, {});
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(escrituras()[0].cuerpo.no_puede_continuar_detalle, null);
  });

  it('un detalle en blanco se guarda en blanco, no como texto vacío', async () => {
    await desdeElTelefono(GUARDIA, { detalle: '   ' });
    assert.equal(escrituras()[0].cuerpo.no_puede_continuar_detalle, null);
  });

  it('un texto sin fin se recorta y el aviso sale igual', async () => {
    await desdeElTelefono(GUARDIA, { detalle: 'a'.repeat(5000) });
    assert.equal(escrituras()[0].cuerpo.no_puede_continuar_detalle.length, 2000);
  });

  it('el momento en que pasó viaja con el aviso: el rato en la cola no se pierde', async () => {
    const ocurrio = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { cuerpo } = await desdeElTelefono(GUARDIA, { detalle: DETALLE, ocurrido_at: ocurrio });
    assert.equal(cuerpo.avisadoAt, ocurrio);
    assert.equal(escrituras()[0].cuerpo.no_puede_continuar_at, ocurrio);
  });

  it('una hora futura se descarta: es un reloj mal puesto, no un dato', async () => {
    const enUnRato = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { cuerpo } = await desdeElTelefono(GUARDIA, { detalle: DETALLE, ocurrido_at: enUnRato });
    assert.ok(Date.parse(cuerpo.avisadoAt) <= Date.now() + 1000);
  });

  it('el aviso al Coordinador sale en el mismo pedido, y la fila queda marcada', async () => {
    await desdeElTelefono(GUARDIA, { detalle: DETALLE });
    assert.ok(
      llamadas.some((l) => l.clave === 'GET /rest/v1/configuracion_notificaciones'),
      'el aviso al Coordinador tiene que salir en el momento'
    );
    const marcada = escrituras().find((l) => l.cuerpo.veces_notificado === 1);
    assert.ok(marcada, 'la fila tiene que quedar marcada como notificada');
    assert.ok(marcada.cuerpo.ultima_notificacion_at);
  });

  it('el detalle no sale en el aviso: se lee entrando al Panel', async () => {
    respuestas.set('GET /rest/v1/configuracion_notificaciones', () => [
      { emails: ['coordinacion@ejemplo.test'], activo: true, whatsapp_activo: false },
    ]);
    const salido = [];
    const fetchDeVerdad = globalThis.fetch;
    globalThis.fetch = async (direccion, opciones) => {
      if (String(direccion).startsWith('https://api.resend.com/')) {
        salido.push(String(opciones?.body ?? ''));
        return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return fetchDeVerdad(direccion, opciones);
    };
    process.env.RESEND_API_KEY = 'clave-de-mentira';
    process.env.REMITENTE_AVISOS = 'avisos@ejemplo.test';
    try {
      await desdeElTelefono(GUARDIA, { detalle: DETALLE });
      for (const cuerpoEnviado of salido) {
        assert.ok(!cuerpoEnviado.includes('descompuse'), 'el detalle no puede viajar en el aviso');
      }
    } finally {
      globalThis.fetch = fetchDeVerdad;
      delete process.env.RESEND_API_KEY;
      delete process.env.REMITENTE_AVISOS;
    }
  });

  it('si el aviso al Coordinador falla, lo guardado queda igual y sin marca de notificado', async () => {
    process.env.RESEND_API_KEY = 'clave-de-mentira';
    process.env.REMITENTE_AVISOS = 'avisos@ejemplo.test';
    const fetchDeVerdad = globalThis.fetch;
    globalThis.fetch = async (direccion, opciones) => {
      if (String(direccion).startsWith('https://api.resend.com/')) {
        throw new Error('el despachante no contesta');
      }
      return fetchDeVerdad(direccion, opciones);
    };
    respuestas.set('GET /rest/v1/configuracion_notificaciones', () => [
      { emails: ['coordinacion@ejemplo.test'], activo: true, whatsapp_activo: false },
    ]);
    respuestas.set('GET /rest/v1/prestadoras', () => [
      { casilla_envio: null, nombre_fantasia: null, logo_url: null },
    ]);
    respuestas.set('GET /rest/v1/configuracion_prestadora', () => [{ email: 'contacto@ejemplo.test' }]);

    try {
      const { estado, cuerpo } = await desdeElTelefono(GUARDIA, { detalle: DETALLE });
      assert.equal(estado, 200);
      assert.equal(cuerpo.ok, true);
      assert.equal(escrituras().length, 1, 'sólo la escritura del aviso, ninguna marca de notificado');
      assert.equal(escrituras()[0].cuerpo.veces_notificado, undefined);
    } finally {
      globalThis.fetch = fetchDeVerdad;
      delete process.env.RESEND_API_KEY;
      delete process.env.REMITENTE_AVISOS;
    }
  });

  it('se aprieta una sola vez: la segunda devuelve la misma hora y no escribe nada', async () => {
    const yaAvisado = '2026-09-16T06:30:00.000Z';
    extensionesEnLaBase[0].no_puede_continuar_at = yaAvisado;
    const { estado, cuerpo } = await desdeElTelefono(GUARDIA, { detalle: 'otra vez' });
    assert.equal(estado, 200);
    assert.equal(cuerpo.avisadoAt, yaAvisado);
    assert.equal(escrituras().length, 0);
  });

  it('sin extensión abierta no hay nada que avisar por acá', async () => {
    extensionesEnLaBase = [];
    const { estado, cuerpo } = await desdeElTelefono(GUARDIA, { detalle: DETALLE });
    assert.equal(estado, 404);
    assert.equal(cuerpo.motivo, 'no_encontrado');
    assert.equal(escrituras().length, 0);
  });

  it('una extensión ya cerrada no cuenta como abierta', async () => {
    extensionesEnLaBase[0].hasta_at = '2026-09-16T07:00:00.000Z';
    const { estado } = await desdeElTelefono(GUARDIA, { detalle: DETALLE });
    assert.equal(estado, 404);
    assert.equal(escrituras().length, 0);
  });

  it('la extensión se busca acotada a la Prestadora de la guardia', async () => {
    await desdeElTelefono(GUARDIA, { detalle: DETALLE });
    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/extensiones_de_turno');
    assert.ok(consulta.url.includes(`prestadora_id=eq.${PRESTADORA}`), consulta.url);
    assert.ok(consulta.url.includes(`guardia_id=eq.${GUARDIA}`), consulta.url);
  });

  it('la guardia de otra Prestadora no existe para este Asistente', async () => {
    const { estado } = await desdeElTelefono(GUARDIA_DE_OTRA_PRESTADORA, { detalle: DETALLE });
    assert.equal(estado, 404);
    assert.equal(escrituras().length, 0);
  });
});

// ============================================================================
// Lo que la pantalla ve del rato de más
// ============================================================================

describe('la extensión que viaja con el turno', () => {
  async function verElTurno() {
    const respuesta = await fetch(`${RAIZ}/api/app-asistentes/guardias/${GUARDIA}`, {
      headers: { Authorization: 'Bearer token-de-mentira' },
    });
    return { estado: respuesta.status, cuerpo: await respuesta.json() };
  }

  beforeEach(() => {
    // Lo que el resto de la pantalla del turno consulta y que acá no se mira: se contesta vacío
    // para que el pedido llegue entero hasta la extensión, que es lo que esta prueba vigila.
    for (const tabla of [
      'guardia_pacientes',
      'pacientes',
      'reportes',
      'descansos_guardia',
      'tipos_asistente',
      'tipo_asistente_tareas',
      'tareas_catalogo',
      'configuracion_visibilidad_asistente',
      'incidentes_relevo',
      'incidentes_turno_sin_cubrir',
      'escalones_de_alarma_avisados',
    ]) {
      respuestas.set(`GET /rest/v1/${tabla}`, () => []);
    }
    // `asistentes` no entra en esa lista: todo pedido con sesión pasa antes por el middleware,
    // que consulta esa tabla para saber cuál es el Legajo de quien entró. Lo que la pantalla del
    // turno le pregunta a la misma tabla —el nombre— sí se contesta vacío, y las dos consultas se
    // reparten por el `select`.
    respuestas.set('GET /rest/v1/asistentes', ({ url }) => {
      const select = new URL(url, 'http://interno').searchParams.get('select') ?? '';
      if (select.includes('nombre')) return [];
      return [{ id: LEGAJO, prestadora_id: PRESTADORA }];
    });
    respuestas.set('POST /rest/v1/rpc/domicilios_de_pacientes_en', () => []);
  });

  it('sin extensión abierta no viaja nada: es lo normal en casi todos los turnos', async () => {
    extensionesEnLaBase = [];
    const { estado, cuerpo } = await verElTurno();
    assert.equal(estado, 200);
    assert.equal(cuerpo.extension, null);
  });

  it('con extensión abierta viaja desde cuándo, si ya avisó, y los pasos de la búsqueda', async () => {
    extensionesEnLaBase[0].desde_at = '2026-09-16T06:00:00.000Z';
    const { estado, cuerpo } = await verElTurno();
    assert.equal(estado, 200);
    assert.equal(cuerpo.extension.desdeAt, '2026-09-16T06:00:00.000Z');
    assert.equal(cuerpo.extension.noPuedeContinuarAt, null);
    assert.deepEqual(cuerpo.extension.pasos, ['sin_novedades']);
  });

  it('el aviso a quien coordina se cuenta cuando salió, no cuando se abrió el expediente', async () => {
    extensionesEnLaBase[0].desde_at = '2026-09-16T06:00:00.000Z';
    // Expediente abierto y todavía sin ningún aviso enviado: decirle que ya avisaron sería mentir.
    respuestas.set('GET /rest/v1/incidentes_relevo', () => [{ id: 'inc-1', ultima_notificacion_at: null }]);
    const sinAvisar = await verElTurno();
    assert.deepEqual(sinAvisar.cuerpo.extension.pasos, ['sin_novedades']);

    respuestas.set('GET /rest/v1/incidentes_relevo', () => [
      { id: 'inc-1', ultima_notificacion_at: '2026-09-16T06:10:00.000Z' },
    ]);
    const avisado = await verElTurno();
    assert.deepEqual(avisado.cuerpo.extension.pasos, ['coordinacion_avisada']);
  });

  it('no sale ningún nombre en lo que ve quien está esperando', async () => {
    extensionesEnLaBase[0].desde_at = '2026-09-16T06:00:00.000Z';
    extensionesEnLaBase[0].relevo_guardia_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    respuestas.set('GET /rest/v1/guardias', ({ url }) =>
      filasQuePasanLosFiltros(url, [
        ...guardiasEnLaBase,
        {
          id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
          prestadora_id: PRESTADORA,
          asistente_id: 'otra-persona',
          nombre: 'Inventada Pérez',
          ofrecida_at: '2026-09-16T06:05:00.000Z',
          checkin_at: null,
        },
      ])
    );
    const { cuerpo } = await verElTurno();
    assert.deepEqual(cuerpo.extension.pasos, ['turno_ofrecido', 'relevo_asignado']);
    assert.ok(!JSON.stringify(cuerpo.extension).includes('Inventada'));
    assert.ok(!JSON.stringify(cuerpo.extension).includes('otra-persona'));
  });
});
