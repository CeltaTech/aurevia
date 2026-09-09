/**
 * El pase de guardia por QR (pendiente #113) — el escaneo del cartel del domicilio, además del
 * GPS, al marcar check-in y check-out.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Lo que hay que garantizar no es que el endpoint conteste 200: es
 * que el escaneo **nunca traba la guardia** (cartel roto, sin cámara, sin permiso, todo eso se
 * marca igual) y que, aun así, **queda una constancia** de qué pasó — en guardia_escaneos y, en
 * los casos de excepción o de QR que no corresponde, en mensajes_asistente. Y que nada de esto
 * debilitó lo que ya existía: ni el bloqueo por Reporte Diario faltante, ni el protocolo de
 * continuidad de guardia.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USUARIO = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'; // usuarios.id === asistentes.id === auth.uid()
const GUARDIA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const PACIENTE = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const QR_DEL_PACIENTE = 'qr-del-domicilio-de-prueba';
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

/** La guardia contra la que se prueba, con los campos que lee `guardiaDelAsistente`. */
let guardiaActual;

function guardiaPacientesRespuesta() {
  // Siempre el mismo Paciente, con todos los campos que cualquiera de las dos consultas (la del
  // cálculo de distancia y la del cotejo de QR) pueda llegar a pedir. Un campo de más no rompe
  // nada: cada lado del motor lee solamente lo que le importa.
  return [{ guardia_id: GUARDIA, pacientes: { id: PACIENTE, nombre: 'Paciente de prueba', lat: LAT, lng: LNG, familia_id: null, qr_token: QR_DEL_PACIENTE } }];
}

function escaneosInsertados() {
  return llamadas.filter((l) => l.clave === 'POST /rest/v1/guardia_escaneos').map((l) => l.cuerpo);
}

function notasInsertadas() {
  return llamadas.filter((l) => l.clave === 'POST /rest/v1/mensajes_asistente').map((l) => l.cuerpo);
}

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
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
  respuestas.set('GET /rest/v1/configuracion_ausencia_automatica', () => []);
  respuestas.set('POST /rest/v1/rpc/domicilios_de_pacientes_en', () => []);
  respuestas.set('POST /rest/v1/guardia_escaneos', () => []);
  respuestas.set('POST /rest/v1/mensajes_asistente', () => []);
  // Por omisión, con el Reporte Diario ya cargado: así las pruebas de check-out que no hablan
  // de reportes no tropiezan con el guard de "falta_reporte", que se prueba aparte.
  respuestas.set('GET /rest/v1/reportes', () => [{ id: 'reporte-1', paciente_id: PACIENTE }]);
});

// El escaneo nunca traba la guardia, y eso incluye el caso en que el pedido llega sin datos de
// escaneo: un teléfono con la aplicación anterior todavía cargada, o un check-in que quedó en la
// cola sin conexión antes de que esta función existiera. Ese Asistente está parado en la puerta y
// tiene que poder marcar. Lo que NO puede pasar es que el acto quede anotado como si el escaneo
// hubiera salido bien: se guarda como excepción y el Coordinador recibe el aviso.
describe('check-in — un pedido sin datos de escaneo se anota como excepción, no se rechaza', () => {
  const sinDatosDeEscaneo = [
    ['sin decir si se pudo leer el QR', { lat: LAT, lng: LNG }],
    ['diciendo que leyó pero sin mandar el token', { lat: LAT, lng: LNG, qrLeido: true }],
    ['diciendo que no leyó pero sin motivo', { lat: LAT, lng: LNG, qrLeido: false }],
    [
      'con un motivo que no está en la lista',
      { lat: LAT, lng: LNG, qrLeido: false, qrExcepcionMotivo: 'se_lo_comio_el_perro' },
    ],
  ];

  for (const [caso, cuerpoDelPedido] of sinDatosDeEscaneo) {
    it(`${caso}, el check-in se marca igual y queda como excepción «otro»`, async () => {
      const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, cuerpoDelPedido);
      assert.equal(estado, 200);
      assert.equal(cuerpo.ok, true);
      assert.equal(llamadas.some((l) => l.clave === 'PATCH /rest/v1/guardias'), true);

      const [escaneo] = escaneosInsertados();
      assert.equal(escaneo.qr_leido, false);
      assert.equal(escaneo.excepcion_motivo, 'otro');
      assert.equal(escaneo.qr_token_leido, null);
      assert.equal(escaneo.qr_coincide, null);

      const [nota] = notasInsertadas();
      assert.ok(nota, 'tiene que haber quedado una nota para el Coordinador');
    });
  }
});

