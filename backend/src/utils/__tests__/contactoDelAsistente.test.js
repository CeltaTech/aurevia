/**
 * Ver cómo llegar a un Asistente del Marketplace: qué se cobra y cuándo.
 *
 *   npm test --prefix backend
 *
 * QUÉ SE PRUEBA ACÁ. Lo que decide plata y no está en la base: con cuál de los accesos de la
 * Familia se paga, qué se le muestra a quien no mira el dinero, y que el período gratuito termine
 * exactamente cuando se abrió un contacto nuevo y en ningún otro caso. El descuento del saldo es
 * de la base y está probado en `contactosMarketplace.test.js`.
 *
 * CÓMO PUEDE FALLAR. La base falsa no responde nada que la prueba no haya preparado, así que una
 * consulta de más —o una que se dejó de hacer— cambia el resultado. Las tres que costarían plata
 * se comprueban por separado: que no se pida el contacto cuando no se pudo cobrar, que no se
 * escriba el acceso cuando el contacto ya estaba abierto, y que no se conteste «abierto» cuando la
 * base falló.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const FAMILIA = '22222222-2222-2222-2222-222222222222';
const ASISTENTE = '88888888-8888-8888-8888-888888888888';

const HOY = new Date().toISOString().slice(0, 10);
const ayer = (dias) => new Date(Date.now() - dias * 86400000).toISOString().slice(0, 10);
const dentroDe = (dias) => new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);

const CONTACTO = {
  id: ASISTENTE,
  nombre: 'Asistente de prueba',
  telefono: '+54 11 5555 0000',
  email: 'asistente@ejemplo.invalido',
  domicilio: 'Calle Inventada 123',
};

const respuestas = new Map();
let llamadas = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const direccion = new URL(req.url, 'http://interno');
    const clave = `${req.method} ${direccion.pathname}`;
    llamadas.push({ clave, busqueda: direccion.search, cuerpo: crudo ? JSON.parse(crudo) : null });

    const preparada = respuestas.get(clave);
    if (preparada === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `la prueba no preparó respuesta para ${clave}` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(typeof preparada === 'function' ? preparada() : preparada));
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

// Después de las variables de entorno: la conexión a la base se arma al importar.
const {
  abrirElContactoDeUnAsistente,
  accesoQuePagaElContacto,
  comoEstaElContacto,
  enPeriodoGratuito,
  MOTIVO_VER_CONTACTO,
} = await import('../contactoDelAsistente.js');

after(() => baseFalsa.close());

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
});

const ACCESOS = 'GET /rest/v1/accesos_marketplace';
const VISTOS = 'GET /rest/v1/contactos_vistos_marketplace';
const ASISTENTES = 'GET /rest/v1/asistentes';
const CONSUMIR = 'POST /rest/v1/rpc/consumir_contacto_marketplace';
const ESCRIBIR_ACCESO = 'PATCH /rest/v1/accesos_marketplace';

/** Un acceso como lo devuelve la base, con la forma de cobro anidada. */
const acceso = (cambios = {}) => ({
  id: '33333333-3333-3333-3333-333333333333',
  estado: 'vigente',
  importe: 4500,
  moneda: 'ARS',
  gratis_hasta: null,
  proximo_cobro: null,
  saldo_contactos: null,
  created_at: '2026-01-01T00:00:00.000Z',
  formas_de_cobro_marketplace: {
    nombre: 'Suscripción mensual',
    renueva_sola: true,
    periodo_cantidad: 1,
    periodo_unidad: 'mes',
    contactos_incluidos: null,
  },
  ...cambios,
});

const cuantas = (clave) => llamadas.filter((l) => l.clave === clave).length;

