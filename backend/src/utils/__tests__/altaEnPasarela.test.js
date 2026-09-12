/**
 * El alta de un acceso del Marketplace en la pasarela de cobro.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Las seis pasarelas están escritas desde el primer día y
 * `crearSuscripcion` no la llamaba nadie: un acceso vivía en esta base y no existía del lado de
 * ningún proveedor, así que no había con qué cobrarle. Lo que se agregó es el paso del medio, y lo
 * que se prueba acá no es que ande el camino feliz —eso es lo fácil— sino las siete formas de
 * salir mal, que son las que dejan plata sin cobrar o cobrada de más:
 *
 *   * dar de alta dos veces el mismo acceso, que deja dos cobros recurrentes vivos;
 *   * elegir por la Prestadora con qué riel se le cobra, cuando tiene más de uno conectado;
 *   * marcarlo como dado de alta cuando el proveedor rechazó, que lo deja sin cobrar para siempre
 *     y sin que nadie lo vuelva a intentar;
 *   * dejar que se le cobre a alguien que se dio de baja;
 *   * dejar andando un cobro recurrente por una forma que se cobra una sola vez, que le cobraría
 *     todos los períodos a quien pagó uno;
 *   * devolverle a la pantalla algo que salió de la caja fuerte;
 *   * y cambiarle el estado al acceso, que no es de acá: dar de alta no es cobrar.
 *
 * Se levanta la base de mentira y un Stripe de mentira, igual que `webhooksPasarelas.test.js`.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const ACCESO = '33333333-3333-3333-3333-333333333333';
const FAMILIA = '44444444-4444-4444-4444-444444444444';
const CORREO_DE_LA_FAMILIA = 'familia@sandbox.local';
const CREDENCIAL = 'credencial-de-mentira-que-no-tiene-que-salir';
const REFERENCIA_DE_STRIPE = 'sub_de_mentira';
/** La forma de cobro que armó la Prestadora: cada un mes. Es un dato de ella, no del código. */
const CADA_MES = { periodo_cantidad: 1, periodo_unidad: 'mes' };

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba pisa lo que necesita cambiar. */
const respuestas = new Map();
/** Todo lo que se le pidió a la base, para poder afirmar que NO se pidió algo. */
let llamadas = [];
/** Los avisos que quedaron del lado del servidor. Se juntan para no ensuciar la salida. */
let anotados = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    // El correo de la Familia no está en `usuarios`: vive del lado de las cuentas, y se pide por
    // el identificador metido en la propia dirección. Se junta bajo una sola clave.
    const normalizada = ruta.startsWith('/auth/v1/admin/users/') ? '/auth/v1/admin/users/:id' : ruta;
    const clave = `${req.method} ${normalizada}`;
    llamadas.push({ clave, url: req.url, cuerpo: crudo ? JSON.parse(crudo) : null });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada() : preparada;
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

// Un Stripe de mentira. Alcanza para lo que se prueba: que se lo llame cuando corresponde, que no
// se lo llame cuando no, y qué pasa cuando rechaza.
let stripeRechaza = false;
let llamadasAStripe = [];
/** Lo que se le mandó a cada dirección de Stripe, ya leído como formulario. Se guarda porque hay
 *  algo que mirar ahí: cada cuánto se cobra tiene que llegar como lo dijo la Prestadora. */
let cuerposAStripe = new Map();
const stripeFalso = createServer((req, res) => {
  llamadasAStripe.push(req.url);
  let crudoStripe = '';
  req.on('data', (parte) => {
    crudoStripe += parte;
  });
  req.on('end', () => {
    cuerposAStripe.set(req.url, new URLSearchParams(crudoStripe));

    if (stripeRechaza) {
      res.writeHead(402, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'la cuenta de cobro 1234 está dada de baja' } }));
      return;
    }
    const cuerpo = req.url.includes('/customers')
      ? { id: 'cus_de_mentira' }
      : req.url.includes('/prices')
        ? { id: 'price_de_mentira' }
        : { id: REFERENCIA_DE_STRIPE, status: 'active' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cuerpo));
  });
});
await new Promise((listo) => stripeFalso.listen(0, '127.0.0.1', listo));
process.env.STRIPE_API_BASE = `http://127.0.0.1:${stripeFalso.address().port}`;

