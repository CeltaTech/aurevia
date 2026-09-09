/**
 * Los dos botones de antes de llegar: «salgo ahora» y «voy demorado» (pendiente #101).
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El sistema se apoya en el acto de la persona, y de ahí salen
 * cuatro cosas que hay que garantizar, y ninguna se ve mirando el código:
 *
 *   1. NINGUNO DE LOS DOS BOTONES SE TRABA. Ni por GPS, ni por hora, ni por conexión. Lo que se
 *      gana con ellos son los minutos de aviso que le quedan a la Prestadora para cubrir la
 *      guardia; un botón que se niega a guardar es un aviso perdido. Y hay un motivo técnico
 *      además: un pedido de la cola sin conexión que vuelve con error queda marcado y **corta la
 *      cola entera** (`pwa-asistentes/src/lib/sincronizarCola.js`), así que un rechazo acá
 *      dejaría trabado el check-in que viene atrás.
 *   2. EL AVISO ES DE QUIEN LO DIO. Queda anotado con el código de origen de los avisos de
 *      persona y con quién lo reportó. Ese acto no se puede confundir después con una cuenta que
 *      sacó una máquina.
 *   3. NO SE ESCRIBE UNA SALIDA DESPUÉS DE LA LLEGADA. Un pedido que llega tarde desde la cola
 *      no inventa una hora que no pasó.
 *   4. UNA PRESTADORA NO ALCANZA LA GUARDIA DE OTRA. El motor entra con la llave de servicio, así
 *      que lo único que aísla son los filtros de cada consulta.
 *
 * La base falsa de acá abajo honra los filtros de la consulta de guardias a propósito: si alguien
 * saca el filtro por Prestadora o por Asistente, la prueba del aislamiento deja de pasar.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';
import { MOTIVOS_DEMORA } from '../../utils/motivosDemora.js';
import {
  FUENTE_AVISO_DEMORA_ASISTENTE,
  FUENTE_CALCULO_LLEGADA_TARDIA,
  laDioUnaPersona,
} from '../../utils/fuentesAlertaTemprana.js';

const PRESTADORA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTRA_PRESTADORA = '99999999-9999-9999-9999-999999999999';
const USUARIO = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTRO_ASISTENTE = '88888888-8888-8888-8888-888888888888';
const GUARDIA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const GUARDIA_DE_OTRA_PRESTADORA = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const GUARDIA_DE_OTRO_ASISTENTE = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const PACIENTE = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
const ALERTA = '77777777-7777-7777-7777-777777777777';
const LAT = -34.6;
const LNG = -58.4;

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

const app = express();
app.use(express.json());
app.use('/api/app-asistentes', appAsistentesRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/app-asistentes`;

after(() => {
  motor.close();
  baseFalsa.close();
});

async function pedir(metodo, ruta, cuerpo) {
  const respuesta = await fetch(`${DIRECCION}${ruta}`, {
    method: metodo,
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

function haceUnRato(minutos) {
  return new Date(Date.now() - minutos * 60 * 1000).toISOString();
}

/** Las guardias que hay en la base falsa, de tres dueños distintos. */
let guardiasEnLaBase;
/** Las alertas tempranas que ya están anotadas. */
let alertasEnLaBase;

function guardiaDePrueba(extra = {}) {
  return {
    id: GUARDIA,
    prestadora_id: PRESTADORA,
    asistente_id: USUARIO,
    paciente_id: PACIENTE,
    fecha: '2026-09-09',
    hora_inicio: '14:00',
    hora_fin: '20:00',
    modalidad: 'con_retiro',
    estado: 'programada',
    salida_checkin_at: null,
    medio_transporte: null,
    checkin_at: null,
    checkout_at: null,
    checkout_bloqueado: false,
    ...extra,
  };
}

/**
 * La base falsa filtra de verdad por los `eq` que vengan en la dirección.
 *
 * Es lo que convierte la prueba de aislamiento en una prueba: una base que contestara siempre la
 * misma fila daría 200 aunque el motor consultara sin filtrar por Prestadora.
 */
