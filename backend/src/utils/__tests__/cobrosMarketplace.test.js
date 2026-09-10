/**
 * El cobro de cada período de una suscripción del Marketplace (paso 5 del plan).
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Son dos cosas que faltaban y que se rompen de maneras distintas:
 *
 *   * **Armar el cobro del mes** en los dos rieles que no cobran solos. Si nadie les pide el QR o
 *     el cupón, la Familia no tiene con qué pagar; y si se les pide dos veces el mismo mes, paga
 *     dos veces. Las dos fallas son mudas: nadie se entera hasta el resumen.
 *   * **Mover la suscripción al mes siguiente** cuando la plata entra. Acá la falla que importa es
 *     contar desde hoy en vez de desde el período cobrado: cada demora corre la fecha, y a fin de
 *     año la Prestadora cobró once meses en vez de doce.
 *
 * Casi todo lo de abajo está escrito contra fechas de borde —el 31 de enero, diciembre, un año
 * bisiesto—, porque son las que hacen que el error aparezca un mes después y no el día que se
 * programó.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const OTRA_PRESTADORA = '22222222-2222-2222-2222-222222222222';
const SUSCRIPCION = '33333333-3333-3333-3333-333333333333';
const OTRA_SUSCRIPCION = '55555555-5555-5555-5555-555555555555';
const FAMILIA = '44444444-4444-4444-4444-444444444444';
/** El mes que las suscripciones de la prueba están esperando cobrar. */
const PERIODO = '2026-08-01';

const respuestas = new Map();
let llamadas = [];
let anotados = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    const cuerpo = crudo ? JSON.parse(crudo) : null;
    llamadas.push({ clave, url: req.url, cuerpo: Array.isArray(cuerpo) ? cuerpo[0] : cuerpo });

    const preparada = respuestas.get(clave);
    // A la respuesta preparada se le pasa la dirección con sus filtros: en esa tabla caen dos
    // consultas distintas —la lista de las que hay que cobrar y la lectura de una sola por su
    // identificador— y lo único que las separa es el filtro.
    const valor = typeof preparada === 'function' ? preparada(req.url) : preparada;
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

// Los dos rieles que hay que llamar mes a mes. Cada uno contesta lo suyo con su propio nombre —un
// QR y un cupón—, que es justo lo que el trabajo diario no tiene que saber.
let rechazaElProveedor = false;
let pedidosAlProveedor = [];
const proveedorFalso = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    pedidosAlProveedor.push({ ruta, cuerpo: crudo ? JSON.parse(crudo) : null });
    if (rechazaElProveedor) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ mensaje: 'la cuenta de cobro 1234 no está habilitada' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        ruta === '/pagos/qr'
          ? { id: 'qr_de_mentira', qr_url: 'https://ejemplo.invalido/qr' }
          : { id: 'cupon_de_mentira', codigo: '9988-7766' }
      )
    );
  });
});
await new Promise((listo) => proveedorFalso.listen(0, '127.0.0.1', listo));
process.env.MODO_API_BASE = `http://127.0.0.1:${proveedorFalso.address().port}`;
process.env.COBRANZA_EFECTIVO_API_BASE = `http://127.0.0.1:${proveedorFalso.address().port}`;

// El import va después de las variables de entorno: la conexión a la base y la dirección de cada
// proveedor se arman en el momento en que se importa el archivo.
const { armarCobrosDelPeriodo, registrarCobroExitoso, sumarDias, sumarUnMes } = await import(
  '../cobrosMarketplace.js'
);

const avisarDeVerdad = console.error;
console.error = (...partes) => anotados.push(partes.join(' '));

after(() => {
  console.error = avisarDeVerdad;
  baseFalsa.close();
  proveedorFalso.close();
});

beforeEach(() => {
  llamadas = [];
  anotados = [];
  pedidosAlProveedor = [];
  rechazaElProveedor = false;
  respuestas.clear();
});

/** Una suscripción esperando cobrar el período de la prueba. */
function suscripcionPorCobrar(cambios = {}) {
  return {
    id: SUSCRIPCION,
    prestadora_id: PRESTADORA,
    familia_id: FAMILIA,
    proveedor: 'modo',
    monto_mensual: 12500,
    moneda: 'ARS',
    proximo_cobro: PERIODO,
    ...cambios,
  };
}

