/**
 * El alta de una suscripción del Marketplace en la pasarela de cobro (paso 5 del plan).
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Las seis pasarelas están escritas desde el primer día y
 * `crearSuscripcion` no la llamaba nadie: una suscripción vivía en esta base y no existía del lado
 * de ningún proveedor, así que no había con qué cobrarle. Lo que se agregó es el paso del medio, y
 * lo que se prueba acá no es que ande el camino feliz —eso es lo fácil— sino las seis formas de
 * salir mal, que son las que dejan plata sin cobrar o cobrada dos veces:
 *
 *   * dar de alta dos veces la misma suscripción, que deja dos cobros recurrentes vivos;
 *   * elegir por la Prestadora con qué riel se le cobra, cuando tiene más de uno conectado;
 *   * marcarla como dada de alta cuando el proveedor rechazó, que la deja sin cobrar para siempre
 *     y sin que nadie la vuelva a intentar;
 *   * dejar que se le cobre a alguien que se dio de baja;
 *   * devolverle a la pantalla algo que salió de la caja fuerte;
 *   * y cambiarle el estado a la suscripción, que no es de acá: dar de alta no es cobrar.
 *
 * Se levanta la base de mentira y un Stripe de mentira, igual que `webhooksPasarelas.test.js`.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const SUSCRIPCION = '33333333-3333-3333-3333-333333333333';
const FAMILIA = '44444444-4444-4444-4444-444444444444';
const CORREO_DE_LA_FAMILIA = 'familia@sandbox.local';
const CREDENCIAL = 'credencial-de-mentira-que-no-tiene-que-salir';
const REFERENCIA_DE_STRIPE = 'sub_de_mentira';

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
const stripeFalso = createServer((req, res) => {
  llamadasAStripe.push(req.url);
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

/** La suscripción tal como está antes del alta: sin proveedor, sin referencia y sin la marca. */
function suscripcionSinAlta(cambios = {}) {
  return [
    {
      id: SUSCRIPCION,
      prestadora_id: PRESTADORA,
      familia_id: FAMILIA,
      estado: 'trial',
      monto_mensual: 12500,
      moneda: 'ARS',
      proveedor: null,
      referencia_externa: null,
      url_accion: null,
      alta_en_pasarela: null,
      ...cambios,
    },
  ];
}

/** La base con todo cargado y un solo riel conectado. */
beforeEach(() => {
  llamadas = [];
  anotados = [];
  llamadasAStripe = [];
  stripeRechaza = false;
  respuestas.clear();
  respuestas.set('GET /rest/v1/suscripciones_marketplace', () => suscripcionSinAlta());
  respuestas.set('PATCH /rest/v1/suscripciones_marketplace', () => []);
  respuestas.set('GET /rest/v1/prestadora_pasarela_pago', () => [{ proveedor: 'stripe' }]);
  respuestas.set('POST /rest/v1/rpc/leer_credencial_pasarela_pago', () => CREDENCIAL);
  respuestas.set('GET /auth/v1/admin/users/:id', () => ({ id: FAMILIA, email: CORREO_DE_LA_FAMILIA }));
});

const darDeAlta = (extra = {}) =>
  darDeAltaEnPasarela({ suscripcionId: SUSCRIPCION, prestadoraId: PRESTADORA, ...extra });

function guardado() {
  return llamadas.find((l) => l.clave === 'PATCH /rest/v1/suscripciones_marketplace');
}

describe('el alta que sale bien', () => {
  it('crea la suscripción en el proveedor y guarda lo que devolvió', async () => {
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

  it('no le cambia el estado a la suscripción: dar de alta no es cobrar', async () => {
    // La suscripción pasa a `activa` cuando entra la plata del primer período, y eso lo decide
    // `registrarCobroExitoso`. Si el alta la activara, una Familia que nunca pagó figuraría al día.
    await darDeAlta();
    assert.equal('estado' in guardado().cuerpo, false);
  });

  it('el alta se guarda acotada a la Prestadora, no sólo al identificador de la suscripción', async () => {
    await darDeAlta();
    assert.ok(guardado().url.includes(`prestadora_id=eq.${PRESTADORA}`));
  });

  it('lo que se devuelve no trae nada que haya salido de la caja fuerte', async () => {
    const resultado = await darDeAlta();
    assert.equal(JSON.stringify(resultado).includes(CREDENCIAL), false);
  });

  it('la busca acotada a la Prestadora, así nadie da de alta la suscripción de otra', async () => {
    await darDeAlta();
    const busqueda = llamadas.find((l) => l.clave === 'GET /rest/v1/suscripciones_marketplace');
    assert.ok(busqueda.url.includes(`prestadora_id=eq.${PRESTADORA}`));
  });
});

describe('la suscripción que no se puede dar de alta', () => {
  it('la que no existe —o es de otra Prestadora— se contesta y no se llama a nadie', async () => {
    respuestas.set('GET /rest/v1/suscripciones_marketplace', () => []);
    const resultado = await darDeAlta();
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, MOTIVO_ALTA.SUSCRIPCION_INEXISTENTE);
    assert.equal(llamadasAStripe.length, 0);
    assert.equal(guardado(), undefined);
  });

  it('la cancelada no se da de alta: sería empezar a cobrarle a quien se dio de baja', async () => {
    respuestas.set('GET /rest/v1/suscripciones_marketplace', () => suscripcionSinAlta({ estado: 'cancelada' }));
    const resultado = await darDeAlta();
    assert.equal(resultado.motivo, MOTIVO_ALTA.SUSCRIPCION_CANCELADA);
    assert.equal(llamadasAStripe.length, 0);
    assert.equal(guardado(), undefined);
  });

  it('la que ya estaba dada de alta se contesta con lo guardado y no se vuelve a crear', async () => {
    // Volver a crearla dejaría dos cobros recurrentes vivos por la misma Familia, y del segundo
    // no se enteraría nadie hasta que llegue el resumen.
    respuestas.set('GET /rest/v1/suscripciones_marketplace', () =>
      suscripcionSinAlta({
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

  it('el correo se pide por el identificador de la Familia de esa suscripción', async () => {
    await darDeAlta();
    const pedido = llamadas.find((l) => l.clave === 'GET /auth/v1/admin/users/:id');
    assert.ok(pedido.url.includes(FAMILIA));
  });
});

describe('cuando el proveedor rechaza', () => {
  it('no queda la marca de alta puesta: si no, nadie la volvería a intentar', async () => {
    // Es el caso que deja una suscripción sin cobrar para siempre. Sin `alta_en_pasarela`, el
    // próximo intento la crea de nuevo.
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
    // Acá la suscripción existe en el proveedor y no de este lado. Lo que corresponde es que se
    // pueda volver a intentar, y que quede registrado porque es plata.
    respuestas.delete('PATCH /rest/v1/suscripciones_marketplace');
    const resultado = await darDeAlta();

    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, MOTIVO_ALTA.NO_SE_PUDO_GUARDAR);
    assert.ok(anotados.some((linea) => linea.includes('Suscripción creada en la pasarela y no guardada')));
  });
});