function filaQuePasaLosFiltros(url, filas) {
  const parametros = new URL(url, 'http://interno').searchParams;
  return filas.filter((fila) =>
    [...parametros.entries()].every(([campo, condicion]) => {
      if (!Object.hasOwn(fila, campo)) return true;
      // «Todavía sin resolver» es una condición del filtro, no un adorno: si la base falsa la
      // ignorara, una alerta ya resuelta seguiría tapando los avisos nuevos y la prueba de eso
      // pasaría sin probar nada.
      if (condicion === 'is.null') return fila[campo] === null || fila[campo] === undefined;
      if (condicion === 'not.is.null') return fila[campo] !== null && fila[campo] !== undefined;
      if (!condicion.startsWith('eq.')) return true;
      return String(fila[campo]) === condicion.slice(3);
    })
  );
}

/** Las alertas tempranas que el motor dio de alta en este pedido. */
function alertasAnotadas() {
  return llamadas
    .filter((l) => l.clave === 'POST /rest/v1/alertas_tempranas_guardia')
    .map((l) => (Array.isArray(l.cuerpo) ? l.cuerpo[0] : l.cuerpo));
}

/** Lo que el motor le escribió a la guardia, si le escribió algo. */
function guardiasActualizadas() {
  return llamadas.filter((l) => l.clave === 'PATCH /rest/v1/guardias');
}

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  alertasEnLaBase = [];
  guardiasEnLaBase = [
    guardiaDePrueba(),
    guardiaDePrueba({ id: GUARDIA_DE_OTRA_PRESTADORA, prestadora_id: OTRA_PRESTADORA }),
    guardiaDePrueba({ id: GUARDIA_DE_OTRO_ASISTENTE, asistente_id: OTRO_ASISTENTE }),
  ];

  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'asistente', prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/guardias', ({ url }) => filaQuePasaLosFiltros(url, guardiasEnLaBase));
  respuestas.set('PATCH /rest/v1/guardias', () => []);
  respuestas.set('GET /rest/v1/alertas_tempranas_guardia', ({ url }) =>
    filaQuePasaLosFiltros(url, alertasEnLaBase)
  );
  respuestas.set('POST /rest/v1/alertas_tempranas_guardia', () => [{ id: ALERTA }]);
  respuestas.set('PATCH /rest/v1/alertas_tempranas_guardia', () => []);
  // El aviso al Coordinador pasa por acá antes de salir. Sin configuración cargada el evento se
  // considera encendido, y el correo no sale porque en las pruebas no hay servidor de correo.
  respuestas.set('GET /rest/v1/configuracion_notificaciones', () => []);
  respuestas.set('GET /rest/v1/configuracion_prestadora', () => []);
});

// ============================================================================
// «Salgo ahora»
// ============================================================================