// El import va después de dejar puestas las variables de entorno: tanto la conexión a la base como
// la dirección de cada proveedor se arman en el momento en que se importa el archivo.
const { darDeAltaEnPasarela, MOTIVO_ALTA } = await import('../altaEnPasarela.js');

const avisarDeVerdad = console.error;
console.error = (...partes) => anotados.push(partes.join(' '));

after(() => {
  console.error = avisarDeVerdad;
  baseFalsa.close();
  stripeFalso.close();
});

/** El acceso tal como está antes del alta: sin proveedor, sin referencia y sin la marca. */
function accesoSinAlta(cambios = {}) {
  return [
    {
      id: ACCESO,
      prestadora_id: PRESTADORA,
      familia_id: FAMILIA,
      estado: 'vigente',
      importe: 12500,
      moneda: 'ARS',
      proveedor: null,
      referencia_externa: null,
      url_accion: null,
      alta_en_pasarela: null,
      formas_de_cobro_marketplace: CADA_MES,
      ...cambios,
    },
  ];
}

/** La base con todo cargado y un solo riel conectado. */
beforeEach(() => {
  llamadas = [];
  anotados = [];
  llamadasAStripe = [];
  cuerposAStripe = new Map();
  stripeRechaza = false;
  respuestas.clear();
  respuestas.set('GET /rest/v1/accesos_marketplace', () => accesoSinAlta());
  respuestas.set('PATCH /rest/v1/accesos_marketplace', () => []);
  respuestas.set('GET /rest/v1/prestadora_pasarela_pago', () => [{ proveedor: 'stripe' }]);
  respuestas.set('POST /rest/v1/rpc/leer_credencial_pasarela_pago', () => CREDENCIAL);
  respuestas.set('GET /auth/v1/admin/users/:id', () => ({ id: FAMILIA, email: CORREO_DE_LA_FAMILIA }));
});

const darDeAlta = (extra = {}) =>
  darDeAltaEnPasarela({ accesoId: ACCESO, prestadoraId: PRESTADORA, ...extra });

function guardado() {
  return llamadas.find((l) => l.clave === 'PATCH /rest/v1/accesos_marketplace');
}

