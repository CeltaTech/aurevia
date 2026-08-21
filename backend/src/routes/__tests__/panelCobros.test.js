/**
 * Pruebas de los cobros de la Familia y del saldo que sale de restarlos.
 *
 * Usan el banco de pruebas que ya trae Node adentro (`node --test`), sin instalar nada, igual
 * que el resto de las pruebas del motor:
 *
 *   npm test --prefix backend
 *
 * Dos clases de prueba conviven acá. Las comprobaciones sueltas —qué monto se admite, qué
 * medio, cómo se lee un período— se prueban llamando a las funciones directamente. Todo lo
 * demás, que no es una cuenta sino una conversación con la base, se prueba levantando el motor
 * de verdad contra una base de mentira que contesta lo que cada prueba le prepara. Así lo que
 * se comprueba es el camino entero —permiso, filtros, escritura— y no una imitación.
 *
 * Y hay una prueba que mira otra cosa: que TODA consulta lleve el filtro de Prestadora escrito.
 * El motor entra a la base con la clave de servicio, o sea sin las reglas de acceso: si una
 * consulta se olvida ese filtro, una Prestadora ve la plata de otra y nada la detiene.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

// ---------------------------------------------------------------------------------------
// La base de mentira
// ---------------------------------------------------------------------------------------

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const USUARIO = '22222222-2222-2222-2222-222222222222';
const FACTURA = '33333333-3333-3333-3333-333333333333';
const FAMILIA = '44444444-4444-4444-4444-444444444444';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, con la dirección entera: los filtros van ahí. */
let llamadas = [];

let rolDelUsuario = 'admin_prestadora';

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    llamadas.push({ clave, url: req.url, cuerpo: crudo ? JSON.parse(crudo) : null });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada(crudo ? JSON.parse(crudo) : null) : preparada;
    if (valor === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `la prueba no preparó respuesta para ${clave}` }));
      return;
    }

    // Una prueba puede pedir que la base conteste un error, que es como se imita el choque
    // contra el índice único de la referencia externa.
    if (valor && valor.__estado) {
      res.writeHead(valor.__estado, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(valor.__cuerpo));
      return;
    }

    // `.single()` pide una fila sola con este encabezado; `.maybeSingle()` sobre una lectura
    // pide la lista y la achica del lado del motor. Se imita eso y nada más.
    const unoSolo = (req.headers.accept || '').includes('vnd.pgrst.object+json');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(unoSolo && Array.isArray(valor) ? valor[0] ?? null : valor));
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

// El import va después de dejar puestas las variables de entorno: la conexión a la base se
// arma en el momento en que se importa, y con la dirección que haya en ese instante.
const { default: express } = await import('express');
await import('express-async-errors');
const {
  panelCobrosRouter,
  aDosDecimales,
  loQueEstaMalEnElCobro,
  primerDiaDelPeriodo,
  MEDIOS,
  ORIGENES_DE_AFUERA,
  TOPE_DEL_LOTE,
} = await import('../panelCobros.js');