describe('salida — el acto de avisar que se sale, que es lo que da los minutos', () => {
  it('guarda la hora, el punto de salida y el medio de transporte', async () => {
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/salida`, {
      lat: LAT,
      lng: LNG,
      medioTransporte: 'colectivo',
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.ok(cuerpo.salidaAt);

    const [escritura] = guardiasActualizadas();
    assert.ok(escritura, 'la salida tiene que quedar guardada');
    assert.equal(escritura.cuerpo.salida_checkin_at, cuerpo.salidaAt);
    assert.equal(escritura.cuerpo.salida_lat, LAT);
    assert.equal(escritura.cuerpo.salida_lng, LNG);
    assert.equal(escritura.cuerpo.medio_transporte, 'colectivo');
  });

  it('sin GPS se guarda igual: el botón no se traba porque el teléfono no ubicó', async () => {
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/salida`, { medioTransporte: 'a pie' });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);

    const [escritura] = guardiasActualizadas();
    assert.ok(escritura.cuerpo.salida_checkin_at, 'la hora se guarda aunque no haya punto');
    // Y el punto queda en blanco, no en cero: un cero es un lugar del planeta.
    assert.equal(escritura.cuerpo.salida_lat, null);
    assert.equal(escritura.cuerpo.salida_lng, null);
  });

  it('sin medio de transporte se guarda igual, en blanco', async () => {
    await pedir('POST', `/guardias/${GUARDIA}/salida`, { lat: LAT, lng: LNG });
    const [escritura] = guardiasActualizadas();
    assert.equal(escritura.cuerpo.medio_transporte, null);
    // Y un texto en blanco tampoco se guarda como texto en blanco.
    llamadas = [];
    await pedir('POST', `/guardias/${GUARDIA}/salida`, { medioTransporte: '   ' });
    assert.equal(guardiasActualizadas()[0].cuerpo.medio_transporte, null);
  });

  it('un punto que no es un punto sí se rechaza: guardarlo sería guardar una mentira', async () => {
    const { estado } = await pedir('POST', `/guardias/${GUARDIA}/salida`, { lat: 'por ahí', lng: LNG });
    assert.equal(estado, 400);
    assert.equal(guardiasActualizadas().length, 0);
  });

  it('el mismo pedido dos veces no pisa la hora que ya estaba', async () => {
    const salidaVieja = haceUnRato(20);
    guardiasEnLaBase[0].salida_checkin_at = salidaVieja;

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/salida`, { lat: LAT, lng: LNG });
    // No es un error: es la cola sin conexión reintentando, y un error acá cortaría la cola.
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.yaRegistrado, true);
    assert.equal(cuerpo.salidaAt, salidaVieja);
    assert.equal(guardiasActualizadas().length, 0);
  });

  it('si la persona ya llegó no se escribe una salida posterior a la llegada', async () => {
    guardiasEnLaBase[0].checkin_at = haceUnRato(5);

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/salida`, { lat: LAT, lng: LNG });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.yaLlego, true);
    assert.equal(guardiasActualizadas().length, 0);
  });

  it('la guardia de otra Prestadora no existe para este Asistente', async () => {
    const { estado } = await pedir('POST', `/guardias/${GUARDIA_DE_OTRA_PRESTADORA}/salida`, { lat: LAT, lng: LNG });
    assert.equal(estado, 404);
    assert.equal(guardiasActualizadas().length, 0);
  });

  it('la guardia de otro Asistente de la misma Prestadora tampoco', async () => {
    const { estado } = await pedir('POST', `/guardias/${GUARDIA_DE_OTRO_ASISTENTE}/salida`, { lat: LAT, lng: LNG });
    assert.equal(estado, 404);
    assert.equal(guardiasActualizadas().length, 0);
  });

  it('la escritura también va acotada a la Prestadora, no sólo la lectura', async () => {
    await pedir('POST', `/guardias/${GUARDIA}/salida`, { lat: LAT, lng: LNG });
    const [escritura] = guardiasActualizadas();
    assert.ok(escritura.url.includes(`prestadora_id=eq.${PRESTADORA}`), escritura.url);
    assert.ok(escritura.url.includes(`id=eq.${GUARDIA}`), escritura.url);
  });
});

// ============================================================================
// «Voy demorado»
// ============================================================================