/** La base con lo mínimo para que el trabajo diario corra entero. */
function base({ suscripciones = [suscripcionPorCobrar()], cobrosExistentes = [] } = {}) {
  respuestas.set('GET /rest/v1/suscripciones_marketplace', () => suscripciones);
  respuestas.set('GET /rest/v1/cobros_marketplace', () => cobrosExistentes);
  respuestas.set('POST /rest/v1/cobros_marketplace', () => []);
  respuestas.set('POST /rest/v1/rpc/leer_credencial_pasarela_pago', () => 'credencial-de-mentira');
}

const inserciones = () => llamadas.filter((l) => l.clave === 'POST /rest/v1/cobros_marketplace');
const lecturasDeCredencial = () =>
  llamadas.filter((l) => l.clave === 'POST /rest/v1/rpc/leer_credencial_pasarela_pago');

// ---------------------------------------------------------------------------
// Las dos cuentas de fechas. Están sueltas de la base a propósito: es aritmética, y es donde
// vivía el error que hacía perder un mes por año.
// ---------------------------------------------------------------------------

describe('el mes siguiente a una fecha', () => {
  it('es el mismo día del mes que viene', () => {
    assert.equal(sumarUnMes('2026-09-01'), '2026-10-01');
    assert.equal(sumarUnMes('2026-09-15'), '2026-10-15');
  });

  it('y si ese día no existe, es el último del mes', () => {
    // Con `setMonth(+1)`, que es lo que hacía el aviso de cobro, el 31 de enero daba 3 de marzo, y
    // de ahí en adelante la suscripción cobraba el 3 de cada mes en vez del 31.
    assert.equal(sumarUnMes('2026-01-31'), '2026-02-28');
    assert.equal(sumarUnMes('2026-03-31'), '2026-04-30');
    assert.equal(sumarUnMes('2026-05-31'), '2026-06-30');
  });

  it('en un año bisiesto febrero tiene su día 29', () => {
    assert.equal(sumarUnMes('2028-01-31'), '2028-02-29');
  });

  it('de diciembre se pasa a enero del año siguiente', () => {
    assert.equal(sumarUnMes('2026-12-31'), '2027-01-31');
    assert.equal(sumarUnMes('2026-12-01'), '2027-01-01');
  });

  it('doce meses seguidos desde un 31 vuelven al 31, no se van corriendo', () => {
    // Es la prueba que resume a las otras: partiendo del último día de un mes largo, el día del mes
    // no se pierde por el camino aunque haya pasado por febrero.
    let fecha = '2026-01-31';
    const recorrido = [];
    for (let i = 0; i < 12; i += 1) {
      fecha = sumarUnMes(fecha);
      recorrido.push(fecha);
    }
    assert.equal(recorrido[1], '2026-03-28');
    assert.equal(recorrido[11], '2027-01-28');
  });
});

describe('la fecha de vencimiento del cupón', () => {
  it('son tantos días corridos después, y cruza de mes', () => {
    assert.equal(sumarDias('2026-09-01', 10), '2026-09-11');
    assert.equal(sumarDias('2026-01-25', 10), '2026-02-04');
  });

  it('cuenta en UTC, así no se corre un día según a qué hora corra el trabajo', () => {
    // El trabajo diario corre a la hora que arrancó el servidor. Contando en la zona horaria de la
    // máquina, el mismo cálculo da una fecha distinta según si son las 21 o las 03.
    assert.equal(sumarDias('2026-09-01T23:59:59Z', 10), '2026-09-11');
    assert.equal(sumarDias('2028-02-25', 10), '2028-03-06');
  });
});

// ---------------------------------------------------------------------------
// Entró la plata de un período
// ---------------------------------------------------------------------------