const app = express();
app.use(express.json());
app.use('/api/panel/cobros', panelCobrosRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/panel/cobros`;

after(() => {
  motor.close();
  baseFalsa.close();
});

async function pedir(metodo, ruta, cuerpo) {
  const respuesta = await fetch(`${DIRECCION}${ruta}`, {
    method: metodo,
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

const FACTURA_EN_LA_BASE = {
  id: FACTURA,
  familia_id: FAMILIA,
  periodo: '2026-08-01',
  monto_total: '100000.00',
  moneda: 'ARS',
  estado: 'pendiente',
  fecha_emision: '2026-08-01',
  fecha_vencimiento: '2026-08-31',
};

function saldoConCobrado(cobrado, estado = 'pendiente', origenes = ['panel']) {
  return {
    factura_id: FACTURA,
    prestadora_id: PRESTADORA,
    familia_id: FAMILIA,
    periodo: '2026-08-01',
    moneda: 'ARS',
    monto_total: '100000.00',
    cobrado: String(cobrado.toFixed(2)),
    saldo: String((100000 - cobrado).toFixed(2)),
    estado,
    estado_guardado: estado,
    fecha_emision: '2026-08-01',
    fecha_vencimiento: '2026-08-31',
    cobros_contados: cobrado > 0 ? 1 : 0,
    ultimo_cobro_fecha: cobrado > 0 ? '2026-08-10' : null,
    origenes: cobrado > 0 ? origenes : [],
    actualizado_en: '2026-08-10T12:00:00Z',
  };
}

beforeEach(() => {
  llamadas = [];
  rolDelUsuario = 'admin_prestadora';
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: rolDelUsuario, prestadora_id: PRESTADORA }]);
  respuestas.set('POST /rest/v1/rpc/tiene_permiso_de', () => true);
});

/** Todas las consultas a la base que llevaron —o no— el filtro de Prestadora escrito. */
function consultasDeDatos() {
  return llamadas.filter(
    (l) => l.clave.startsWith('GET /rest/v1/') && !l.clave.endsWith('/usuarios')
  );
}

// ---------------------------------------------------------------------------------------
// Lo que se comprueba antes de tocar la base
// ---------------------------------------------------------------------------------------

describe('qué cobro se admite', () => {
  it('un monto de cero o negativo no es un cobro', () => {
    assert.ok(loQueEstaMalEnElCobro({ monto: 0, medio: 'efectivo' }));
    assert.ok(loQueEstaMalEnElCobro({ monto: -500, medio: 'efectivo' }));
  });

  it('un medio que no está en la lista se rechaza antes de llegar a la base', () => {
    assert.ok(loQueEstaMalEnElCobro({ monto: 100, medio: 'trueque' }));
    for (const medio of MEDIOS) {
      assert.equal(loQueEstaMalEnElCobro({ monto: 100, medio }), null);
    }
  });

  it('una fecha que no es una fecha se rechaza', () => {
    assert.ok(loQueEstaMalEnElCobro({ monto: 100, medio: 'efectivo', fecha_cobro: '10/08/2026' }));
    assert.equal(loQueEstaMalEnElCobro({ monto: 100, medio: 'efectivo', fecha_cobro: '2026-08-10' }), null);
  });

  it('sin fecha también se admite: la de hoy es la que corresponde a un cobro que entra ahora', () => {
    assert.equal(loQueEstaMalEnElCobro({ monto: 100, medio: 'efectivo' }), null);
  });
});

describe('el período', () => {
  it('se lee como el primer día del mes', () => {
    assert.equal(primerDiaDelPeriodo('2026-08'), '2026-08-01');
  });

  it('un mes que no existe no se lee', () => {
    assert.equal(primerDiaDelPeriodo('2026-13'), null);
    assert.equal(primerDiaDelPeriodo('2026-00'), null);
    assert.equal(primerDiaDelPeriodo('agosto'), null);
    assert.equal(primerDiaDelPeriodo(undefined), null);
  });
});

describe('los centavos', () => {
  it('un importe se guarda con dos decimales y no con los que traiga', () => {
    assert.equal(aDosDecimales(1000.005), 1000.01);
    assert.equal(aDosDecimales('2500.4567'), 2500.46);
  });
});

// ---------------------------------------------------------------------------------------
// Los saldos
// ---------------------------------------------------------------------------------------

describe('la lista de saldos', () => {
  it('sin período no se contesta: un saldo siempre es de un mes', async () => {
    const { estado } = await pedir('GET', '/saldos');
    assert.equal(estado, 400);
  });

  it('trae la resta ya hecha, y de qué orígenes salió', async () => {
    respuestas.set('GET /rest/v1/saldos_familia', () => [saldoConCobrado(40000, 'pendiente', ['api'])]);
    respuestas.set('GET /rest/v1/familias', () => [{ id: FAMILIA, solicitudes: { nombre: 'Familia de prueba' } }]);

    const { estado, cuerpo } = await pedir('GET', '/saldos?periodo=2026-08');
    assert.equal(estado, 200);
    assert.equal(cuerpo.length, 1);
    assert.equal(cuerpo[0].saldo, '60000.00');
    assert.deepEqual(cuerpo[0].origenes, ['api']);
    assert.equal(cuerpo[0].familia_nombre, 'Familia de prueba');
    assert.ok(cuerpo[0].actualizado_en);
  });

  it('toda consulta lleva el filtro de Prestadora escrito', async () => {
    respuestas.set('GET /rest/v1/saldos_familia', () => [saldoConCobrado(40000)]);
    respuestas.set('GET /rest/v1/familias', () => [{ id: FAMILIA, solicitudes: { nombre: 'Familia de prueba' } }]);

    await pedir('GET', '/saldos?periodo=2026-08');

    const consultas = consultasDeDatos();
    assert.ok(consultas.length >= 2);
    for (const consulta of consultas) {
      assert.ok(
        consulta.url.includes(`prestadora_id=eq.${PRESTADORA}`),
        `esta consulta no filtró por Prestadora: ${consulta.url}`
      );
    }
  });

  it('quien no es del Panel no entra', async () => {
    rolDelUsuario = 'familia';
    const { estado } = await pedir('GET', '/saldos?periodo=2026-08');
    assert.equal(estado, 403);
  });
});

describe('el detalle de una factura', () => {
  it('la factura de otra Prestadora no existe para esta', async () => {
    respuestas.set('GET /rest/v1/saldos_familia', () => []);
    const { estado } = await pedir('GET', `/facturas/${FACTURA}`);
    assert.equal(estado, 404);
  });

  it('trae los cobros, incluidos los anulados: anular no es borrar', async () => {
    respuestas.set('GET /rest/v1/saldos_familia', () => [saldoConCobrado(40000)]);
    respuestas.set('GET /rest/v1/familias', () => [{ id: FAMILIA, solicitudes: { nombre: 'Familia de prueba' } }]);
    respuestas.set('GET /rest/v1/cobros_familia', () => [
      { id: 'c-1', monto: '40000.00', estado: 'registrado', origen: 'panel' },
      { id: 'c-2', monto: '10000.00', estado: 'anulado', origen: 'panel', motivo_anulacion: 'cargado dos veces' },
    ]);

    const { estado, cuerpo } = await pedir('GET', `/facturas/${FACTURA}`);
    assert.equal(estado, 200);
    assert.equal(cuerpo.cobros.length, 2);
    assert.equal(cuerpo.cobros[1].estado, 'anulado');
    assert.equal(cuerpo.saldo, '60000.00');
  });
});

// ---------------------------------------------------------------------------------------
// Anotar un cobro
// ---------------------------------------------------------------------------------------

describe('anotar un cobro desde el Panel', () => {
  it('un cobro parcial se anota y el saldo queda con lo que falta', async () => {
    respuestas.set('GET /rest/v1/facturas_familia', () => [FACTURA_EN_LA_BASE]);
    respuestas.set('POST /rest/v1/cobros_familia', (cuerpo) => [{ id: 'c-1', ...cuerpo }]);
    respuestas.set('GET /rest/v1/saldos_familia', () => [saldoConCobrado(40000)]);

    const { estado, cuerpo } = await pedir('POST', `/facturas/${FACTURA}/cobros`, {
      monto: 40000,
      medio: 'transferencia',
      fecha_cobro: '2026-08-10',
    });

    assert.equal(estado, 200);
    assert.equal(cuerpo.saldo.saldo, '60000.00');
    assert.equal(cuerpo.saldo.estado, 'pendiente');
  });

  it('el cobro anotado acá dice que salió de acá, y quién lo cargó', async () => {
    respuestas.set('GET /rest/v1/facturas_familia', () => [FACTURA_EN_LA_BASE]);
    respuestas.set('POST /rest/v1/cobros_familia', (cuerpo) => [{ id: 'c-1', ...cuerpo }]);
    respuestas.set('GET /rest/v1/saldos_familia', () => [saldoConCobrado(40000)]);

    await pedir('POST', `/facturas/${FACTURA}/cobros`, { monto: 40000, medio: 'efectivo' });

    const insercion = llamadas.find((l) => l.clave === 'POST /rest/v1/cobros_familia');
    assert.equal(insercion.cuerpo.origen, 'panel');
    assert.equal(insercion.cuerpo.registrado_por, USUARIO);
    assert.equal(insercion.cuerpo.prestadora_id, PRESTADORA);
    // La moneda no se manda: la copia de la factura un disparador de la base (regla 14).
    assert.equal(insercion.cuerpo.moneda, undefined);
  });

  it('no se anota plata contra una factura que no es de esta Prestadora', async () => {
    respuestas.set('GET /rest/v1/facturas_familia', () => []);
    const { estado } = await pedir('POST', `/facturas/${FACTURA}/cobros`, { monto: 1000, medio: 'efectivo' });
    assert.equal(estado, 404);
    assert.equal(llamadas.some((l) => l.clave === 'POST /rest/v1/cobros_familia'), false);
  });

  it('un monto que no es plata no llega a la base', async () => {
    const { estado } = await pedir('POST', `/facturas/${FACTURA}/cobros`, { monto: 0, medio: 'efectivo' });
    assert.equal(estado, 400);
    assert.equal(llamadas.some((l) => l.clave.startsWith('POST /rest/v1/cobros_familia')), false);
  });

  it('la Coordinadora también puede anotar un cobro, igual que en la base', async () => {
    rolDelUsuario = 'coordinador';
    respuestas.set('GET /rest/v1/facturas_familia', () => [FACTURA_EN_LA_BASE]);
    respuestas.set('POST /rest/v1/cobros_familia', (cuerpo) => [{ id: 'c-1', ...cuerpo }]);
    respuestas.set('GET /rest/v1/saldos_familia', () => [saldoConCobrado(40000)]);

    const { estado } = await pedir('POST', `/facturas/${FACTURA}/cobros`, { monto: 40000, medio: 'efectivo' });
    assert.equal(estado, 200);
  });
});

// ---------------------------------------------------------------------------------------
// Anular
// ---------------------------------------------------------------------------------------

describe('anular un cobro', () => {
  it('sin motivo no se anula: una plata que se da de baja tiene que decir por qué', async () => {
    const { estado } = await pedir('POST', '/cobros/c-1/anular', {});
    assert.equal(estado, 400);
  });

  it('el cobro no se borra: queda con quién lo anuló y cuándo', async () => {
    respuestas.set('GET /rest/v1/cobros_familia', () => [{ id: 'c-1', factura_id: FACTURA, estado: 'registrado' }]);
    respuestas.set('PATCH /rest/v1/cobros_familia', (cuerpo) => [{ id: 'c-1', ...cuerpo }]);
    respuestas.set('GET /rest/v1/saldos_familia', () => [saldoConCobrado(0)]);

    const { estado, cuerpo } = await pedir('POST', '/cobros/c-1/anular', { motivo: 'cargado dos veces' });
    assert.equal(estado, 200);
    assert.equal(cuerpo.cobro.estado, 'anulado');
    assert.equal(cuerpo.cobro.anulado_por, USUARIO);
    assert.ok(cuerpo.cobro.anulado_at);
    assert.equal(cuerpo.cobro.motivo_anulacion, 'cargado dos veces');
    assert.equal(llamadas.some((l) => l.clave.startsWith('DELETE ')), false);
  });

  it('un cobro ya anulado no se anula dos veces', async () => {
    respuestas.set('GET /rest/v1/cobros_familia', () => [{ id: 'c-1', factura_id: FACTURA, estado: 'anulado' }]);
    const { estado } = await pedir('POST', '/cobros/c-1/anular', { motivo: 'otra vez' });
    assert.equal(estado, 400);
  });

  it('el cobro de otra Prestadora no existe para esta', async () => {
    respuestas.set('GET /rest/v1/cobros_familia', () => []);
    const { estado } = await pedir('POST', '/cobros/c-1/anular', { motivo: 'no es mío' });
    assert.equal(estado, 404);
  });
});

// ---------------------------------------------------------------------------------------
// La puerta de entrada
// ---------------------------------------------------------------------------------------

describe('la puerta de entrada para lo que viene de afuera', () => {
  it('el lote dice de dónde viene, y no admite orígenes inventados', async () => {
    const { estado } = await pedir('POST', '/entrada', { origen: 'telepatia', cobros: [] });
    assert.equal(estado, 400);
    for (const origen of ORIGENES_DE_AFUERA) {
      assert.ok(['importacion', 'api', 'pasarela'].includes(origen));
    }
  });

  it('una migración no puede entrar por acá: eso lo escribe una migración y nadie más', async () => {
    const { estado } = await pedir('POST', '/entrada', { origen: 'migracion', cobros: [{ monto: 1, medio: 'otro' }] });
    assert.equal(estado, 400);
  });

  it('un lote vacío no es un lote', async () => {
    const { estado } = await pedir('POST', '/entrada', { origen: 'api', cobros: [] });
    assert.equal(estado, 400);
  });

  it('un lote más grande que el tope se rechaza entero, para poder reintentarlo por partes', async () => {
    const cobros = Array.from({ length: TOPE_DEL_LOTE + 1 }, () => ({ monto: 1, medio: 'otro', factura_id: FACTURA }));
    const { estado } = await pedir('POST', '/entrada', { origen: 'api', cobros });
    assert.equal(estado, 400);
  });

  it('el mismo envío dos veces no suma plata dos veces', async () => {
    // Lo que ya estaba: un cobro con esa misma referencia.
    respuestas.set('GET /rest/v1/cobros_familia', () => [
      { id: 'c-1', referencia_externa: 'REC-001', factura_id: FACTURA },
    ]);
    respuestas.set('GET /rest/v1/saldos_familia', () => []);

    const { estado, cuerpo } = await pedir('POST', '/entrada', {
      origen: 'api',
      cobros: [{ factura_id: FACTURA, monto: 40000, medio: 'transferencia', referencia_externa: 'REC-001' }],
    });

    assert.equal(estado, 200);
    assert.equal(cuerpo.duplicados, 1);
    assert.equal(cuerpo.registrados, 0);
    assert.equal(cuerpo.resultados[0].resultado, 'duplicado');
    assert.equal(cuerpo.resultados[0].cobro_id, 'c-1');
    assert.equal(llamadas.some((l) => l.clave === 'POST /rest/v1/cobros_familia'), false);
  });

  it('la misma referencia repetida dentro del mismo lote entra una sola vez', async () => {
    respuestas.set('GET /rest/v1/cobros_familia', () => []);
    respuestas.set('GET /rest/v1/facturas_familia', () => [FACTURA_EN_LA_BASE]);
    respuestas.set('POST /rest/v1/cobros_familia', () => [{ id: 'c-9', factura_id: FACTURA }]);
    respuestas.set('GET /rest/v1/saldos_familia', () => [saldoConCobrado(40000)]);

    const cobro = { factura_id: FACTURA, monto: 40000, medio: 'transferencia', referencia_externa: 'REC-002' };
    const { cuerpo } = await pedir('POST', '/entrada', { origen: 'api', cobros: [cobro, cobro] });

    assert.equal(cuerpo.registrados, 1);
    assert.equal(cuerpo.duplicados, 1);
    assert.equal(llamadas.filter((l) => l.clave === 'POST /rest/v1/cobros_familia').length, 1);
  });

  it('si dos envíos llegan a la vez, el que choca contra el índice también es un duplicado', async () => {
    respuestas.set('GET /rest/v1/cobros_familia', () => []);
    respuestas.set('GET /rest/v1/facturas_familia', () => [FACTURA_EN_LA_BASE]);
    respuestas.set('POST /rest/v1/cobros_familia', () => ({
      __estado: 409,
      __cuerpo: { code: '23505', message: 'duplicate key value violates unique constraint' },
    }));
    respuestas.set('GET /rest/v1/saldos_familia', () => []);

    const { cuerpo } = await pedir('POST', '/entrada', {
      origen: 'pasarela',
      cobros: [{ factura_id: FACTURA, monto: 40000, medio: 'tarjeta', referencia_externa: 'PAY-1' }],
    });

    assert.equal(cuerpo.duplicados, 1);
    assert.equal(cuerpo.registrados, 0);
  });

  it('un renglón malo no tira abajo el lote entero', async () => {
    respuestas.set('GET /rest/v1/cobros_familia', () => []);
    respuestas.set('GET /rest/v1/facturas_familia', () => [FACTURA_EN_LA_BASE]);
    respuestas.set('POST /rest/v1/cobros_familia', () => [{ id: 'c-3', factura_id: FACTURA }]);
    respuestas.set('GET /rest/v1/saldos_familia', () => [saldoConCobrado(40000, 'pendiente', ['api'])]);

    const { cuerpo } = await pedir('POST', '/entrada', {
      origen: 'api',
      cobros: [
        { factura_id: FACTURA, monto: 40000, medio: 'transferencia', referencia_externa: 'A' },
        { factura_id: FACTURA, monto: -5, medio: 'transferencia', referencia_externa: 'B' },
        { monto: 100, medio: 'transferencia', referencia_externa: 'C' },
      ],
    });

    assert.equal(cuerpo.registrados, 1);
    assert.equal(cuerpo.rechazados, 2);
    assert.equal(cuerpo.resultados[1].resultado, 'rechazado');
    assert.ok(cuerpo.resultados[1].motivo);
    assert.equal(cuerpo.resultados[2].resultado, 'rechazado');
  });

  it('la factura se puede nombrar por Familia y período, para el sistema que no conoce nuestros identificadores', async () => {
    respuestas.set('GET /rest/v1/cobros_familia', () => []);
    respuestas.set('GET /rest/v1/facturas_familia', () => [FACTURA_EN_LA_BASE]);
    respuestas.set('POST /rest/v1/cobros_familia', () => [{ id: 'c-4', factura_id: FACTURA }]);
    respuestas.set('GET /rest/v1/saldos_familia', () => [saldoConCobrado(100000, 'pagada', ['api'])]);

    const { cuerpo } = await pedir('POST', '/entrada', {
      origen: 'importacion',
      cobros: [{ familia_id: FAMILIA, periodo: '2026-08', monto: 100000, medio: 'transferencia' }],
    });

    assert.equal(cuerpo.registrados, 1);
    assert.equal(cuerpo.saldos[0].estado, 'pagada');
    assert.equal(cuerpo.saldos[0].saldo, '0.00');
  });

  it('lo que entra por afuera no tiene una persona detrás, y no se le inventa una', async () => {
    respuestas.set('GET /rest/v1/cobros_familia', () => []);
    respuestas.set('GET /rest/v1/facturas_familia', () => [FACTURA_EN_LA_BASE]);
    respuestas.set('POST /rest/v1/cobros_familia', () => [{ id: 'c-5', factura_id: FACTURA }]);
    respuestas.set('GET /rest/v1/saldos_familia', () => [saldoConCobrado(40000)]);

    await pedir('POST', '/entrada', {
      origen: 'api',
      cobros: [{ factura_id: FACTURA, monto: 40000, medio: 'transferencia', referencia_externa: 'X-1' }],
    });

    const insercion = llamadas.find((l) => l.clave === 'POST /rest/v1/cobros_familia');
    assert.equal(insercion.cuerpo.registrado_por, null);
    assert.equal(insercion.cuerpo.origen, 'api');
    assert.equal(insercion.cuerpo.referencia_externa, 'X-1');
  });

  it('toda consulta del lote lleva el filtro de Prestadora escrito', async () => {
    respuestas.set('GET /rest/v1/cobros_familia', () => []);
    respuestas.set('GET /rest/v1/facturas_familia', () => [FACTURA_EN_LA_BASE]);
    respuestas.set('POST /rest/v1/cobros_familia', () => [{ id: 'c-6', factura_id: FACTURA }]);
    respuestas.set('GET /rest/v1/saldos_familia', () => [saldoConCobrado(40000)]);

    await pedir('POST', '/entrada', {
      origen: 'api',
      cobros: [{ familia_id: FAMILIA, periodo: '2026-08', monto: 40000, medio: 'transferencia', referencia_externa: 'Y-1' }],
    });

    const consultas = consultasDeDatos();
    assert.ok(consultas.length >= 3);
    for (const consulta of consultas) {
      assert.ok(
        consulta.url.includes(`prestadora_id=eq.${PRESTADORA}`),
        `esta consulta no filtró por Prestadora: ${consulta.url}`
      );
    }
    const insercion = llamadas.find((l) => l.clave === 'POST /rest/v1/cobros_familia');
    assert.equal(insercion.cuerpo.prestadora_id, PRESTADORA);
  });

  it('quien no es del Panel no entra tampoco por acá', async () => {
    rolDelUsuario = 'asistente';
    const { estado } = await pedir('POST', '/entrada', {
      origen: 'api',
      cobros: [{ factura_id: FACTURA, monto: 1, medio: 'otro' }],
    });
    assert.equal(estado, 403);
  });
});
