/**
 * El cobro de cada período de un acceso del Marketplace.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Son dos cosas que faltaban y que se rompen de maneras distintas:
 *
 *   * **Armar el cobro del período** en los dos rieles que no cobran solos. Si nadie les pide el QR
 *     o el cupón, la Familia no tiene con qué pagar; y si se les pide dos veces el mismo período,
 *     paga dos veces. Las dos fallas son mudas: nadie se entera hasta el resumen.
 *   * **Mover el acceso al período siguiente** cuando la plata entra. Acá la falla que importa es
 *     contar desde hoy en vez de desde el período cobrado: cada demora corre la fecha, y a fin de
 *     año la Prestadora cobró once meses en vez de doce.
 *
 * Y cuánto dura el período no lo decide este código: sale de la forma de cobro que armó la
 * Prestadora, que puede medirlo en días, semanas, meses o años, o no tener período ninguno porque
 * se cobra una sola vez.
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
const ACCESO = '33333333-3333-3333-3333-333333333333';
const OTRO_ACCESO = '55555555-5555-5555-5555-555555555555';
const FAMILIA = '44444444-4444-4444-4444-444444444444';
/** El período que los accesos de la prueba están esperando cobrar. */
const PERIODO = '2026-08-01';
/** La forma de cobro más corriente: un importe por mes. Va en cada acceso de la prueba porque es
 *  de ahí, y no del código, de donde sale cada cuánto se vuelve a cobrar. */
const CADA_MES = { periodo_cantidad: 1, periodo_unidad: 'mes' };

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

// Los dos rieles que hay que llamar período a período. Cada uno contesta lo suyo con su propio nombre —un
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
const { armarCobrosDelPeriodo, registrarCobroExitoso, proximaFecha, sumarDias, sumarPeriodo } =
  await import('../cobrosMarketplace.js');

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

/** Un acceso esperando cobrar el período de la prueba. */
function accesoPorCobrar(cambios = {}) {
  return {
    id: ACCESO,
    prestadora_id: PRESTADORA,
    familia_id: FAMILIA,
    proveedor: 'modo',
    importe: 12500,
    moneda: 'ARS',
    proximo_cobro: PERIODO,
    formas_de_cobro_marketplace: CADA_MES,
    ...cambios,
  };
}