/** Un día contado desde hoy, en el formato que guarda la base. */
function enDias(dias) {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

describe('el alta que sale bien', () => {
  it('crea el cobro en el proveedor y guarda lo que devolvió', async () => {
    const resultado = await darDeAlta();

    assert.equal(resultado.ok, true);
    assert.equal(resultado.yaEstaba, undefined);
    assert.deepEqual(resultado.alta, {
      proveedor: 'stripe',
      referencia_externa: REFERENCIA_DE_STRIPE,
      url_accion: null,
    });

    assert.equal(guardado().cuerpo.proveedor, 'stripe');
    assert.equal(guardado().cuerpo.referencia_externa, REFERENCIA_DE_STRIPE);
    assert.ok(guardado().cuerpo.alta_en_pasarela, 'queda la marca de que ya está dada de alta');
  });

  it('no le cambia el estado al acceso: dar de alta no es cobrar', async () => {
    // El acceso queda vigente cuando entra la plata del primer período, y eso lo decide
    // `registrarCobroExitoso`. Si el alta lo diera por pagado, una Familia que nunca pagó
    // figuraría al día.
    await darDeAlta();
    assert.equal('estado' in guardado().cuerpo, false);
  });

  it('el alta se guarda acotada a la Prestadora, no sólo al identificador del acceso', async () => {
    await darDeAlta();
    assert.ok(guardado().url.includes(`prestadora_id=eq.${PRESTADORA}`));
  });

  it('lo que se devuelve no trae nada que haya salido de la caja fuerte', async () => {
    const resultado = await darDeAlta();
    assert.equal(JSON.stringify(resultado).includes(CREDENCIAL), false);
  });

  it('lo busca acotado a la Prestadora, así nadie da de alta el acceso de otra', async () => {
    await darDeAlta();
    const busqueda = llamadas.find((l) => l.clave === 'GET /rest/v1/accesos_marketplace');
    assert.ok(busqueda.url.includes(`prestadora_id=eq.${PRESTADORA}`));
  });

  it('le pasa al proveedor cada cuánto cobra, y eso sale de la forma de la Prestadora', async () => {
    // Es lo que hace que la recurrencia sea un dato y no una línea escrita en el adaptador. Con
    // una forma de dos semanas, a Stripe le tiene que llegar «cada 2 semanas» y no «cada 1 mes».
    respuestas.set('GET /rest/v1/accesos_marketplace', () =>
      accesoSinAlta({ formas_de_cobro_marketplace: { periodo_cantidad: 2, periodo_unidad: 'semana' } })
    );

    await darDeAlta();
    const precio = llamadasAStripe.find((url) => url.includes('/prices'));
    assert.ok(precio, 'se le pidió un precio a Stripe');
    const cuerpo = cuerposAStripe.get(precio);
    assert.equal(cuerpo.get('recurring[interval]'), 'week');
    assert.equal(cuerpo.get('recurring[interval_count]'), '2');
  });

  it('guarda el período gratuito que armó la Prestadora, y el primer cobro al final de él', async () => {
    // `dias_gratis` era un dato que la Prestadora cargaba y que no leía nadie: el período
    // gratuito no existía. Las dos fechas se escriben acá porque acá empieza, y para que la
    // activación del lado de la Familia no tenga que volver a contarlos por su cuenta.
    respuestas.set('GET /rest/v1/accesos_marketplace', () =>
      accesoSinAlta({ formas_de_cobro_marketplace: { ...CADA_MES, dias_gratis: 14 } })
    );

    await darDeAlta();

    assert.equal(guardado().cuerpo.gratis_hasta, enDias(14));
    assert.equal(guardado().cuerpo.proximo_cobro, enDias(14));
  });

  it('sin días gratis el primer cobro es hoy, y no hay período gratuito que guardar', async () => {
    await darDeAlta();

    assert.equal(guardado().cuerpo.gratis_hasta, null);
    assert.equal(guardado().cuerpo.proximo_cobro, enDias(0));
  });

  it('le dice al proveedor hasta cuándo no cobrar, no sólo lo guarda de este lado', async () => {
    // Guardarlo acá y no decírselo al riel que cobra solo sería el cobro silencioso del §3.2: la
    // Familia leería «gratis hasta el 30» en la pantalla y Stripe le cobraría hoy.
    respuestas.set('GET /rest/v1/accesos_marketplace', () =>
      accesoSinAlta({ formas_de_cobro_marketplace: { ...CADA_MES, dias_gratis: 14 } })
    );

    await darDeAlta();

    const suscripcion = llamadasAStripe.find((url) => url.includes('/subscriptions'));
    const enviado = cuerposAStripe.get(suscripcion).get('trial_end');
    assert.equal(new Date(Number(enviado) * 1000).toISOString().slice(0, 10), enDias(14));
  });

  it('pide los días gratis junto con el acceso, en la misma consulta', async () => {
    await darDeAlta();
    const busqueda = llamadas.find((l) => l.clave === 'GET /rest/v1/accesos_marketplace');
    assert.ok(busqueda.url.includes('dias_gratis'));
  });

  it('pide la forma de cobro junto con el acceso, en la misma consulta', async () => {
    await darDeAlta();
    const busqueda = llamadas.find((l) => l.clave === 'GET /rest/v1/accesos_marketplace');
    assert.ok(busqueda.url.includes('formas_de_cobro_marketplace'));
  });
});

describe('el acceso que no se puede dar de alta', () => {
  it('la que no existe —o es de otra Prestadora— se contesta y no se llama a nadie', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', () => []);
    const resultado = await darDeAlta();
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, MOTIVO_ALTA.ACCESO_INEXISTENTE);
    assert.equal(llamadasAStripe.length, 0);
    assert.equal(guardado(), undefined);
  });

  it('el cancelado no se da de alta: sería empezar a cobrarle a quien se dio de baja', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', () => accesoSinAlta({ estado: 'cancelada' }));
    const resultado = await darDeAlta();
    assert.equal(resultado.motivo, MOTIVO_ALTA.ACCESO_CANCELADO);
    assert.equal(llamadasAStripe.length, 0);
    assert.equal(guardado(), undefined);
  });

  it('el de una forma que se cobra una sola vez no se da de alta en un cobro recurrente', async () => {
    // Dejar andando la recurrencia por una forma sin período le cobraría todos los períodos a
    // quien pagó uno. Lo que sostiene ese acceso es un saldo o una fecha, no la pasarela.
    respuestas.set('GET /rest/v1/accesos_marketplace', () =>
      accesoSinAlta({ formas_de_cobro_marketplace: { periodo_cantidad: null, periodo_unidad: null } })
    );
    const resultado = await darDeAlta();
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, MOTIVO_ALTA.FORMA_SIN_PERIODO);
    assert.equal(llamadasAStripe.length, 0);
    assert.equal(guardado(), undefined);
  });

  it('el que ya estaba dado de alta se contesta con lo guardado y no se vuelve a crear', async () => {
    // Volver a crearla dejaría dos cobros recurrentes vivos por la misma Familia, y del segundo
    // no se enteraría nadie hasta que llegue el resumen.
    respuestas.set('GET /rest/v1/accesos_marketplace', () =>
      accesoSinAlta({
        proveedor: 'stripe',
        referencia_externa: 'sub_de_la_vez_anterior',
        alta_en_pasarela: '2026-09-01T10:00:00.000Z',
      })
    );

    const resultado = await darDeAlta();
    assert.equal(resultado.ok, true);
    assert.equal(resultado.yaEstaba, true);
    assert.equal(resultado.alta.referencia_externa, 'sub_de_la_vez_anterior');
    assert.equal(llamadasAStripe.length, 0);
    assert.equal(guardado(), undefined);
  });
});

