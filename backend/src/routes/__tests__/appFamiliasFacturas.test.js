/**
 * La ventanilla de la factura: qué ve la Familia de lo que se le cobra.
 *
 *   npm test --prefix backend
 *
 * ACÁ SE PRUEBA UNA PANTALLA QUE MUESTRA PLATA DE OTROS, así que los casos están escritos por el
 * error que evitan, y son cuatro:
 *
 *   1. QUE UNA FAMILIA VEA LA FACTURA DE OTRA. El motor entra a la base con la llave de servicio
 *      y se saltea la protección por fila, así que lo único que separa a una Familia de otra son
 *      los filtros escritos en cada consulta. Si falta uno, no falla nada: contesta de más.
 *   2. QUE EL TOTAL LLEGUE SIN DECIR DE QUÉ ES. Un importe sin desglose no se puede comprobar ni
 *      discutir, y quien paga tiene que poder hacer las dos cosas.
 *   3. QUE UN COBRO ANULADO DESAPAREZCA. Anular no es borrar: un pago que se anotó y después se
 *      dio de baja, sacado de la pantalla, es indistinguible de uno que nunca existió.
 *   4. QUE SE ENTRE POR UNA PUERTA QUE NO ES LA DE SIEMPRE. Las dos que ya existen son el
 *      interruptor de la Prestadora y el acceso que el titular reparte, y esto no agrega ninguna.
 *
 * Los datos son inventados.
 */
import { strict as assert } from 'node:assert';
import { beforeEach, describe, it, after } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USUARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const FAMILIA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FACTURA = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PACIENTE = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

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
    llamadas.push({ clave, url: req.url });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada({ url: req.url }) : preparada;
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
const { appFamiliasRouter } = await import('../appFamilias.js');