/** La base con lo mínimo para que el trabajo diario corra entero. */
function base({ accesos = [accesoPorCobrar()], cobrosExistentes = [] } = {}) {
  respuestas.set('GET /rest/v1/accesos_marketplace', () => accesos);
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

describe('un período después de una fecha', () => {
  it('en días y en semanas son días corridos', () => {
    assert.equal(sumarPeriodo('2026-09-01', 15, 'dia'), '2026-09-16');
    assert.equal(sumarPeriodo('2026-09-01', 2, 'semana'), '2026-09-15');
    assert.equal(sumarPeriodo('2026-12-20', 3, 'semana'), '2027-01-10');
  });

  it('en meses es el mismo día del mes que viene', () => {
    assert.equal(sumarPeriodo('2026-09-01', 1, 'mes'), '2026-10-01');
    assert.equal(sumarPeriodo('2026-09-15', 1, 'mes'), '2026-10-15');
    assert.equal(sumarPeriodo('2026-09-15', 3, 'mes'), '2026-12-15');
  });

  it('y si ese día no existe, es el último del mes', () => {
    // Con `setMonth(+1)`, que es lo que hacía el aviso de cobro, el 31 de enero daba 3 de marzo, y
    // de ahí en adelante el acceso cobraba el 3 de cada mes en vez del 31.
    assert.equal(sumarPeriodo('2026-01-31', 1, 'mes'), '2026-02-28');
    assert.equal(sumarPeriodo('2026-03-31', 1, 'mes'), '2026-04-30');
    assert.equal(sumarPeriodo('2026-05-31', 1, 'mes'), '2026-06-30');
  });

  it('en un año bisiesto febrero tiene su día 29', () => {
    assert.equal(sumarPeriodo('2028-01-31', 1, 'mes'), '2028-02-29');
  });

  it('de diciembre se pasa a enero del año siguiente', () => {
    assert.equal(sumarPeriodo('2026-12-31', 1, 'mes'), '2027-01-31');
    assert.equal(sumarPeriodo('2026-12-01', 1, 'mes'), '2027-01-01');
  });

  it('un año es el mismo día del año que viene, y el 29 de febrero cae al 28', () => {
    assert.equal(sumarPeriodo('2026-09-15', 1, 'anio'), '2027-09-15');
    assert.equal(sumarPeriodo('2028-02-29', 1, 'anio'), '2029-02-28');
  });

  it('doce meses seguidos desde un 31 vuelven al 31, no se van corriendo', () => {
    // Es la prueba que resume a las otras: partiendo del último día de un mes largo, el día del mes
    // no se pierde por el camino aunque haya pasado por febrero.
    let fecha = '2026-01-31';
    const recorrido = [];
    for (let i = 0; i < 12; i += 1) {
      fecha = sumarPeriodo(fecha, 1, 'mes');
      recorrido.push(fecha);
    }
    assert.equal(recorrido[1], '2026-03-28');
    assert.equal(recorrido[11], '2027-01-28');
  });

  it('una unidad que no es ninguna de las cuatro rompe, no inventa una fecha', () => {
    // La base sólo deja guardar las cuatro, pero acá llega lo que venga escrito en la fila: una
    // fecha inventada saldría a cobrar sin que nadie se entere.
    assert.throws(() => sumarPeriodo('2026-09-01', 1, 'quincena'), /unidad de período desconocida/);
  });
});

describe('cada cuánto vuelve a cobrarse una forma de cobro', () => {
  it('sale del período que le puso la Prestadora', () => {
    assert.equal(proximaFecha('2026-09-01', CADA_MES), '2026-10-01');
    assert.equal(proximaFecha('2026-09-01', { periodo_cantidad: 1, periodo_unidad: 'anio' }), '2027-09-01');
  });

  it('una forma que se cobra una sola vez no tiene fecha siguiente', () => {
    // Es el paquete de contactos: se paga una vez y lo que lo sostiene es el saldo, no una fecha.
    assert.equal(proximaFecha('2026-09-01', { periodo_cantidad: null, periodo_unidad: null }), null);
    assert.equal(proximaFecha('2026-09-01', undefined), null);
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
    respuestas.set('GET /rest/v1/accesos_marketplace', () => [
      { id: ACCESO, proximo_cobro: PERIODO, formas_de_cobro_marketplace: CADA_MES },
    ]);
    respuestas.set('PATCH /rest/v1/accesos_marketplace', () => []);
  });

  const guardado = () => llamadas.find((l) => l.clave === 'PATCH /rest/v1/accesos_marketplace');

  it('el acceso queda vigente y esperando el período siguiente al cobrado', async () => {
    const resultado = await registrarCobroExitoso({ accesoId: ACCESO, periodo: PERIODO });

    assert.deepEqual(resultado, { ok: true, proximo_cobro: '2026-09-01', saldo_contactos: null });
    assert.equal(guardado().cuerpo.estado, 'vigente');
    assert.equal(guardado().cuerpo.proximo_cobro, '2026-09-01');
  });

  it('lo pagado queda vigente hasta el próximo cobro, no hasta una fecha aparte', async () => {
    // Es el dato que después mira el corte al fin del período pagado. Sin él habría que rehacer la
    // cuenta del cobro para saber hasta cuándo alcanza lo que la Familia ya pagó.
    await registrarCobroExitoso({ accesoId: ACCESO, periodo: PERIODO });
    assert.equal(guardado().cuerpo.vigente_hasta, '2026-09-01');
  });

  it('una forma que se cobra una sola vez queda sin próximo cobro', async () => {
    // El paquete de contactos: se paga, y lo que lo sostiene de ahí en más es el saldo. Poner una
    // fecha siguiente lo volvería a cobrar solo.
    respuestas.set('GET /rest/v1/accesos_marketplace', () => [
      {
        id: ACCESO,
        proximo_cobro: PERIODO,
        formas_de_cobro_marketplace: { periodo_cantidad: null, periodo_unidad: null },
      },
    ]);
    const resultado = await registrarCobroExitoso({ accesoId: ACCESO, periodo: PERIODO });

    assert.deepEqual(resultado, { ok: true, proximo_cobro: null, saldo_contactos: null });
    assert.equal(guardado().cuerpo.proximo_cobro, null);
    assert.equal('vigente_hasta' in guardado().cuerpo, false, 'no se le pone fecha de fin');
  });

  const cargasDeSaldo = () =>
    llamadas.filter((l) => l.clave === 'POST /rest/v1/rpc/sumar_contactos_al_saldo');

  /** Un acceso cuya forma de cobro es un paquete: un importe, sin período, con tantos contactos. */
  function paquete(contactos = 5) {
    respuestas.set('GET /rest/v1/accesos_marketplace', () => [
      {
        id: ACCESO,
        proximo_cobro: PERIODO,
        formas_de_cobro_marketplace: {
          periodo_cantidad: null,
          periodo_unidad: null,
          contactos_incluidos: contactos,
        },
      },
    ]);
  }

  it('un paquete carga su saldo de contactos cuando entra la plata', async () => {
    // Es el único momento en que el saldo existe: el paquete se paga una vez y de ahí en más lo
    // que lo sostiene es lo que quedó cargado.
    paquete(5);
    respuestas.set('POST /rest/v1/rpc/sumar_contactos_al_saldo', () => 5);
    const resultado = await registrarCobroExitoso({ accesoId: ACCESO, periodo: PERIODO });

    assert.deepEqual(resultado, { ok: true, proximo_cobro: null, saldo_contactos: 5 });
    assert.equal(cargasDeSaldo().length, 1);
    assert.deepEqual(cargasDeSaldo()[0].cuerpo, { p_acceso_id: ACCESO, p_cuantos: 5 });
  });

  it('la cuenta la hace la base: acá se le pide sumar, no escribir un total', async () => {
    // Leer el saldo, restarle y volver a escribirlo son dos viajes, y dos cobros que entran a la
    // vez terminarían dejando uno solo cargado. Por eso lo que sale de acá es «sumá tantos».
    paquete(3);
    respuestas.set('POST /rest/v1/rpc/sumar_contactos_al_saldo', () => 11);
    const resultado = await registrarCobroExitoso({ accesoId: ACCESO, periodo: PERIODO });

    assert.equal(cargasDeSaldo()[0].cuerpo.p_cuantos, 3, 'lo que trae la compra, no el total');
    assert.equal(resultado.saldo_contactos, 11, 'el total lo contesta la base');
  });

  it('una forma sin contactos no le carga saldo a nadie', async () => {
    // Una suscripción por mes no es un paquete. Si igual pasara por acá, un acceso que se sostiene
    // por fecha terminaría con un saldo que nadie le vendió.
    respuestas.set('GET /rest/v1/accesos_marketplace', () => [
      {
        id: ACCESO,
        proximo_cobro: PERIODO,
        formas_de_cobro_marketplace: { ...CADA_MES, contactos_incluidos: 0 },
      },
    ]);
    const resultado = await registrarCobroExitoso({ accesoId: ACCESO, periodo: PERIODO });

    assert.deepEqual(cargasDeSaldo(), []);
    assert.equal(resultado.saldo_contactos, null);
  });

  it('si el saldo no se puede cargar, el período igual queda movido y queda avisado', async () => {
    // El orden es a propósito: el período es lo que no puede quedar sin anotar. Un saldo que no se
    // cargó se ve en el registro y se vuelve a cargar; un cobro aplicado a medias, no.
    paquete(5);
    respuestas.delete('POST /rest/v1/rpc/sumar_contactos_al_saldo');
    const resultado = await registrarCobroExitoso({ accesoId: ACCESO, periodo: PERIODO });

    assert.equal(resultado.ok, true);
    assert.equal(resultado.saldo_contactos, null);
    assert.equal(guardado().cuerpo.estado, 'vigente');
    assert.ok(anotados.some((linea) => linea.includes('No se pudo cargar el saldo de contactos')));
  });

  it('una forma por semanas se mueve por semanas, no por meses', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', () => [
      {
        id: ACCESO,
        proximo_cobro: '2026-08-01',
        formas_de_cobro_marketplace: { periodo_cantidad: 2, periodo_unidad: 'semana' },
      },
    ]);
    const resultado = await registrarCobroExitoso({ accesoId: ACCESO, periodo: '2026-08-01' });
    assert.equal(resultado.proximo_cobro, '2026-08-15');
  });

  it('el período siguiente se cuenta desde el cobrado, no desde hoy', async () => {
    // Un cobro de mayo que entra hoy deja el acceso esperando junio, no el mes que viene:
    // si no, cada demora se come un mes y a fin de año se cobraron once.
    respuestas.set('GET /rest/v1/accesos_marketplace', () => [
      { id: ACCESO, proximo_cobro: '2026-05-10', formas_de_cobro_marketplace: CADA_MES },
    ]);
    const resultado = await registrarCobroExitoso({ accesoId: ACCESO, periodo: '2026-05-10' });
    assert.equal(resultado.proximo_cobro, '2026-06-10');
  });

  it('un cobro de un período anterior al esperado no mueve la fecha hacia atrás', async () => {
    // Pasa cuando se carga a mano un pago viejo. Correr la fecha hacia atrás le regalaría un
    // período a quien pagó tarde.
    respuestas.set('GET /rest/v1/accesos_marketplace', () => [
      { id: ACCESO, proximo_cobro: '2026-09-01', formas_de_cobro_marketplace: CADA_MES },
    ]);
    const resultado = await registrarCobroExitoso({ accesoId: ACCESO, periodo: '2026-07-01' });
    assert.equal(resultado.proximo_cobro, '2026-10-01');
  });

  it('un acceso sin fecha esperada arranca desde el período cobrado', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', () => [
      { id: ACCESO, proximo_cobro: null, formas_de_cobro_marketplace: CADA_MES },
    ]);
    const resultado = await registrarCobroExitoso({ accesoId: ACCESO, periodo: '2026-03-31' });
    assert.equal(resultado.proximo_cobro, '2026-04-30');
  });

  it('si el acceso no está, se avisa y no se escribe nada', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', () => []);
    const resultado = await registrarCobroExitoso({ accesoId: ACCESO, periodo: PERIODO });

    assert.deepEqual(resultado, { ok: false });
    assert.equal(guardado(), undefined);
    assert.ok(anotados.some((linea) => linea.includes('No se pudo mover el acceso')));
  });

  it('si la escritura falla, se avisa y se contesta que no se pudo', async () => {
    respuestas.delete('PATCH /rest/v1/accesos_marketplace');
    const resultado = await registrarCobroExitoso({ accesoId: ACCESO, periodo: PERIODO });

    assert.deepEqual(resultado, { ok: false });
    assert.ok(anotados.some((linea) => linea.includes('No se pudo mover el acceso')));
  });
});