describe('aviso de demora — el acto de la persona, anotado como suyo', () => {
  it('queda anotado con el origen de los avisos de persona y con quién lo dio', async () => {
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/aviso-demora`, { motivo: 'transporte' });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.motivo, 'transporte');

    const [alerta] = alertasAnotadas();
    assert.ok(alerta, 'el aviso tiene que quedar anotado');
    assert.equal(alerta.fuente, FUENTE_AVISO_DEMORA_ASISTENTE);
    assert.equal(alerta.motivo, 'transporte');
    assert.equal(alerta.reportado_por, USUARIO);
    assert.equal(alerta.prestadora_id, PRESTADORA);
    assert.equal(alerta.guardia_id, GUARDIA);
    assert.ok(alerta.detectado_at);
  });

  it('el origen es el de una persona, y nunca el de la cuenta automática', async () => {
    await pedir('POST', `/guardias/${GUARDIA}/aviso-demora`, { motivo: 'transito' });
    const [alerta] = alertasAnotadas();
    assert.equal(laDioUnaPersona(alerta.fuente), true);
    assert.notEqual(alerta.fuente, FUENTE_CALCULO_LLEGADA_TARDIA);
  });

  it('cualquiera de los motivos de la lista se guarda tal cual', async () => {
    for (const motivo of MOTIVOS_DEMORA) {
      llamadas = [];
      const { cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/aviso-demora`, { motivo });
      assert.equal(cuerpo.motivo, motivo);
      assert.equal(alertasAnotadas()[0].motivo, motivo);
    }
  });

  it('un motivo que no está en la lista no pierde el aviso: se guarda como «otro»', async () => {
    // Es el teléfono con la versión anterior cargada, o la lista que cambió. Perder el aviso por
    // un desajuste de versiones sería perder los minutos, que es lo único que importa acá.
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/aviso-demora`, { motivo: 'se_cortó_la_ruta' });
    assert.equal(estado, 200);
    assert.equal(cuerpo.motivo, 'otro');
    assert.equal(alertasAnotadas()[0].motivo, 'otro');
  });

  it('un aviso sin motivo tampoco se pierde', async () => {
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/aviso-demora`, {});
    assert.equal(estado, 200);
    assert.equal(cuerpo.motivo, 'otro');
    assert.equal(alertasAnotadas().length, 1);
  });

  it('se puede avisar la demora sin haber marcado la salida', async () => {
    // Quien salió corriendo y no apretó nada tiene que poder avisar igual desde el colectivo.
    assert.equal(guardiasEnLaBase[0].salida_checkin_at, null);
    const { estado } = await pedir('POST', `/guardias/${GUARDIA}/aviso-demora`, { motivo: 'transporte' });
    assert.equal(estado, 200);
    assert.equal(alertasAnotadas().length, 1);
  });

  it('el segundo aviso del mismo viaje no le repite la alerta al Coordinador', async () => {
    const antes = haceUnRato(8);
    alertasEnLaBase = [
      {
        id: ALERTA,
        guardia_id: GUARDIA,
        prestadora_id: PRESTADORA,
        fuente: FUENTE_AVISO_DEMORA_ASISTENTE,
        motivo: 'transito',
        detectado_at: antes,
        resuelto_at: null,
      },
    ];

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/aviso-demora`, { motivo: 'salud' });
    assert.equal(estado, 200);
    assert.equal(cuerpo.yaRegistrado, true);
    assert.equal(cuerpo.avisoAt, antes);
    assert.equal(cuerpo.motivo, 'transito');
    assert.equal(alertasAnotadas().length, 0);
  });

  it('una alerta que el Coordinador ya resolvió no tapa un aviso nuevo', async () => {
    alertasEnLaBase = [
      {
        id: ALERTA,
        guardia_id: GUARDIA,
        prestadora_id: PRESTADORA,
        fuente: FUENTE_AVISO_DEMORA_ASISTENTE,
        motivo: 'transito',
        detectado_at: haceUnRato(90),
        resuelto_at: haceUnRato(80),
      },
    ];

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/aviso-demora`, { motivo: 'imprevisto_familiar' });
    assert.equal(estado, 200);
    assert.equal(cuerpo.yaRegistrado, undefined);
    assert.equal(alertasAnotadas().length, 1);
    assert.equal(alertasAnotadas()[0].motivo, 'imprevisto_familiar');
  });

  it('el aviso sale en el momento, sin esperar la vuelta del proceso de fondo', async () => {
    await pedir('POST', `/guardias/${GUARDIA}/aviso-demora`, { motivo: 'transporte' });
    // Se mira la antesala del envío, que es lo único observable acá: el motor fue a buscar la
    // configuración del evento del Coordinador, y después anotó en la fila que ya notificó.
    assert.ok(
      llamadas.some((l) => l.clave === 'GET /rest/v1/configuracion_notificaciones'),
      'el aviso al Coordinador tiene que salir en el mismo pedido'
    );
    const marcada = llamadas.find((l) => l.clave === 'PATCH /rest/v1/alertas_tempranas_guardia');
    assert.ok(marcada, 'la fila tiene que quedar marcada como notificada');
    assert.equal(marcada.cuerpo.veces_notificado, 1);
    assert.ok(marcada.cuerpo.ultima_notificacion_at);
  });

  it('si la persona ya llegó, el aviso que venía en la cola no anota nada', async () => {
    guardiasEnLaBase[0].checkin_at = haceUnRato(3);
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/aviso-demora`, { motivo: 'transito' });
    assert.equal(estado, 200);
    assert.equal(cuerpo.yaLlego, true);
    assert.equal(alertasAnotadas().length, 0);
  });

  it('la guardia de otra Prestadora no existe para este Asistente', async () => {
    const { estado } = await pedir('POST', `/guardias/${GUARDIA_DE_OTRA_PRESTADORA}/aviso-demora`, { motivo: 'salud' });
    assert.equal(estado, 404);
    assert.equal(alertasAnotadas().length, 0);
  });

  it('la búsqueda de la alerta abierta también va acotada a la Prestadora', async () => {
    await pedir('POST', `/guardias/${GUARDIA}/aviso-demora`, { motivo: 'salud' });
    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/alertas_tempranas_guardia');
    assert.ok(consulta, 'antes de anotar se mira si ya hay un aviso abierto');
    assert.ok(consulta.url.includes(`prestadora_id=eq.${PRESTADORA}`), consulta.url);
    assert.ok(consulta.url.includes(`fuente=eq.${FUENTE_AVISO_DEMORA_ASISTENTE}`), consulta.url);
  });
});