const app = express();
app.use(express.json());
app.use('/api/app-familias', appFamiliasRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/app-familias`;

after(() => {
  motor.close();
  baseFalsa.close();
});

async function pedir(ruta) {
  const respuesta = await fetch(`${DIRECCION}${ruta}`, {
    headers: { Authorization: 'Bearer token-de-mentira' },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/**
 * La sesión de alguien del círculo familiar: quién es, qué muestra la Prestadora y qué le dieron.
 *
 * Se prepara como titular por defecto —que ve todo— y cada prueba cambia lo suyo.
 */
function sesionDeLaFamilia({ visibilidad = null, accesos = null, titular = true } = {}) {
  respuestas.set('GET /auth/v1/user', { id: USUARIO });
  respuestas.set('GET /rest/v1/usuarios', [{ rol: 'familia', prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/familias', titular ? [{ id: FAMILIA }] : []);
  respuestas.set('GET /rest/v1/miembros_familia', titular ? [] : [{ familia_id: FAMILIA }]);
  respuestas.set('GET /rest/v1/configuracion_visibilidad_app', visibilidad ?? []);
  respuestas.set('GET /rest/v1/permisos_circulo_familiar', accesos ?? []);
}

const SALDO = {
  factura_id: FACTURA,
  periodo: '2026-08-01',
  moneda: 'ARS',
  monto_total: '25000.00',
  cobrado: '10000.00',
  saldo: '15000.00',
  estado: 'pendiente',
  fecha_emision: '2026-08-31',
  fecha_vencimiento: '2026-09-10',
};

beforeEach(() => {
  respuestas.clear();
  llamadas = [];
  sesionDeLaFamilia();
});

/** Todas las direcciones con las que se consultó esa tabla en este pedido. */
function consultasA(tabla) {
  return llamadas.filter((l) => l.clave === `GET /rest/v1/${tabla}`).map((l) => l.url);
}

describe('la lista de facturas de la Familia', () => {
  it('devuelve lo facturado, lo cobrado y lo que falta, del más nuevo al más viejo', async () => {
    respuestas.set('GET /rest/v1/saldos_familia', [SALDO]);

    const { estado, cuerpo } = await pedir('/facturas');
    assert.equal(estado, 200);
    assert.equal(cuerpo.facturas.length, 1);
    assert.equal(cuerpo.facturas[0].saldo, '15000.00');

    const [url] = consultasA('saldos_familia');
    assert.ok(url.includes('order=periodo.desc'), url);
  });

  it('y la consulta lleva el filtro de Familia y el de Prestadora', async () => {
    respuestas.set('GET /rest/v1/saldos_familia', []);
    await pedir('/facturas');

    const [url] = consultasA('saldos_familia');
    assert.ok(url.includes(`familia_id=eq.${FAMILIA}`), url);
    assert.ok(url.includes(`prestadora_id=eq.${PRESTADORA}`), url);
  });

  it('sin facturas contesta una lista vacía, no un error', async () => {
    respuestas.set('GET /rest/v1/saldos_familia', []);
    const { estado, cuerpo } = await pedir('/facturas');
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo.facturas, []);
  });
});

describe('el desglose de una factura', () => {
  it('viene con un renglón por lo que se cobró, diciendo de qué es', async () => {
    respuestas.set('GET /rest/v1/saldos_familia', [SALDO]);
    respuestas.set('GET /rest/v1/facturas_familia_items', [
      { id: 1, descripcion: 'Acompañamiento — Juana Pérez', monto: '15000.00', moneda: 'ARS', paciente_id: PACIENTE, servicio_id: null },
      { id: 2, descripcion: 'Enfermería — Juana Pérez', monto: '10000.00', moneda: 'ARS', paciente_id: PACIENTE, servicio_id: null },
    ]);
    respuestas.set('GET /rest/v1/cobros_familia', []);

    const { estado, cuerpo } = await pedir(`/facturas/${FACTURA}`);
    assert.equal(estado, 200);
    assert.equal(cuerpo.renglones.length, 2);
    assert.equal(cuerpo.renglones[0].descripcion, 'Acompañamiento — Juana Pérez');
    assert.equal(cuerpo.factura.monto_total, '25000.00');
  });

  it('el cobro anulado llega igual, marcado, y no desaparece de la pantalla', async () => {
    respuestas.set('GET /rest/v1/saldos_familia', [SALDO]);
    respuestas.set('GET /rest/v1/facturas_familia_items', []);
    respuestas.set('GET /rest/v1/cobros_familia', [
      { id: 1, monto: '10000.00', moneda: 'ARS', fecha_cobro: '2026-09-02', medio: 'transferencia', estado: 'registrado' },
      { id: 2, monto: '5000.00', moneda: 'ARS', fecha_cobro: '2026-09-01', medio: 'efectivo', estado: 'anulado' },
    ]);

    const { cuerpo } = await pedir(`/facturas/${FACTURA}`);
    assert.equal(cuerpo.cobros.length, 2);
    assert.equal(cuerpo.cobros[1].estado, 'anulado');
  });

  it('el motivo de la anulación no viaja: es una nota interna de la Prestadora', async () => {
    respuestas.set('GET /rest/v1/saldos_familia', [SALDO]);
    respuestas.set('GET /rest/v1/facturas_familia_items', []);
    respuestas.set('GET /rest/v1/cobros_familia', []);
    await pedir(`/facturas/${FACTURA}`);

    const [url] = consultasA('cobros_familia');
    const select = new URL(url, 'http://interno').searchParams.get('select');
    assert.ok(!select.includes('motivo_anulacion'), select);
    assert.ok(!select.includes('observaciones'), select);
  });

  it('la factura de otra Familia no se encuentra', async () => {
    // La base falsa contesta vacío justamente porque el filtro va puesto. Si el filtro faltara,
    // la consulta traería la factura ajena y esta prueba fallaría con un 200.
    respuestas.set('GET /rest/v1/saldos_familia', []);
    const { estado } = await pedir(`/facturas/${FACTURA}`);
    assert.equal(estado, 404);
  });

  it('y las tres consultas del desglose llevan el filtro de Prestadora', async () => {
    respuestas.set('GET /rest/v1/saldos_familia', [SALDO]);
    respuestas.set('GET /rest/v1/facturas_familia_items', []);
    respuestas.set('GET /rest/v1/cobros_familia', []);
    await pedir(`/facturas/${FACTURA}`);

    for (const tabla of ['saldos_familia', 'facturas_familia_items', 'cobros_familia']) {
      const urls = consultasA(tabla);
      assert.equal(urls.length, 1, tabla);
      assert.ok(urls[0].includes(`prestadora_id=eq.${PRESTADORA}`), `${tabla}: ${urls[0]}`);
    }
  });
});

describe('quién entra', () => {
  it('la Prestadora que apagó la función corta el pedido, aunque la persona lo tenga', async () => {
    sesionDeLaFamilia({ visibilidad: [{ clave: 'familia_pagos_y_suscripcion', visible: false }] });
    const { estado, cuerpo } = await pedir('/facturas');
    assert.equal(estado, 403);
    assert.equal(cuerpo.motivo, 'no_disponible');
  });

  it('a quien el titular no le dio el dinero, tampoco', async () => {
    sesionDeLaFamilia({
      titular: false,
      accesos: [{ clave: 'circulo_dinero', permitido: false }],
    });
    const { estado, cuerpo } = await pedir('/facturas');
    assert.equal(estado, 403);
    assert.equal(cuerpo.motivo, 'sin_acceso');
  });

  it('y quien sí lo tiene entra, sin ser el titular', async () => {
    sesionDeLaFamilia({
      titular: false,
      accesos: [{ clave: 'circulo_dinero', permitido: true }],
    });
    respuestas.set('GET /rest/v1/saldos_familia', [SALDO]);
    const { estado } = await pedir('/facturas');
    assert.equal(estado, 200);
  });
});
