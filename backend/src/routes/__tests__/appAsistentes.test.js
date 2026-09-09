/**
 * El pase de guardia (pendiente #113) — cómo se comprueba, además del GPS, que el Asistente está
 * de verdad en el domicilio cuando marca la llegada y cuando cierra.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Lo que hay que garantizar no es que la ruta conteste 200. Son
 * cuatro cosas, y ninguna se ve mirando el código:
 *
 *   1. EL PISO. La guardia nunca se traba. Si no hay quién muestre el código y en la Prestadora
 *      tampoco atiende nadie, el Asistente entra igual eligiendo un motivo, y esa llegada queda
 *      anotada como SIN COMPROBAR para que el Coordinador la mire después.
 *   2. UN CÓDIGO EQUIVOCADO NO MARCA NADA. Es lo único que se rechaza, porque darlo por bueno
 *      sería no comprobar y decir que sí.
 *   3. A LA FAMILIA SE LE AVISA CUANDO ELLA NO PARTICIPÓ. Si el código lo mostró ella, ya se
 *      enteró mostrándolo; si lo mostró el Asistente que se iba, o lo soltó la Prestadora, se le
 *      avisa que la guardia quedó cubierta y por quién.
 *   4. EL CÓDIGO NUNCA SE GUARDA EN CLARO. De la base sale la huella y nada más.
 *
 * Y que nada de esto debilitó lo que ya existía: ni el bloqueo por Reporte Diario faltante, ni el
 * protocolo de continuidad de guardia.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';
import { huellaDelCodigo } from '../../utils/codigoDeUnSoloUso.js';
import { olvidarPedidos } from '../../middleware/topeDePedidos.js';

const PRESTADORA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USUARIO = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // usuarios.id === asistentes.id === auth.uid()
const GUARDIA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PACIENTE = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const FAMILIA = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
const COMPROBACION = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
// El relevo: la guardia que todavía no cerró, sobre el mismo Paciente, y el Asistente que la está
// haciendo. Es quien puede mostrar el código cuando la Familia no está.
const GUARDIA_SALIENTE = '11111111-1111-1111-1111-111111111111';
const ASISTENTE_SALIENTE = '22222222-2222-2222-2222-222222222222';
const OTRA_FAMILIA = '33333333-3333-3333-3333-333333333333';
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

function enUnRato(minutos) {
  return new Date(Date.now() + minutos * 60 * 1000).toISOString();
}
function haceUnRato(minutos) {
  return new Date(Date.now() - minutos * 60 * 1000).toISOString();
}

/** La guardia contra la que se prueba, con los campos que lee `guardiaDelAsistente`. */
let guardiaActual;
/** Lo que la base tendría anotado en `guardia_comprobaciones` para esta guardia, o `null`. */
let comprobacionGuardada;
/** Los códigos que hay ahora mismo en la pantalla de alguien (`codigos_de_presencia`). */
let codigosEnPantalla;
/** ¿Hay otra guardia abierta sobre el mismo Paciente? Eso es lo que significa «hay relevo». */
let hayRelevo;

// La misma tabla se consulta de tres formas distintas y la base falsa sólo distingue por ruta,
// así que se reparte por el `select`, que es lo que las diferencia de verdad.
function guardiaPacientesRespuesta({ url }) {
  const select = new URL(url, 'http://interno').searchParams.get('select') ?? '';

  // `pacientesDeGuardias`: a quién atiende este turno.
  if (select.includes('pacientes(')) {
    return [{ guardia_id: GUARDIA, pacientes: { id: PACIENTE, nombre: 'Paciente de prueba', lat: LAT, lng: LNG, familia_id: FAMILIA } }];
  }

  // `sujetosQuePuedenMostrar`, segunda consulta: el Asistente que todavía no cerró.
  if (select.includes('guardias!inner')) {
    if (!hayRelevo) return [];
    return [{
      guardia_id: GUARDIA_SALIENTE,
      guardias: { id: GUARDIA_SALIENTE, asistente_id: ASISTENTE_SALIENTE, estado: 'activa', checkout_at: null },
    }];
  }

  // `sujetosQuePuedenMostrar`, primera consulta: los Pacientes de este turno.
  return [{ paciente_id: PACIENTE }];
}