describe('check-in — el escaneo nunca traba la guardia', () => {
  it('el QR que coincide con el domicilio marca el check-in y no manda ningún aviso', async () => {
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      qrLeido: true,
      qrToken: QR_DEL_PACIENTE,
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.qrCoincide, true);

    assert.equal(llamadas.some((l) => l.clave === 'PATCH /rest/v1/guardias'), true);

    const [escaneo] = escaneosInsertados();
    assert.equal(escaneo.guardia_id, GUARDIA);
    assert.equal(escaneo.prestadora_id, PRESTADORA);
    assert.equal(escaneo.momento, 'checkin');
    assert.equal(escaneo.qr_leido, true);
    assert.equal(escaneo.qr_token_leido, QR_DEL_PACIENTE);
    assert.equal(escaneo.qr_coincide, true);
    assert.equal(escaneo.excepcion_motivo, null);

    assert.equal(notasInsertadas().length, 0);
  });

  it('el QR leído que no corresponde a este domicilio no bloquea, pero avisa', async () => {
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
      lat: LAT,
      lng: LNG,
      qrLeido: true,
      qrToken: 'un-cartel-de-otra-casa',
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.qrCoincide, false);

    const [escaneo] = escaneosInsertados();
    assert.equal(escaneo.qr_coincide, false);
    assert.equal(escaneo.qr_token_leido, 'un-cartel-de-otra-casa');

    const [nota] = notasInsertadas();
    assert.ok(nota, 'tiene que haber quedado una nota para el Coordinador');
    assert.equal(nota.asistente_id, USUARIO);
    assert.equal(nota.prestadora_id, PRESTADORA);
    assert.match(nota.mensaje, /no corresponde/);
  });

  for (const motivo of ['sin_camara', 'permiso_denegado', 'no_legible', 'otro']) {
    it(`no poder leer el cartel (${motivo}) no traba el check-in, y queda anotado`, async () => {
      const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkin`, {
        lat: LAT,
        lng: LNG,
        qrLeido: false,
        qrExcepcionMotivo: motivo,
      });
      assert.equal(estado, 200);
      assert.equal(cuerpo.ok, true);

      assert.equal(llamadas.some((l) => l.clave === 'PATCH /rest/v1/guardias'), true);

      const [escaneo] = escaneosInsertados();
      assert.equal(escaneo.qr_leido, false);
      assert.equal(escaneo.excepcion_motivo, motivo);
      assert.equal(escaneo.qr_token_leido, null);
      assert.equal(escaneo.qr_coincide, null);

      const [nota] = notasInsertadas();
      assert.ok(nota, 'tiene que haber quedado una nota para el Coordinador');
      assert.match(nota.mensaje, new RegExp(motivo));
    });
  }
});

describe('check-out — el mismo escaneo, contra el acto que cierra la guardia', () => {
  beforeEach(() => {
    // Para probar el check-out hace falta una guardia ya en curso, con el Reporte Diario de su
    // única Paciente ya cargado (default de arriba) y sin el protocolo de continuidad puesto.
    guardiaActual.checkin_at = '2026-09-09T11:00:00.000Z';
    guardiaActual.estado = 'activa';
  });

  it('sin decir si se pudo leer el QR, el check-out se hace igual y queda como excepción', async () => {
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkout`, { lat: LAT, lng: LNG });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(llamadas.some((l) => l.clave === 'PATCH /rest/v1/guardias'), true);

    const [escaneo] = escaneosInsertados();
    assert.equal(escaneo.momento, 'checkout');
    assert.equal(escaneo.qr_leido, false);
    assert.equal(escaneo.excepcion_motivo, 'otro');
  });

  it('el QR que coincide cierra la guardia y no manda ningún aviso', async () => {
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkout`, {
      lat: LAT,
      lng: LNG,
      qrLeido: true,
      qrToken: QR_DEL_PACIENTE,
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(cuerpo.qrCoincide, true);

    const [escaneo] = escaneosInsertados();
    assert.equal(escaneo.momento, 'checkout');
    assert.equal(escaneo.qr_coincide, true);
    assert.equal(notasInsertadas().length, 0);
  });

  it('el QR leído que no corresponde a este domicilio no bloquea el cierre, pero avisa', async () => {
    const { estado } = await pedir('POST', `/guardias/${GUARDIA}/checkout`, {
      lat: LAT,
      lng: LNG,
      qrLeido: true,
      qrToken: 'un-cartel-de-otra-casa',
    });
    assert.equal(estado, 200);

    const [escaneo] = escaneosInsertados();
    assert.equal(escaneo.momento, 'checkout');
    assert.equal(escaneo.qr_coincide, false);
    assert.equal(notasInsertadas().length, 1);
  });

  it('no poder leer el cartel no traba el cierre, y queda anotado como excepción', async () => {
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkout`, {
      lat: LAT,
      lng: LNG,
      qrLeido: false,
      qrExcepcionMotivo: 'no_legible',
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);

    const [escaneo] = escaneosInsertados();
    assert.equal(escaneo.momento, 'checkout');
    assert.equal(escaneo.qr_leido, false);
    assert.equal(escaneo.excepcion_motivo, 'no_legible');
    assert.equal(notasInsertadas().length, 1);
  });

  // Regresión: separar el escaneo del check-out no puede aflojar ninguna de las dos reglas que
  // ya existían para cerrar una guardia.
  it('sigue sin poder cerrarse sin el Reporte Diario, aunque el QR se haya leído bien', async () => {
    respuestas.set('GET /rest/v1/reportes', () => []);
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkout`, {
      lat: LAT,
      lng: LNG,
      qrLeido: true,
      qrToken: QR_DEL_PACIENTE,
    });
    assert.equal(estado, 400);
    assert.equal(cuerpo.motivo, 'falta_reporte');
    assert.equal(llamadas.some((l) => l.clave === 'PATCH /rest/v1/guardias'), false);
    assert.equal(escaneosInsertados().length, 0);
  });

  it('el protocolo de continuidad de guardia sigue vigente, aunque el QR se haya leído bien', async () => {
    guardiaActual.checkout_bloqueado = true;
    const { estado, cuerpo } = await pedir('POST', `/guardias/${GUARDIA}/checkout`, {
      lat: LAT,
      lng: LNG,
      qrLeido: true,
      qrToken: QR_DEL_PACIENTE,
    });
    assert.equal(estado, 409);
    assert.equal(cuerpo.motivo, 'continuidad');
    assert.equal(llamadas.some((l) => l.clave === 'PATCH /rest/v1/guardias'), false);
    assert.equal(escaneosInsertados().length, 0);
  });
});