describe('cuando un período se cobra', () => {
  beforeEach(() => {
    respuestas.set('GET /rest/v1/suscripciones_marketplace', () => [
      { id: SUSCRIPCION, proximo_cobro: PERIODO },
    ]);
    respuestas.set('PATCH /rest/v1/suscripciones_marketplace', () => []);
  });

  const guardado = () => llamadas.find((l) => l.clave === 'PATCH /rest/v1/suscripciones_marketplace');

  it('la suscripción queda activa y esperando el mes siguiente al cobrado', async () => {
    const resultado = await registrarCobroExitoso({ suscripcionId: SUSCRIPCION, periodo: PERIODO });

    assert.deepEqual(resultado, { ok: true, proximo_cobro: '2026-09-01' });
    assert.equal(guardado().cuerpo.estado, 'activa');
    assert.equal(guardado().cuerpo.proximo_cobro, '2026-09-01');
  });

  it('el mes siguiente se cuenta desde el período, no desde hoy', async () => {
    // Un cobro de mayo que entra hoy deja la suscripción esperando junio, no el mes que viene:
    // si no, cada demora se come un mes y a fin de año se cobraron once.
    respuestas.set('GET /rest/v1/suscripciones_marketplace', () => [
      { id: SUSCRIPCION, proximo_cobro: '2026-05-10' },
    ]);
    const resultado = await registrarCobroExitoso({ suscripcionId: SUSCRIPCION, periodo: '2026-05-10' });
    assert.equal(resultado.proximo_cobro, '2026-06-10');
  });

  it('un cobro de un mes anterior al esperado no mueve la fecha hacia atrás', async () => {
    // Pasa cuando se carga a mano un pago viejo. Correr la fecha hacia atrás le regalaría un mes a
    // quien pagó tarde.
    respuestas.set('GET /rest/v1/suscripciones_marketplace', () => [
      { id: SUSCRIPCION, proximo_cobro: '2026-09-01' },
    ]);
    const resultado = await registrarCobroExitoso({ suscripcionId: SUSCRIPCION, periodo: '2026-07-01' });
    assert.equal(resultado.proximo_cobro, '2026-10-01');
  });

  it('una suscripción sin fecha esperada arranca desde el período cobrado', async () => {
    respuestas.set('GET /rest/v1/suscripciones_marketplace', () => [
      { id: SUSCRIPCION, proximo_cobro: null },
    ]);
    const resultado = await registrarCobroExitoso({ suscripcionId: SUSCRIPCION, periodo: '2026-03-31' });
    assert.equal(resultado.proximo_cobro, '2026-04-30');
  });

  it('si la suscripción no está, se avisa y no se escribe nada', async () => {
    respuestas.set('GET /rest/v1/suscripciones_marketplace', () => []);
    const resultado = await registrarCobroExitoso({ suscripcionId: SUSCRIPCION, periodo: PERIODO });

    assert.deepEqual(resultado, { ok: false });
    assert.equal(guardado(), undefined);
    assert.ok(anotados.some((linea) => linea.includes('No se pudo mover la suscripción')));
  });

  it('si la escritura falla, se avisa y se contesta que no se pudo', async () => {
    respuestas.delete('PATCH /rest/v1/suscripciones_marketplace');
    const resultado = await registrarCobroExitoso({ suscripcionId: SUSCRIPCION, periodo: PERIODO });

    assert.deepEqual(resultado, { ok: false });
    assert.ok(anotados.some((linea) => linea.includes('No se pudo mover la suscripción')));
  });
});

// ---------------------------------------------------------------------------
// El trabajo diario que le pide a cada riel el cobro del mes
// ---------------------------------------------------------------------------