// Se honra el vencimiento porque es la mitad del mecanismo: un código de hace un minuto no tiene
// que servir, y si la base falsa devolviera todo, la prueba del código vencido no probaría nada.
function codigosDePresenciaRespuesta({ url }) {
  const corte = new URL(url, 'http://interno').searchParams.get('expira_en') ?? '';
  const desde = corte.startsWith('gt.') ? corte.slice(3) : null;
  return codigosEnPantalla.filter((c) => !desde || new Date(c.expira_en) > new Date(desde));
}

function comprobacionesGuardadas() {
  return llamadas
    .filter((l) => l.clave === 'POST /rest/v1/guardia_comprobaciones')
    .map((l) => (Array.isArray(l.cuerpo) ? l.cuerpo[0] : l.cuerpo));
}

function comprobacionesActualizadas() {
  return llamadas
    .filter((l) => l.clave === 'PATCH /rest/v1/guardia_comprobaciones')
    .map((l) => l.cuerpo);
}

function guardiaMarcada() {
  return llamadas.some((l) => l.clave === 'PATCH /rest/v1/guardias');
}

/** Cada vez que la base sumó un intento, con qué tabla y qué fila se lo pidieron. */
function intentosSumados() {
  return llamadas
    .filter((l) => l.clave === 'POST /rest/v1/rpc/sumar_intento_de_codigo')
    .map((l) => l.cuerpo);
}

// Cómo se ve desde afuera que salió el aviso de cobertura: para armarlo, el motor va a buscar el
// nombre del Asistente a `asistentes`, y en el camino de un check-in no lo consulta nadie más. El
// push en sí no se puede observar acá —sin claves VAPID no sale— y por eso se mira su antesala.
function avisoDeCoberturaArmado() {
  return llamadas.some((l) => l.clave === 'GET /rest/v1/asistentes');
}

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  // El tope de pedidos por minuto lleva su cuenta en la memoria del proceso, y todas las pruebas
  // de este archivo entran con el mismo Asistente. Sin esto, la prueba número once heredaría los
  // diez pedidos de las anteriores y fallaría por algo que no está probando. Que el tope existe
  // se prueba aparte, a propósito, más abajo.
  olvidarPedidos();
  // Y se arranca siempre con el valor de fábrica, para que el resultado no dependa de lo que haya
  // configurado la máquina donde corre la prueba. La prueba del tope pone el suyo.
  delete process.env.TOPE_PEDIDOS_POR_MINUTO;
  comprobacionGuardada = null;
  codigosEnPantalla = [];
  hayRelevo = false;
  guardiaActual = {
    id: GUARDIA,
    prestadora_id: PRESTADORA,
    asistente_id: USUARIO,
    paciente_id: PACIENTE,
    fecha: '2026-09-09',
    hora_inicio: '08:00',
    hora_fin: '20:00',
    modalidad: 'con_retiro',
    estado: 'programada',
    checkin_at: null,
    checkout_at: null,
    checkout_bloqueado: false,
  };

  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'asistente', prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/guardias', () => [guardiaActual]);
  respuestas.set('PATCH /rest/v1/guardias', () => [{ id: GUARDIA }]);
  respuestas.set('GET /rest/v1/guardia_pacientes', guardiaPacientesRespuesta);
  respuestas.set('GET /rest/v1/pacientes', () => [{ id: PACIENTE, familia_id: FAMILIA }]);
  respuestas.set('GET /rest/v1/asistentes', () => [{ nombre: 'Asistente de prueba' }]);
  respuestas.set('GET /rest/v1/configuracion_ausencia_automatica', () => []);
  respuestas.set('POST /rest/v1/rpc/domicilios_de_pacientes_en', () => []);
  respuestas.set('POST /rest/v1/mensajes_asistente', () => []);
  // La comprobación de esta guardia, y el alta o pisada de esa misma fila. El alta devuelve lo
  // que le mandaron porque el motor la vuelve a leer con `.select().single()`.
  respuestas.set('GET /rest/v1/guardia_comprobaciones', () => (comprobacionGuardada ? [comprobacionGuardada] : []));
  respuestas.set('POST /rest/v1/guardia_comprobaciones', ({ cuerpo }) => {
    const fila = Array.isArray(cuerpo) ? cuerpo[0] : cuerpo;
    // La base pisa sólo las columnas que le mandan y deja como estaban las que no viajaron. Acá se
    // imita eso: si el alta se quedara con la fila entera, la prueba de «pedir otro código no
    // devuelve intentos» pasaría aunque alguien volviera a poner el cero, y no probaría nada.
    comprobacionGuardada = { ...(comprobacionGuardada ?? {}), ...fila, id: COMPROBACION };
    return [comprobacionGuardada];
  });
  respuestas.set('PATCH /rest/v1/guardia_comprobaciones', () => []);
  // La base suma el intento en un solo paso y devuelve cuántos van, contando el que se acaba de
  // hacer. Acá se imita eso de verdad —el número sube en la fila y el que vuelve es el nuevo—,
  // porque una base falsa que devolviera siempre 1 dejaría pasar cualquier cantidad de intentos y
  // la prueba del tope no probaría nada.
  respuestas.set('POST /rest/v1/rpc/sumar_intento_de_codigo', ({ cuerpo }) => {
    // Una tabla que no está en la lista o una fila que no existe: la base de verdad corta con un
    // error, y acá se deja que corte igual (la respuesta sin preparar es un 400). Contestar un
    // número inventado sería inventar un permiso.
    if (cuerpo?.p_tabla !== 'guardia_comprobaciones') return undefined;
    if (!comprobacionGuardada || comprobacionGuardada.id !== cuerpo.p_id) return undefined;
    comprobacionGuardada.codigo_intentos = (comprobacionGuardada.codigo_intentos ?? 0) + 1;
    return comprobacionGuardada.codigo_intentos;
  });
  respuestas.set('GET /rest/v1/codigos_de_presencia', codigosDePresenciaRespuesta);
  respuestas.set('POST /rest/v1/codigos_de_presencia', () => []);
  // Por omisión, con el Reporte Diario ya cargado: así las pruebas de check-out que no hablan
  // de reportes no tropiezan con el guard de "falta_reporte", que se prueba aparte.
  respuestas.set('GET /rest/v1/reportes', () => [{ id: 'reporte-1', paciente_id: PACIENTE }]);
});