describe('el período gratuito', () => {
  it('el último día todavía es gratis, el siguiente ya no', () => {
    assert.equal(enPeriodoGratuito({ gratis_hasta: HOY }, HOY), true);
    assert.equal(enPeriodoGratuito({ gratis_hasta: ayer(1) }, HOY), false);
    assert.equal(enPeriodoGratuito({ gratis_hasta: dentroDe(5) }, HOY), true);
  });

  it('un acceso sin período gratuito no está en prueba', () => {
    assert.equal(enPeriodoGratuito({ gratis_hasta: null }, HOY), false);
    assert.equal(enPeriodoGratuito(null, HOY), false);
  });
});

describe('con cuál de los accesos se paga', () => {
  it('gasta primero lo comprado: entre varios vigentes elige el que tiene saldo', async () => {
    // El sostenido por fecha paga siempre; el paquete se vence si no se usa. Elegir el de fecha
    // dejaría saldo comprado sin gastar.
    respuestas.set(ACCESOS, [
      acceso({ id: 'por-fecha', saldo_contactos: null }),
      acceso({ id: 'con-saldo', saldo_contactos: 2 }),
    ]);
    const { acceso: elegido, hubo_alguno } = await accesoQuePagaElContacto({ familiaId: FAMILIA });
    assert.equal(elegido.id, 'con-saldo');
    assert.equal(hubo_alguno, true);
  });

  it('entre dos con saldo elige el más antiguo, que es el que llega primero', async () => {
    respuestas.set(ACCESOS, [
      acceso({ id: 'viejo', saldo_contactos: 1 }),
      acceso({ id: 'nuevo', saldo_contactos: 9 }),
    ]);
    const { acceso: elegido } = await accesoQuePagaElContacto({ familiaId: FAMILIA });
    assert.equal(elegido.id, 'viejo');
    assert.match(llamadas[0].busqueda, /created_at\.asc/);
  });

  it('un acceso que no está vigente no paga, pero se sabe que existió', async () => {
    // «Nunca tuvo» y «se le venció» no se arreglan igual: uno lo da de alta la Prestadora y el
    // otro lo renueva.
    respuestas.set(ACCESOS, [acceso({ estado: 'vencida' }), acceso({ estado: 'cancelada' })]);
    const resultado = await accesoQuePagaElContacto({ familiaId: FAMILIA });
    assert.equal(resultado.acceso, null);
    assert.equal(resultado.hubo_alguno, true);
  });

  it('el paquete agotado se elige igual, para poder decir que se agotó', async () => {
    respuestas.set(ACCESOS, [acceso({ saldo_contactos: 0 })]);
    const { acceso: elegido } = await accesoQuePagaElContacto({ familiaId: FAMILIA });
    assert.equal(elegido.saldo_contactos, 0);
  });

  it('si la base falla, no se inventa ningún acceso', async () => {
    const resultado = await accesoQuePagaElContacto({ familiaId: FAMILIA });
    assert.deepEqual(resultado, { acceso: null, hubo_alguno: false });
  });
});