describe('el trabajo diario que arma los cobros del período', () => {
  it('pide la lista acotada a las que están al día y ya vencieron', async () => {
    base();
    await armarCobrosDelPeriodo();

    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/suscripciones_marketplace');
    const hoy = new Date().toISOString().slice(0, 10);
    assert.ok(consulta.url.includes('estado=in.'), 'sólo las de prueba y las activas');
    assert.ok(consulta.url.includes('proveedor=not.is.null'), 'sólo las que tienen riel');
    assert.ok(consulta.url.includes(`proximo_cobro=lte.${hoy}`), 'sólo los meses que ya vencieron');
  });

  it('le pide el QR al riel y guarda el cobro del mes pendiente', async () => {
    base();
    await armarCobrosDelPeriodo();

    assert.equal(pedidosAlProveedor.length, 1);
    assert.equal(pedidosAlProveedor[0].ruta, '/pagos/qr');
    assert.equal(pedidosAlProveedor[0].cuerpo.monto, 12500);

    assert.equal(inserciones().length, 1);
    assert.deepEqual(inserciones()[0].cuerpo, {
      suscripcion_id: SUSCRIPCION,
      prestadora_id: PRESTADORA,
      medio: 'modo',
      monto: 12500,
      periodo: PERIODO,
      estado_cobro: 'pendiente',
      referencia_externa: 'qr_de_mentira',
      url_accion: 'https://ejemplo.invalido/qr',
      codigo_cupon: null,
    });
  });

  it('la referencia que se le da al proveedor identifica el período, no la suscripción', async () => {
    // Es lo que permite que dos meses de la misma Familia no se confundan cuando vuelven los
    // avisos: con la referencia de la suscripción, el aviso del segundo mes pisaría al del primero.
    base();
    await armarCobrosDelPeriodo();
    assert.equal(pedidosAlProveedor[0].cuerpo.referencia_externa, `${SUSCRIPCION}:${PERIODO}`);
  });

  it('el cupón de la red de cobranza vence a los diez días del período', async () => {
    // Sin fecha de vencimiento, un cupón se paga tres meses tarde y el período ya está cerrado.
    base({ suscripciones: [suscripcionPorCobrar({ proveedor: 'cobranza_efectivo' })] });
    await armarCobrosDelPeriodo();

    assert.equal(pedidosAlProveedor[0].ruta, '/cupones');
    assert.equal(pedidosAlProveedor[0].cuerpo.fecha_vencimiento, '2026-08-11');
    assert.equal(inserciones()[0].cuerpo.codigo_cupon, '9988-7766');
    assert.equal(inserciones()[0].cuerpo.url_accion, null);
    assert.equal(inserciones()[0].cuerpo.medio, 'cobranza_efectivo');
  });

  it('a los rieles que cobran solos no se les pide nada', async () => {
    // Pedirles el cobro del mes crearía un segundo cobro del mismo período: uno del lado del
    // proveedor, que ya está andando, y otro acá.
    base({
      suscripciones: [
        suscripcionPorCobrar({ proveedor: 'stripe' }),
        suscripcionPorCobrar({ id: OTRA_SUSCRIPCION, proveedor: 'mercadopago' }),
        suscripcionPorCobrar({ id: '66666666-6666-6666-6666-666666666666', proveedor: 'debin' }),
        suscripcionPorCobrar({ id: '77777777-7777-7777-7777-777777777777', proveedor: 'efectivo_manual' }),
      ],
    });
    await armarCobrosDelPeriodo();

    assert.deepEqual(pedidosAlProveedor, []);
    assert.deepEqual(inserciones(), []);
  });

  it('no se arma dos veces el mismo mes', async () => {
    base({ cobrosExistentes: [{ id: 'cobro-que-ya-estaba', estado_cobro: 'pendiente' }] });
    await armarCobrosDelPeriodo();

    assert.deepEqual(pedidosAlProveedor, [], 'no se le pide al proveedor un QR que habría que tirar');
    assert.deepEqual(inserciones(), []);
  });

  it('tampoco cuando el mes ya se cobró y lo que quedó atrasado es la fecha', async () => {
    base({ cobrosExistentes: [{ id: 'cobro-que-ya-entro', estado_cobro: 'exitoso' }] });
    await armarCobrosDelPeriodo();
    assert.deepEqual(inserciones(), []);
  });

  it('pero un mes cuyo único cobro quedó fallido se vuelve a armar', async () => {
    base({ cobrosExistentes: [{ id: 'cobro-que-no-entro', estado_cobro: 'fallido' }] });
    await armarCobrosDelPeriodo();

    assert.equal(pedidosAlProveedor.length, 1);
    assert.equal(inserciones().length, 1);
  });

  it('el cobro existente se busca por esa suscripción y ese período', async () => {
    base();
    await armarCobrosDelPeriodo();

    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/cobros_marketplace');
    assert.ok(consulta.url.includes(`suscripcion_id=eq.${SUSCRIPCION}`));
    assert.ok(consulta.url.includes(`periodo=eq.${PERIODO}`));
  });

  it('la credencial se lee una vez por Prestadora y riel, no una por suscripción', async () => {
    base({
      suscripciones: [
        suscripcionPorCobrar(),
        suscripcionPorCobrar({ id: OTRA_SUSCRIPCION }),
        suscripcionPorCobrar({ id: '66666666-6666-6666-6666-666666666666', prestadora_id: OTRA_PRESTADORA }),
      ],
    });
    await armarCobrosDelPeriodo();

    assert.equal(inserciones().length, 3);
    assert.equal(lecturasDeCredencial().length, 2, 'dos Prestadoras, dos lecturas de la caja fuerte');
  });

  it('sin credencial guardada no se le pide nada al proveedor', async () => {
    base();
    respuestas.set('POST /rest/v1/rpc/leer_credencial_pasarela_pago', () => null);
    await armarCobrosDelPeriodo();

    assert.deepEqual(pedidosAlProveedor, []);
    assert.deepEqual(inserciones(), []);
    assert.ok(anotados.some((linea) => linea.includes('sin credencial guardada')));
  });

  it('lo que una Prestadora tenga mal no deja sin cobrar a las demás', async () => {
    // Es el mismo criterio de `revisarVencimientos`: el trabajo recorre todas y nunca corta por
    // una. Acá la primera no tiene credencial y la segunda sí.
    base({
      suscripciones: [
        suscripcionPorCobrar(),
        suscripcionPorCobrar({ id: OTRA_SUSCRIPCION, prestadora_id: OTRA_PRESTADORA }),
      ],
    });
    let primera = true;
    respuestas.set('POST /rest/v1/rpc/leer_credencial_pasarela_pago', () => {
      const valor = primera ? null : 'credencial-de-mentira';
      primera = false;
      return valor;
    });

    await armarCobrosDelPeriodo();

    assert.equal(inserciones().length, 1);
    assert.equal(inserciones()[0].cuerpo.suscripcion_id, OTRA_SUSCRIPCION);
  });

  it('si el proveedor rechaza, no queda ningún cobro anotado y lo que dijo no se repite entero', async () => {
    base();
    rechazaElProveedor = true;
    await armarCobrosDelPeriodo();

    assert.deepEqual(inserciones(), []);
    const aviso = anotados.find((linea) => linea.includes('Error armando el cobro'));
    assert.ok(aviso, 'queda registrado, porque es plata');
    assert.equal(aviso.includes(FAMILIA), false, 'sin el identificador de la Familia');
  });

  it('si no se puede guardar el cobro armado, queda avisado y el trabajo sigue', async () => {
    base({
      suscripciones: [
        suscripcionPorCobrar(),
        suscripcionPorCobrar({ id: OTRA_SUSCRIPCION, proveedor: 'cobranza_efectivo' }),
      ],
    });
    let primera = true;
    respuestas.set('POST /rest/v1/cobros_marketplace', () => {
      if (primera) {
        primera = false;
        return undefined;
      }
      return [];
    });

    await armarCobrosDelPeriodo();

    assert.equal(pedidosAlProveedor.length, 2, 'a las dos se les armó el cobro');
    assert.ok(anotados.some((linea) => linea.includes('Error armando el cobro')));
  });

  it('si la lista no se puede leer, se avisa y no se llama a ningún proveedor', async () => {
    respuestas.set('GET /rest/v1/cobros_marketplace', () => []);
    await armarCobrosDelPeriodo();

    assert.deepEqual(pedidosAlProveedor, []);
    assert.ok(anotados.some((linea) => linea.includes('Error consultando las suscripciones por cobrar')));
  });

  it('sin nada que cobrar no se toca la caja fuerte', async () => {
    base({ suscripciones: [] });
    await armarCobrosDelPeriodo();

    assert.deepEqual(lecturasDeCredencial(), []);
    assert.deepEqual(pedidosAlProveedor, []);
  });
});