// ============================================================================
// El piso: la guardia nunca se traba
// ============================================================================

describe('check-in — el piso, que no se negocia: la guardia nunca se traba', () => {
  for (const motivo of ['nadie_para_mostrar', 'prestadora_no_responde', 'sin_camara', 'sin_conexion', 'otro']) {
    it(`se entra igual eligiendo «${motivo}», y la llegada queda sin comprobar`, async () => {
      const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
        lat: LAT,
        lng: LNG,
        comprobacion: { motivoSinComprobar: motivo, detalle: 'No contestó nadie' },
      });
      assert.equal(estado, 200);
      assert.equal(cuerpo.ok, true);
      assert.equal(cuerpo.comprobacion, 'sin_comprobar');
      assert.equal(guardiaMarcada(), true);

      const [fila] = comprobacionesGuardadas();
      assert.equal(fila.guardia_id, GUARDIA);
      assert.equal(fila.prestadora_id, PRESTADORA);
      assert.equal(fila.asistente_id, USUARIO);
      assert.equal(fila.momento, 'checkin');
      assert.equal(fila.estado, 'sin_comprobar');
      assert.equal(fila.medio, null);
      assert.equal(fila.motivo_sin_comprobar, motivo);
      assert.equal(fila.motivo_detalle, 'No contestó nadie');
      assert.equal(fila.lat, LAT);
      assert.equal(fila.lng, LNG);

      // A la Familia no se le avisa: nadie comprobó nada, no hay cobertura que anunciar.
      assert.equal(avisoDeCoberturaArmado(), false);
    });
  }

  // Un pedido sin datos de comprobación es un teléfono con la versión anterior todavía cargada, o
  // un check-in que quedó en la cola sin conexión y se está reintentando ahora. Ese Asistente está
  // parado en la puerta y tiene que poder marcar; lo que no puede es quedar anotado como si
  // alguien hubiera comprobado algo.
  const pedidosViejos = [
    ['sin decir nada de la comprobación', { lat: LAT, lng: LNG }],
    ['con la comprobación vacía', { lat: LAT, lng: LNG, comprobacion: {} }],
    ['con un código en blanco', { lat: LAT, lng: LNG, comprobacion: { codigo: '   ' } }],
    ['con un motivo que no está en la lista', { lat: LAT, lng: LNG, comprobacion: { motivoSinComprobar: 'se_lo_comio_el_perro' } }],
  ];

  for (const [caso, cuerpoDelPedido] of pedidosViejos) {
    it(`${caso}, el check-in se marca igual y queda sin comprobar por «otro»`, async () => {
      const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, cuerpoDelPedido);
      assert.equal(estado, 200);
      assert.equal(cuerpo.ok, true);
      assert.equal(guardiaMarcada(), true);

      const [fila] = comprobacionesGuardadas();
      assert.equal(fila.estado, 'sin_comprobar');
      assert.equal(fila.motivo_sin_comprobar, 'otro');
    });
  }

  it('el motivo que el teléfono mandó de más queda en el detalle, no se pierde', async () => {
    await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { motivoSinComprobar: 'se_lo_comio_el_perro' },
    });
    const [fila] = comprobacionesGuardadas();
    assert.equal(fila.motivo_detalle, 'se_lo_comio_el_perro');
  });

  it('sin GPS no se marca nada, ni siquiera con un motivo: el código va junto al GPS, no en su lugar', async () => {
    const { estado } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      comprobacion: { motivoSinComprobar: 'nadie_para_mostrar' },
    });
    assert.equal(estado, 400);
    assert.equal(guardiaMarcada(), false);
    assert.equal(comprobacionesGuardadas().length, 0);
  });
});