describe('cómo está el contacto', () => {
  const preguntar = (mira_el_dinero = true) =>
    comoEstaElContacto({ prestadoraId: PRESTADORA, familiaId: FAMILIA, asistenteId: ASISTENTE, mira_el_dinero });

  it('el que ya está abierto se muestra sin volver a mirar la plata', async () => {
    respuestas.set(VISTOS, [{ id: 'ya-visto' }]);
    respuestas.set(ASISTENTES, [CONTACTO]);

    const resultado = await preguntar();
    assert.equal(resultado.abierto, true);
    assert.equal(resultado.contacto.telefono, CONTACTO.telefono);
    assert.equal(resultado.activacion, null);
    assert.equal(cuantas(ACCESOS), 0, 'un contacto ya abierto no consulta accesos');
  });

  it('quien no mira el dinero no ve ni el importe ni el saldo', async () => {
    // En el círculo familiar la plata no la mira cualquiera: ve si el contacto está abierto, y nada
    // de lo que costaría abrirlo.
    respuestas.set(VISTOS, []);
    const resultado = await preguntar(false);
    assert.deepEqual(resultado, { abierto: false, contacto: null, activacion: null });
    assert.equal(cuantas(ACCESOS), 0);
  });

  it('sin ningún acceso, el motivo lo dice', async () => {
    respuestas.set(VISTOS, []);
    respuestas.set(ACCESOS, []);
    const resultado = await preguntar();
    assert.equal(resultado.motivo, MOTIVO_VER_CONTACTO.SIN_ACCESO);
    assert.equal(resultado.activacion, null);
  });

  it('con el acceso vencido, el motivo es otro', async () => {
    respuestas.set(VISTOS, []);
    respuestas.set(ACCESOS, [acceso({ estado: 'vencida' })]);
    assert.equal((await preguntar()).motivo, MOTIVO_VER_CONTACTO.ACCESO_NO_VIGENTE);
  });

  it('con el paquete agotado, tampoco se ofrece activar nada', async () => {
    respuestas.set(VISTOS, []);
    respuestas.set(ACCESOS, [acceso({ saldo_contactos: 0 })]);
    const resultado = await preguntar();
    assert.equal(resultado.motivo, MOTIVO_VER_CONTACTO.SALDO_AGOTADO);
    assert.equal(resultado.activacion, null);
  });

  it('se puede: dice qué se va a cobrar y si eso termina la prueba', async () => {
    respuestas.set(VISTOS, []);
    respuestas.set(ACCESOS, [acceso({ gratis_hasta: dentroDe(10), saldo_contactos: 3 })]);

    const resultado = await preguntar();
    assert.equal(resultado.abierto, false);
    assert.equal(resultado.contacto, null, 'todavía no se pagó: no se adelanta el dato');
    assert.deepEqual(resultado.activacion, {
      forma: 'Suscripción mensual',
      importe: 4500,
      moneda: 'ARS',
      renueva_sola: true,
      termina_el_periodo_gratuito: true,
      saldo_contactos: 3,
    });
    assert.equal(cuantas(ASISTENTES), 0, 'mirar no destapa el contacto');
  });

  it('fuera del período gratuito, la confirmación no dice que se termina', async () => {
    respuestas.set(VISTOS, []);
    respuestas.set(ACCESOS, [acceso({ gratis_hasta: ayer(1) })]);
    assert.equal((await preguntar()).activacion.termina_el_periodo_gratuito, false);
  });

  it('si la base falla, se contesta cerrado', async () => {
    // Contestar «abierto» ante un error destaparía un dato que quizá nadie pagó.
    const resultado = await preguntar();
    assert.equal(resultado.abierto, false);
    assert.equal(resultado.contacto, null);
    assert.equal(resultado.motivo, MOTIVO_VER_CONTACTO.NO_SE_PUDO_GUARDAR);
  });
});