describe('con qué riel se cobra', () => {
  it('con uno solo conectado se resuelve solo, sin preguntarle a nadie', async () => {
    const resultado = await darDeAlta();
    assert.equal(resultado.alta.proveedor, 'stripe');
  });

  it('con más de uno conectado no se elige por la Prestadora: se devuelve la lista', async () => {
    // Elegir por ella cuál de varios sería decidir con qué cobra, y eso no lo decide el producto.
    respuestas.set('GET /rest/v1/prestadora_pasarela_pago', () => [
      { proveedor: 'stripe' },
      { proveedor: 'mercadopago' },
    ]);

    const resultado = await darDeAlta();
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, MOTIVO_ALTA.VARIAS_PASARELAS_CONECTADAS);
    assert.deepEqual(resultado.conectados, ['stripe', 'mercadopago']);
    assert.equal(llamadasAStripe.length, 0);
  });

  it('con más de uno conectado y el riel elegido, se da de alta en ése', async () => {
    respuestas.set('GET /rest/v1/prestadora_pasarela_pago', () => [
      { proveedor: 'stripe' },
      { proveedor: 'mercadopago' },
    ]);
    const resultado = await darDeAlta({ proveedor: 'stripe' });
    assert.equal(resultado.ok, true);
    assert.equal(resultado.alta.proveedor, 'stripe');
  });

  it('un riel que la Prestadora no tiene conectado se rechaza', async () => {
    const resultado = await darDeAlta({ proveedor: 'debin' });
    assert.equal(resultado.motivo, MOTIVO_ALTA.PASARELA_NO_CONECTADA);
    assert.equal(llamadasAStripe.length, 0);
  });

  it('sin ninguno conectado no hay alta posible', async () => {
    respuestas.set('GET /rest/v1/prestadora_pasarela_pago', () => []);
    const resultado = await darDeAlta();
    assert.equal(resultado.motivo, MOTIVO_ALTA.SIN_PASARELA_CONECTADA);
    assert.equal(llamadasAStripe.length, 0);
  });

  it('un riel guardado que el código ya no conoce no cuenta como conectado', async () => {
    // Si contara, se resolvería «solo» hacia un nombre que `obtenerAdaptador` no tiene, y el alta
    // fallaría más adelante diciendo cualquier otra cosa.
    respuestas.set('GET /rest/v1/prestadora_pasarela_pago', () => [{ proveedor: 'un_riel_de_antes' }]);
    const resultado = await darDeAlta();
    assert.equal(resultado.motivo, MOTIVO_ALTA.SIN_PASARELA_CONECTADA);
  });

  it('el efectivo en mano no le pide ninguna credencial a la caja fuerte', async () => {
    // No hay proveedor de por medio: la credencial no existe, y pedirla haría fallar el alta del
    // único riel que no necesita ninguna.
    respuestas.set('GET /rest/v1/prestadora_pasarela_pago', () => [{ proveedor: 'efectivo_manual' }]);
    const resultado = await darDeAlta();

    assert.equal(resultado.ok, true);
    assert.equal(resultado.alta.proveedor, 'efectivo_manual');
    const lecturas = llamadas.filter((l) => l.clave === 'POST /rest/v1/rpc/leer_credencial_pasarela_pago');
    assert.deepEqual(lecturas, []);
  });
});