// ============================================================================
// Plan A — el código lo muestra una persona en la pantalla de su teléfono
// ============================================================================

describe('check-in — Plan A: el código lo muestra una persona', () => {
  it('el código que muestra la Familia marca la llegada, y a la Familia no se le avisa nada', async () => {
    codigosEnPantalla = [
      { sujeto_tipo: 'familia', sujeto_id: FAMILIA, codigo_huella: huellaDelCodigo('123456'), expira_en: enUnRato(1) },
    ];

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '123456' },
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.comprobacion, 'comprobada');
    assert.equal(guardiaMarcada(), true);

    const [fila] = comprobacionesGuardadas();
    assert.equal(fila.estado, 'comprobada');
    assert.equal(fila.medio, 'codigo_familia');
    assert.equal(fila.sujeto_tipo, 'familia');
    assert.equal(fila.sujeto_id, FAMILIA);
    assert.ok(fila.comprobada_en, 'tiene que quedar cuándo se comprobó');
    assert.equal(fila.motivo_sin_comprobar, null);

    // La Familia participó: lo mostró ella. Avisarle sería contarle algo que acaba de hacer.
    assert.equal(avisoDeCoberturaArmado(), false);
  });

  it('el código que muestra el Asistente que se va marca la llegada, y a la Familia sí se le avisa', async () => {
    hayRelevo = true;
    codigosEnPantalla = [
      { sujeto_tipo: 'asistente', sujeto_id: ASISTENTE_SALIENTE, codigo_huella: huellaDelCodigo('654321'), expira_en: enUnRato(1) },
    ];

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '654321' },
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.comprobacion, 'comprobada');

    const [fila] = comprobacionesGuardadas();
    assert.equal(fila.medio, 'codigo_asistente_saliente');
    assert.equal(fila.sujeto_tipo, 'asistente');
    assert.equal(fila.sujeto_id, ASISTENTE_SALIENTE);

    // La Familia no participó de esta comprobación: tiene que enterarse de que la guardia quedó
    // cubierta y por quién.
    assert.equal(avisoDeCoberturaArmado(), true);
  });

  it('un código vencido no marca nada, aunque sea el que esa persona mostró hace un minuto', async () => {
    codigosEnPantalla = [
      { sujeto_tipo: 'familia', sujeto_id: FAMILIA, codigo_huella: huellaDelCodigo('123456'), expira_en: haceUnRato(1) },
    ];

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '123456' },
    });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'codigo_incorrecto');
    assert.equal(guardiaMarcada(), false);
    assert.equal(comprobacionesGuardadas().length, 0);
  });

  it('un código vigente de otra casa no marca nada: se compara sólo contra quien podría estar en ésta', async () => {
    codigosEnPantalla = [
      { sujeto_tipo: 'familia', sujeto_id: OTRA_FAMILIA, codigo_huella: huellaDelCodigo('999999'), expira_en: enUnRato(1) },
    ];

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '999999' },
    });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'codigo_incorrecto');
    assert.equal(guardiaMarcada(), false);
  });

  it('un código equivocado no marca la llegada, y eso no traba nada: el motivo sigue disponible', async () => {
    codigosEnPantalla = [
      { sujeto_tipo: 'familia', sujeto_id: FAMILIA, codigo_huella: huellaDelCodigo('123456'), expira_en: enUnRato(1) },
    ];

    const primero = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '000000' },
    });
    assert.equal(primero.estado, 400);
    assert.equal(primero.cuerpo.motivo, 'codigo_incorrecto');
    assert.equal(guardiaMarcada(), false);

    llamadas = [];
    const segundo = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { motivoSinComprobar: 'nadie_para_mostrar' },
    });
    assert.equal(segundo.estado, 200);
    assert.equal(segundo.cuerpo.comprobacion, 'sin_comprobar');
    assert.equal(guardiaMarcada(), true);
  });
});