describe('abrir el contacto', () => {
  const abrir = () =>
    abrirElContactoDeUnAsistente({ prestadoraId: PRESTADORA, familiaId: FAMILIA, asistenteId: ASISTENTE });

  it('descuenta, termina la prueba y recién entonces entrega el dato', async () => {
    respuestas.set(ACCESOS, [acceso({ gratis_hasta: dentroDe(10), proximo_cobro: dentroDe(10) })]);
    respuestas.set(CONSUMIR, { ok: true, ya_estaba: false, saldo_contactos: 2 });
    respuestas.set(ESCRIBIR_ACCESO, []);
    respuestas.set(ASISTENTES, [CONTACTO]);

    const resultado = await abrir();
    assert.equal(resultado.ok, true);
    assert.equal(resultado.ya_estaba, false);
    assert.equal(resultado.saldo_contactos, 2);
    assert.equal(resultado.contacto.email, CONTACTO.email);

    const escrito = llamadas.find((l) => l.clave === ESCRIBIR_ACCESO).cuerpo;
    assert.equal(escrito.gratis_hasta, HOY, 'el acceso dejó de estar en prueba');
    assert.equal(escrito.proximo_cobro, HOY, 'el cobro pasa a ser el de hoy');
  });

  it('un contacto que ya estaba abierto no activa ningún cobro', async () => {
    // Volver a mirar lo que ya se pagó no puede terminar un período gratuito.
    respuestas.set(ACCESOS, [acceso({ gratis_hasta: dentroDe(10) })]);
    respuestas.set(CONSUMIR, { ok: true, ya_estaba: true, saldo_contactos: 2 });
    respuestas.set(ASISTENTES, [CONTACTO]);

    const resultado = await abrir();
    assert.equal(resultado.ok, true);
    assert.equal(resultado.ya_estaba, true);
    assert.equal(cuantas(ESCRIBIR_ACCESO), 0);
  });

  it('un acceso que ya no estaba en prueba no se escribe al pedir un contacto', async () => {
    respuestas.set(ACCESOS, [acceso({ gratis_hasta: ayer(3) })]);
    respuestas.set(CONSUMIR, { ok: true, ya_estaba: false, saldo_contactos: 1 });
    respuestas.set(ASISTENTES, [CONTACTO]);

    assert.equal((await abrir()).ok, true);
    assert.equal(cuantas(ESCRIBIR_ACCESO), 0);
  });

  it('un cobro que ya estaba vencido no se corre hacia adelante', async () => {
    // Adelantar `proximo_cobro` a hoy borraría una deuda del trabajo diario.
    respuestas.set(ACCESOS, [acceso({ gratis_hasta: dentroDe(2), proximo_cobro: ayer(5) })]);
    respuestas.set(CONSUMIR, { ok: true, ya_estaba: false, saldo_contactos: 1 });
    respuestas.set(ESCRIBIR_ACCESO, []);
    respuestas.set(ASISTENTES, [CONTACTO]);

    await abrir();
    const escrito = llamadas.find((l) => l.clave === ESCRIBIR_ACCESO).cuerpo;
    assert.equal(escrito.gratis_hasta, HOY);
    assert.equal(escrito.proximo_cobro, undefined, 'la fecha vencida se respeta como está');
  });

  it('sin saldo no se entrega nada, y el motivo viaja con el saldo que quedó', async () => {
    respuestas.set(ACCESOS, [acceso({ saldo_contactos: 0 })]);
    respuestas.set(CONSUMIR, { ok: false, motivo: 'saldo_agotado', saldo_contactos: 0 });

    const resultado = await abrir();
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, MOTIVO_VER_CONTACTO.SALDO_AGOTADO);
    assert.equal(resultado.saldo_contactos, 0);
    assert.equal(cuantas(ASISTENTES), 0, 'lo que no se cobró no se muestra');
    assert.equal(cuantas(ESCRIBIR_ACCESO), 0);
  });

  it('sin acceso no se llega siquiera a descontar', async () => {
    respuestas.set(ACCESOS, []);
    const resultado = await abrir();
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, MOTIVO_VER_CONTACTO.SIN_ACCESO);
    assert.equal(cuantas(CONSUMIR), 0);
  });

  it('si el período gratuito no se pudo terminar, el contacto igual se entrega', async () => {
    // El contacto ya está descontado y anotado. Tirar abajo la respuesta dejaría a la Familia sin
    // el dato que acaba de pagar; lo que queda es un día de prueba de más, y queda registrado.
    respuestas.set(ACCESOS, [acceso({ gratis_hasta: dentroDe(4) })]);
    respuestas.set(CONSUMIR, { ok: true, ya_estaba: false, saldo_contactos: 1 });
    respuestas.set(ASISTENTES, [CONTACTO]);
    // Sin respuesta preparada para el PATCH: la base falsa lo rechaza.

    const resultado = await abrir();
    assert.equal(resultado.ok, true);
    assert.equal(resultado.contacto.nombre, CONTACTO.nombre);
  });
});