describe('lo que falta antes de poder cobrar', () => {
  it('sin credencial guardada no se llama al proveedor', async () => {
    respuestas.set('POST /rest/v1/rpc/leer_credencial_pasarela_pago', () => null);
    const resultado = await darDeAlta();
    assert.equal(resultado.motivo, MOTIVO_ALTA.SIN_CREDENCIAL);
    assert.equal(llamadasAStripe.length, 0);
    assert.equal(guardado(), undefined);
  });

  it('sin correo de la Familia tampoco: no hay adónde mandarle el comprobante', async () => {
    respuestas.set('GET /auth/v1/admin/users/:id', () => ({ id: FAMILIA, email: null }));
    const resultado = await darDeAlta();
    assert.equal(resultado.motivo, MOTIVO_ALTA.SIN_CORREO_DE_FAMILIA);
    assert.equal(llamadasAStripe.length, 0);
    assert.equal(guardado(), undefined);
  });

  it('el correo se pide por el identificador de la Familia de ese acceso', async () => {
    await darDeAlta();
    const pedido = llamadas.find((l) => l.clave === 'GET /auth/v1/admin/users/:id');
    assert.ok(pedido.url.includes(FAMILIA));
  });
});

describe('cuando el proveedor rechaza', () => {
  it('no queda la marca de alta puesta: si no, nadie la volvería a intentar', async () => {
    // Es el caso que deja un acceso sin cobrar para siempre. Sin `alta_en_pasarela`, el próximo
    // intento lo crea de nuevo.
    stripeRechaza = true;
    const resultado = await darDeAlta();

    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, MOTIVO_ALTA.PROVEEDOR_RECHAZO);
    assert.equal(guardado(), undefined);
  });

  it('lo que dijo el proveedor queda del lado del servidor y no viaja en la respuesta', async () => {
    // El texto crudo puede nombrar la cuenta de cobro (`celtatech\CLAUDE.md` §6).
    stripeRechaza = true;
    const resultado = await darDeAlta();
    assert.equal(JSON.stringify(resultado).includes('1234'), false);
    assert.ok(anotados.some((linea) => linea.includes('La pasarela rechazó el alta')));
  });

  it('si el alta se creó y no se pudo guardar, queda avisado y sin la marca', async () => {
    // Acá el acceso existe en el proveedor y no de este lado. Lo que corresponde es que se pueda
    // volver a intentar, y que quede registrado porque es plata.
    respuestas.delete('PATCH /rest/v1/accesos_marketplace');
    const resultado = await darDeAlta();

    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, MOTIVO_ALTA.NO_SE_PUDO_GUARDAR);
    assert.ok(anotados.some((linea) => linea.includes('Acceso creado en la pasarela y no guardado')));
  });
});