describe('el código que se muestra en pantalla', () => {
  it('sale de seis dígitos, con los segundos que la Prestadora configuró, y en la base queda sólo la huella', async () => {
    respuestas.set('GET /rest/v1/configuracion_ausencia_automatica', () => [{ segundos_codigo_en_pantalla: 45, minutos_codigo_de_la_prestadora: 10 }]);

    const { estado, cuerpo } = await pedir('GET', '/codigo-de-presencia');
    assert.equal(estado, 200);
    assert.match(cuerpo.codigo, /^\d{6}$/);
    assert.equal(cuerpo.segundos, 45);
    assert.ok(new Date(cuerpo.expiraEn) > new Date(), 'el vencimiento tiene que estar adelante');

    const guardado = llamadas.find((l) => l.clave === 'POST /rest/v1/codigos_de_presencia');
    const fila = Array.isArray(guardado.cuerpo) ? guardado.cuerpo[0] : guardado.cuerpo;
    assert.equal(fila.sujeto_tipo, 'asistente');
    assert.equal(fila.sujeto_id, USUARIO);
    assert.equal(fila.prestadora_id, PRESTADORA);
    assert.equal(fila.codigo_huella, huellaDelCodigo(cuerpo.codigo));
    assert.equal(JSON.stringify(fila).includes(cuerpo.codigo), false, 'el código nunca se guarda en claro');
  });

  it('sin fila de configuración usa los segundos de fábrica', async () => {
    const { estado, cuerpo } = await pedir('GET', '/codigo-de-presencia');
    assert.equal(estado, 200);
    assert.equal(cuerpo.segundos, 30);
  });

  it('cada pedido escribe un código nuevo: por eso una foto de la pantalla no sirve un minuto después', async () => {
    await pedir('GET', '/codigo-de-presencia');
    await pedir('GET', '/codigo-de-presencia');
    const escrituras = llamadas.filter((l) => l.clave === 'POST /rest/v1/codigos_de_presencia');
    assert.equal(escrituras.length, 2);
  });
});

// ============================================================================
// Plan B — el código lo suelta la Prestadora
// ============================================================================