// ---------------------------------------------------------------------------
// El trabajo diario que le pide a cada riel el cobro del mes
// ---------------------------------------------------------------------------

describe('el trabajo diario que arma los cobros del período', () => {
  it('pide la lista acotada a los vigentes que ya vencieron', async () => {
    base();
    await armarCobrosDelPeriodo();

    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/accesos_marketplace');
    const hoy = new Date().toISOString().slice(0, 10);
    assert.ok(consulta.url.includes('estado=eq.vigente'), 'sólo los accesos vigentes');
    assert.ok(consulta.url.includes('proveedor=not.is.null'), 'sólo los que tienen riel');
    assert.ok(
      consulta.url.includes(`proximo_cobro=lte.${hoy}`),
      'sólo los períodos que ya vencieron'
    );
  });

  it('trae también la forma de cobro, que es la que dice cada cuánto se cobra', async () => {
    base();
    await armarCobrosDelPeriodo();

    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/accesos_marketplace');
    assert.ok(consulta.url.includes('formas_de_cobro_marketplace'));
  });

  it('le pide el QR al riel y guarda el cobro del período pendiente', async () => {
    base();
    await armarCobrosDelPeriodo();

    assert.equal(pedidosAlProveedor.length, 1);
    assert.equal(pedidosAlProveedor[0].ruta, '/pagos/qr');
    assert.equal(pedidosAlProveedor[0].cuerpo.monto, 12500);

    assert.equal(inserciones().length, 1);
    assert.deepEqual(inserciones()[0].cuerpo, {
      acceso_id: ACCESO,
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

  it('la referencia que se le da al proveedor identifica el período, no el acceso', async () => {
    // Es lo que permite que dos períodos de la misma Familia no se confundan cuando vuelven los
    // avisos: con la referencia del acceso, el aviso del segundo período pisaría al del primero.
    base();
    await armarCobrosDelPeriodo();
    assert.equal(pedidosAlProveedor[0].cuerpo.referencia_externa, `${ACCESO}:${PERIODO}`);
  });

  it('el cupón de la red de cobranza vence a los diez días del período', async () => {
    // Sin fecha de vencimiento, un cupón se paga tres meses tarde y el período ya está cerrado.
    base({ accesos: [accesoPorCobrar({ proveedor: 'cobranza_efectivo' })] });
    await armarCobrosDelPeriodo();

    assert.equal(pedidosAlProveedor[0].ruta, '/cupones');
    assert.equal(pedidosAlProveedor[0].cuerpo.fecha_vencimiento, '2026-08-11');
    assert.equal(inserciones()[0].cuerpo.codigo_cupon, '9988-7766');
    assert.equal(inserciones()[0].cuerpo.url_accion, null);
    assert.equal(inserciones()[0].cuerpo.medio, 'cobranza_efectivo');
  });

  it('a los rieles que cobran solos no se les pide nada', async () => {
    // Pedirles el cobro del período crearía un segundo cobro del mismo: uno del lado del
    // proveedor, que ya está andando, y otro acá.
    base({
      accesos: [
        accesoPorCobrar({ proveedor: 'stripe' }),
        accesoPorCobrar({ id: OTRO_ACCESO, proveedor: 'mercadopago' }),
        accesoPorCobrar({ id: '66666666-6666-6666-6666-666666666666', proveedor: 'debin' }),
        accesoPorCobrar({ id: '77777777-7777-7777-7777-777777777777', proveedor: 'efectivo_manual' }),
      ],
    });
    await armarCobrosDelPeriodo();

    assert.deepEqual(pedidosAlProveedor, []);
    assert.deepEqual(inserciones(), []);
  });

  it('no se arma dos veces el mismo período', async () => {
    base({ cobrosExistentes: [{ id: 'cobro-que-ya-estaba', estado_cobro: 'pendiente' }] });
    await armarCobrosDelPeriodo();

    assert.deepEqual(pedidosAlProveedor, [], 'no se le pide al proveedor un QR que habría que tirar');
    assert.deepEqual(inserciones(), []);
  });

  it('tampoco cuando el período ya se cobró y lo que quedó atrasado es la fecha', async () => {
    base({ cobrosExistentes: [{ id: 'cobro-que-ya-entro', estado_cobro: 'exitoso' }] });
    await armarCobrosDelPeriodo();
    assert.deepEqual(inserciones(), []);
  });

  it('pero un período cuyo único cobro quedó fallido se vuelve a armar', async () => {
    base({ cobrosExistentes: [{ id: 'cobro-que-no-entro', estado_cobro: 'fallido' }] });
    await armarCobrosDelPeriodo();

    assert.equal(pedidosAlProveedor.length, 1);
    assert.equal(inserciones().length, 1);
  });

  it('el cobro existente se busca por ese acceso y ese período', async () => {
    base();
    await armarCobrosDelPeriodo();

    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/cobros_marketplace');
    assert.ok(consulta.url.includes(`acceso_id=eq.${ACCESO}`));
    assert.ok(consulta.url.includes(`periodo=eq.${PERIODO}`));
  });

  it('la credencial se lee una vez por Prestadora y riel, no una por acceso', async () => {
    base({
      accesos: [
        accesoPorCobrar(),
        accesoPorCobrar({ id: OTRO_ACCESO }),
        accesoPorCobrar({ id: '66666666-6666-6666-6666-666666666666', prestadora_id: OTRA_PRESTADORA }),
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
      accesos: [
        accesoPorCobrar(),
        accesoPorCobrar({ id: OTRO_ACCESO, prestadora_id: OTRA_PRESTADORA }),
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
    assert.equal(inserciones()[0].cuerpo.acceso_id, OTRO_ACCESO);
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
      accesos: [
        accesoPorCobrar(),
        accesoPorCobrar({ id: OTRO_ACCESO, proveedor: 'cobranza_efectivo' }),
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
    assert.ok(anotados.some((linea) => linea.includes('Error consultando los accesos por cobrar')));
  });

  it('sin nada que cobrar no se toca la caja fuerte', async () => {
    base({ accesos: [] });
    await armarCobrosDelPeriodo();

    assert.deepEqual(lecturasDeCredencial(), []);
    assert.deepEqual(pedidosAlProveedor, []);
  });
});