describe('Plan B — «no hay nadie que me pueda mostrar el código»', () => {
  it('el pedido queda esperando en la pantalla de la Prestadora, y no marca ninguna llegada', async () => {
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/comprobacion/pedido`, {
      momento: 'checkin',
      texto: 'La puerta está cerrada y no atiende nadie',
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.estado, 'pendiente_de_codigo');
    assert.ok(cuerpo.pedidoEn, 'tiene que quedar cuándo se pidió');

    const [fila] = comprobacionesGuardadas();
    assert.equal(fila.estado, 'pendiente_de_codigo');
    assert.equal(fila.momento, 'checkin');
    assert.equal(fila.pedido_texto, 'La puerta está cerrada y no atiende nadie');
    assert.equal(fila.codigo_huella, null);
    // Y el pedido NO toca la cuenta de intentos (pendiente #177). Antes escribía un cero acá, y
    // como este pedido lo abre el mismo Asistente que después prueba los códigos, eso le daba su
    // propio botón para volver a empezar. En un alta la base pone el cero sola; sobre una fila que
    // ya existe, lo que no se manda no se pisa.
    assert.equal(
      Object.prototype.hasOwnProperty.call(fila, 'codigo_intentos'),
      false,
      'pedir un código nuevo no puede devolver intentos',
    );
    assert.equal(guardiaMarcada(), false);
  });

  it('un momento que no es ni llegada ni salida se rechaza', async () => {
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/comprobacion/pedido`, { momento: 'a_mitad', texto: 'x' });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'faltan_datos');
    assert.equal(comprobacionesGuardadas().length, 0);
  });

  it('no se pide un código para algo que ya quedó comprobado', async () => {
    comprobacionGuardada = { id: COMPROBACION, estado: 'comprobada', momento: 'checkin', codigo_huella: null };
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/comprobacion/pedido`, { momento: 'checkin', texto: 'x' });
    assert.equal(estado, 409);
    assert.equal(cuerpo.motivo, 'ya_comprobada');
    assert.equal(comprobacionesGuardadas().length, 0);
  });

  it('mientras espera, la pantalla pregunta cómo viene y nunca recibe el código ni su huella', async () => {
    comprobacionGuardada = {
      id: COMPROBACION,
      estado: 'pendiente_de_codigo',
      momento: 'checkin',
      codigo_huella: huellaDelCodigo('321321'),
      codigo_expira_en: enUnRato(10),
    };
    const { estado, cuerpo } = await pedir('GET', `/guardias/${GUARDIA}/comprobacion/checkin`);
    assert.equal(estado, 200);
    assert.equal(cuerpo.estado, 'pendiente_de_codigo');
    assert.equal(cuerpo.codigoDisponible, true);
    assert.ok(cuerpo.codigoExpiraEn);

    const texto = JSON.stringify(cuerpo);
    assert.equal(texto.includes('321321'), false);
    assert.equal(texto.includes(huellaDelCodigo('321321')), false);
  });

  it('sin pedido abierto, la pantalla no ve nada y no se inventa un estado', async () => {
    const { estado, cuerpo } = await pedir('GET', `/guardias/${GUARDIA}/comprobacion/checkin`);
    assert.equal(estado, 200);
    assert.equal(cuerpo.estado, null);
    assert.equal(cuerpo.codigoDisponible, false);
  });

  it('el código que soltó la Prestadora marca la llegada, y a la Familia se le avisa', async () => {
    comprobacionGuardada = {
      id: COMPROBACION,
      estado: 'pendiente_de_codigo',
      momento: 'checkin',
      codigo_huella: huellaDelCodigo('321321'),
      codigo_expira_en: enUnRato(10),
      codigo_intentos: 0,
    };

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '321321' },
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.comprobacion, 'comprobada');

    const [fila] = comprobacionesGuardadas();
    assert.equal(fila.estado, 'comprobada');
    assert.equal(fila.medio, 'codigo_prestadora');
    assert.equal(fila.sujeto_tipo, null);
    // El código de un solo uso ya cumplió: no queda viva su huella.
    assert.equal(fila.codigo_huella, null);
    assert.equal(fila.codigo_expira_en, null);

    assert.equal(avisoDeCoberturaArmado(), true);
  });

  it('el código de la Prestadora vencido no sirve, y lo dice por su nombre', async () => {
    comprobacionGuardada = {
      id: COMPROBACION,
      estado: 'pendiente_de_codigo',
      momento: 'checkin',
      codigo_huella: huellaDelCodigo('321321'),
      codigo_expira_en: haceUnRato(1),
      codigo_intentos: 0,
    };

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '321321' },
    });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'codigo_vencido');
    assert.equal(guardiaMarcada(), false);
  });

  it('cada intento fallido se cuenta: seis dígitos sin tope se prueban de a uno', async () => {
    comprobacionGuardada = {
      id: COMPROBACION,
      estado: 'pendiente_de_codigo',
      momento: 'checkin',
      codigo_huella: huellaDelCodigo('321321'),
      codigo_expira_en: enUnRato(10),
      codigo_intentos: 2,
    };

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '111111' },
    });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'codigo_incorrecto');

    // El intento lo suma la base en un solo paso, no el motor leyendo y volviendo a escribir
    // (pendiente #177): así dos intentos a la vez cuentan dos y no uno.
    const [sumado] = intentosSumados();
    assert.equal(sumado.p_tabla, 'guardia_comprobaciones');
    assert.equal(sumado.p_id, COMPROBACION);
    assert.equal(comprobacionGuardada.codigo_intentos, 3);
    assert.equal(
      comprobacionesActualizadas().some((c) => 'codigo_intentos' in c),
      false,
      'el motor no escribe la cuenta a mano',
    );
  });

  it('agotados los intentos, ese código no se prueba más', async () => {
    comprobacionGuardada = {
      id: COMPROBACION,
      estado: 'pendiente_de_codigo',
      momento: 'checkin',
      codigo_huella: huellaDelCodigo('321321'),
      codigo_expira_en: enUnRato(10),
      codigo_intentos: 5,
    };

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '321321' },
    });
    assert.equal(estado, 429);
    assert.equal(cuerpo.motivo, 'demasiados_intentos');
    assert.equal(guardiaMarcada(), false);
  });

  // ------------------------------------------------------------------------------------------
  // El defecto del pendiente #177: el tope se contaba bien y se borraba solo.
  // ------------------------------------------------------------------------------------------
  it('pedir un código nuevo no devuelve intentos, y el piso sigue estando', async () => {
    comprobacionGuardada = {
      id: COMPROBACION,
      estado: 'pendiente_de_codigo',
      momento: 'checkin',
      codigo_huella: huellaDelCodigo('321321'),
      codigo_expira_en: enUnRato(10),
      codigo_intentos: 5,
    };

    // 1. Se agotaron los intentos con el código que había.
    const agotado = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '111111' },
    });
    assert.equal(agotado.estado, 429);
    assert.equal(agotado.cuerpo.motivo, 'demasiados_intentos');

    // 2. El Asistente vuelve a pedirle un código a la Prestadora. Antes, este solo pedido le
    //    devolvía cinco intentos más, y repitiéndolo se llegaba a los seis dígitos.
    const pedido = await pedir('POST', `/guardias/${GUARDIA}/comprobacion/pedido`, {
      momento: 'checkin',
      texto: 'Sigo sin poder entrar',
    });
    assert.equal(pedido.estado, 200);
    assert.ok(comprobacionGuardada.codigo_intentos >= 6, 'la cuenta no puede volver atrás');

    // 3. La Prestadora suelta un código nuevo. Se escriben acá exactamente las columnas que
    //    escribe el Panel; que en esa lista no esté la cuenta de intentos lo prueba
    //    `utils/__tests__/codigoDeUnSoloUso.test.js`.
    comprobacionGuardada.codigo_huella = huellaDelCodigo('987654');
    comprobacionGuardada.codigo_expira_en = enUnRato(10);

    // 4. Y el código nuevo, aun siendo el correcto, ya no sirve: el tope siguió siendo un tope.
    const conElNuevo = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '987654' },
    });
    assert.equal(conElNuevo.estado, 429);
    assert.equal(conElNuevo.cuerpo.motivo, 'demasiados_intentos');
    assert.equal(guardiaMarcada(), false);

    // 5. Lo que no puede pasar es que la guardia quede trabada. El piso sigue ahí.
    const conMotivo = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { motivoSinComprobar: 'prestadora_no_responde' },
    });
    assert.equal(conMotivo.estado, 200);
    assert.equal(conMotivo.cuerpo.comprobacion, 'sin_comprobar');
    assert.equal(guardiaMarcada(), true);
  });

  it('un código vencido no gasta intentos: quien pide otro porque se le venció no pierde nada', async () => {
    comprobacionGuardada = {
      id: COMPROBACION,
      estado: 'pendiente_de_codigo',
      momento: 'checkin',
      codigo_huella: huellaDelCodigo('321321'),
      codigo_expira_en: haceUnRato(1),
      codigo_intentos: 0,
    };

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '321321' },
    });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'codigo_vencido');
    // El vencimiento se mira antes de contar: por eso el tope pudo dejar de reiniciarse sin
    // castigar a quien no hizo nada malo.
    assert.equal(intentosSumados().length, 0);
    assert.equal(comprobacionGuardada.codigo_intentos, 0);
  });
});

// ============================================================================
// El tope de pedidos por minuto (pendiente #177)
// ============================================================================

describe('el tope de pedidos por minuto en la llegada y la salida', () => {
  it('frena la prueba de códigos de a uno, que es el camino que no lleva cuenta de intentos', async () => {
    // Se prueba contra el código que alguien muestra en la pantalla de su teléfono (Plan A), que
    // no tiene contador propio: lo único que puede frenar ahí es el tope por minuto. Si el tope
    // no estuviera, las once respuestas serían iguales y esta prueba fallaría.
    process.env.TOPE_PEDIDOS_POR_MINUTO = '3';
    codigosEnPantalla = [
      { sujeto_tipo: 'familia', sujeto_id: FAMILIA, codigo_huella: huellaDelCodigo('123456'), expira_en: enUnRato(1) },
    ];

    for (let vuelta = 1; vuelta <= 3; vuelta += 1) {
      const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
        lat: LAT,
        lng: LNG,
        comprobacion: { codigo: '000000' },
      });
      assert.equal(estado, 400, `el intento ${vuelta} tenía que llegar a probarse`);
      assert.equal(cuerpo.motivo, 'codigo_incorrecto');
    }

    const pasado = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '000000' },
    });
    assert.equal(pasado.estado, 429);
    assert.equal(pasado.cuerpo.motivo, 'demasiados_pedidos');
    assert.equal(guardiaMarcada(), false);

    // Y con el tope alcanzado el Asistente entra igual eligiendo un motivo: el piso no se cuenta.
    const conMotivo = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { motivoSinComprobar: 'nadie_para_mostrar' },
    });
    assert.equal(conMotivo.estado, 200);
    assert.equal(conMotivo.cuerpo.comprobacion, 'sin_comprobar');
  });

  it('también frena los pedidos de código a la Prestadora', async () => {
    process.env.TOPE_PEDIDOS_POR_MINUTO = '2';

    for (let vuelta = 1; vuelta <= 2; vuelta += 1) {
      const { estado } = await pedir('POST', `/guardias/${GUARDIA}/comprobacion/pedido`, {
        momento: 'checkin',
        texto: 'No atiende nadie',
      });
      assert.equal(estado, 200, `el pedido ${vuelta} tenía que pasar`);
    }

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/comprobacion/pedido`, {
      momento: 'checkin',
      texto: 'No atiende nadie',
    });
    assert.equal(estado, 429);
    assert.equal(cuerpo.motivo, 'demasiados_pedidos');
  });
});

// ============================================================================
// La salida: lo mismo, contra el acto que cierra la guardia
// ============================================================================

describe('check-out — la misma comprobación, contra el acto que cierra la guardia', () => {
  beforeEach(() => {
    // Para probar el check-out hace falta una guardia ya en curso, con el Reporte Diario de su
    // única Paciente ya cargado (default de arriba) y sin el protocolo de continuidad puesto.
    guardiaActual.checkin_at = '2026-09-09T11:00:00.000Z';
    guardiaActual.estado = 'activa';
  });

  it('se sale igual con un motivo, y la salida queda sin comprobar', async () => {
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkout`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { motivoSinComprobar: 'prestadora_no_responde' },
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.comprobacion, 'sin_comprobar');
    assert.equal(guardiaMarcada(), true);

    const [fila] = comprobacionesGuardadas();
    assert.equal(fila.momento, 'checkout');
    assert.equal(fila.estado, 'sin_comprobar');
    assert.equal(fila.motivo_sin_comprobar, 'prestadora_no_responde');
  });

  it('un pedido sin datos de comprobación cierra igual y queda sin comprobar por «otro»', async () => {
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkout`, { lat: LAT, lng: LNG });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);

    const [fila] = comprobacionesGuardadas();
    assert.equal(fila.momento, 'checkout');
    assert.equal(fila.estado, 'sin_comprobar');
    assert.equal(fila.motivo_sin_comprobar, 'otro');
  });

  it('el código que muestra la Familia cierra la guardia y queda anotado como comprobado', async () => {
    codigosEnPantalla = [
      { sujeto_tipo: 'familia', sujeto_id: FAMILIA, codigo_huella: huellaDelCodigo('123456'), expira_en: enUnRato(1) },
    ];

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkout`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '123456' },
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.comprobacion, 'comprobada');

    const [fila] = comprobacionesGuardadas();
    assert.equal(fila.momento, 'checkout');
    assert.equal(fila.medio, 'codigo_familia');
  });

  it('un código equivocado no cierra la guardia', async () => {
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkout`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '000000' },
    });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'codigo_incorrecto');
    assert.equal(guardiaMarcada(), false);
  });

  // Regresión: separar la comprobación del check-out no puede aflojar ninguna de las dos reglas
  // que ya existían para cerrar una guardia.
  it('sigue sin poder cerrarse sin el Reporte Diario, aunque el código sea correcto', async () => {
    respuestas.set('GET /rest/v1/reportes', () => []);
    codigosEnPantalla = [
      { sujeto_tipo: 'familia', sujeto_id: FAMILIA, codigo_huella: huellaDelCodigo('123456'), expira_en: enUnRato(1) },
    ];

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkout`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '123456' },
    });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'falta_reporte');
    assert.equal(guardiaMarcada(), false);
    assert.equal(comprobacionesGuardadas().length, 0);
  });

  it('el protocolo de continuidad de guardia sigue vigente, aunque el código sea correcto', async () => {
    guardiaActual.checkout_bloqueado = true;
    codigosEnPantalla = [
      { sujeto_tipo: 'familia', sujeto_id: FAMILIA, codigo_huella: huellaDelCodigo('123456'), expira_en: enUnRato(1) },
    ];

    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkout`, {
      lat: LAT,
      lng: LNG,
      comprobacion: { codigo: '123456' },
    });
    assert.equal(estado, 409);
    assert.equal(cuerpo.motivo, 'continuidad');
    assert.equal(guardiaMarcada(), false);
    assert.equal(comprobacionesGuardadas().length, 0);
  });
});
