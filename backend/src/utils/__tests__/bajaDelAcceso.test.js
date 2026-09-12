/**
 * La baja en un clic de un acceso del Marketplace.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. La baja es plata que deja de cobrarse, y las tres formas de hacerla
 * mal cuestan cada una de un lado distinto:
 *
 *   * anotar la baja de este lado sin haberla hecho del otro, que deja a alguien dado de baja acá
 *     y cobrado por el proveedor todos los meses;
 *   * cortar el acceso en el acto, cuando el período que la persona ya pagó todavía no terminó;
 *   * y dejar que alguien dé de baja un acceso que no es suyo con sólo saber su identificador.
 *
 * Se levanta la base de mentira y un Stripe de mentira, igual que `altaEnPasarela.test.js`.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const ACCESO = '33333333-3333-3333-3333-333333333333';
const FAMILIA = '44444444-4444-4444-4444-444444444444';
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
    const clave = `${req.method} ${ruta}`;
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
  llamadasAStripe.push({ metodo: req.method, url: req.url });
  req.on('data', () => {});
  req.on('end', () => {
    if (stripeRechaza) {
      res.writeHead(402, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'la cuenta de cobro 1234 está dada de baja' } }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: REFERENCIA_DE_STRIPE, status: 'canceled' }));
  });
});
await new Promise((listo) => stripeFalso.listen(0, '127.0.0.1', listo));
process.env.STRIPE_API_BASE = `http://127.0.0.1:${stripeFalso.address().port}`;

// El import va después de dejar puestas las variables de entorno: tanto la conexión a la base como
// la dirección de cada proveedor se arman en el momento en que se importa el archivo.
const { darDeBajaElAcceso, MOTIVO_BAJA } = await import('../bajaDelAcceso.js');

const avisarDeVerdad = console.error;
console.error = (...partes) => anotados.push(partes.join(' '));

after(() => {
  console.error = avisarDeVerdad;
  baseFalsa.close();
  stripeFalso.close();
});

/** Un acceso vivo: se renueva solo, está dado de alta en Stripe y tiene un período pagado. */
function accesoVivo(cambios = {}) {
  return [
    {
      id: ACCESO,
      prestadora_id: PRESTADORA,
      familia_id: FAMILIA,
      estado: 'vigente',
      proveedor: 'stripe',
      referencia_externa: REFERENCIA_DE_STRIPE,
      alta_en_pasarela: '2026-08-01T10:00:00.000Z',
      cancelada_en: null,
      vigente_hasta: '2026-10-01',
      proximo_cobro: '2026-10-01',
      gratis_hasta: null,
      formas_de_cobro_marketplace: { renueva_sola: true },
      ...cambios,
    },
  ];
}

beforeEach(() => {
  llamadas = [];
  anotados = [];
  llamadasAStripe = [];
  stripeRechaza = false;
  respuestas.clear();
  respuestas.set('GET /rest/v1/accesos_marketplace', () => accesoVivo());
  respuestas.set('PATCH /rest/v1/accesos_marketplace', () => []);
  respuestas.set('POST /rest/v1/rpc/leer_credencial_pasarela_pago', () => CREDENCIAL);
});

const darDeBaja = (extra = {}) => darDeBajaElAcceso({ accesoId: ACCESO, familiaId: FAMILIA, ...extra });

function guardado() {
  return llamadas.find((l) => l.clave === 'PATCH /rest/v1/accesos_marketplace');
}

describe('la baja que sale bien', () => {
  it('le avisa al proveedor y apaga la renovación', async () => {
    const resultado = await darDeBaja();

    assert.equal(resultado.ok, true);
    assert.equal(resultado.yaEstaba, undefined);
    assert.equal(llamadasAStripe.length, 1);
    assert.equal(llamadasAStripe[0].metodo, 'DELETE');
    assert.ok(llamadasAStripe[0].url.includes(REFERENCIA_DE_STRIPE));
    assert.ok(guardado().cuerpo.cancelada_en, 'queda anotado cuándo se dio de baja');
    assert.equal(guardado().cuerpo.proximo_cobro, null);
  });

  it('no corta nada: el período que ya está pagado se conserva entero', async () => {
    // Es el resguardo del §3.2 del PRD. Si la baja tocara el estado o la fecha de vigencia, quien
    // cancela el día después de pagar perdería el mes que acaba de pagar.
    await darDeBaja();
    assert.equal('estado' in guardado().cuerpo, false);
    assert.equal('vigente_hasta' in guardado().cuerpo, false);
  });

  it('devuelve hasta cuándo sigue alcanzando lo que ya se pagó', async () => {
    const resultado = await darDeBaja();
    assert.equal(resultado.baja.vigente_hasta, '2026-10-01');
    assert.equal(resultado.baja.estado, 'vigente');
    assert.ok(resultado.baja.cancelada_en);
  });

  it('sin período cobrado todavía, lo que se muestra es hasta cuándo dura lo gratis', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', () =>
      accesoVivo({ vigente_hasta: null, gratis_hasta: '2026-09-20' })
    );
    const resultado = await darDeBaja();
    assert.equal(resultado.baja.vigente_hasta, '2026-09-20');
  });

  it('lo busca acotado a la Familia, así nadie da de baja el acceso de otra', async () => {
    await darDeBaja();
    const busqueda = llamadas.find((l) => l.clave === 'GET /rest/v1/accesos_marketplace');
    assert.ok(busqueda.url.includes(`familia_id=eq.${FAMILIA}`));
  });

  it('lo que se devuelve no trae nada que haya salido de la caja fuerte', async () => {
    const resultado = await darDeBaja();
    assert.equal(JSON.stringify(resultado).includes(CREDENCIAL), false);
  });

  it('el acceso que nunca llegó a la pasarela se da de baja igual, sin llamar a nadie', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', () =>
      accesoVivo({ proveedor: null, referencia_externa: null, alta_en_pasarela: null })
    );
    const resultado = await darDeBaja();
    assert.equal(resultado.ok, true);
    assert.equal(llamadasAStripe.length, 0);
    assert.ok(guardado().cuerpo.cancelada_en);
  });

  it('el que se cobra en mano no le pide ninguna credencial a la caja fuerte', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', () =>
      accesoVivo({ proveedor: 'efectivo_manual', referencia_externa: 'anotado-a-mano' })
    );
    const resultado = await darDeBaja();
    assert.equal(resultado.ok, true);
    assert.equal(llamadas.some((l) => l.clave.includes('leer_credencial_pasarela_pago')), false);
    assert.ok(guardado().cuerpo.cancelada_en);
  });

  it('la que ya estaba dada de baja se contesta guardada y no vuelve a salir hacia afuera', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', () =>
      accesoVivo({ cancelada_en: '2026-09-01T12:00:00.000Z' })
    );
    const resultado = await darDeBaja();
    assert.equal(resultado.ok, true);
    assert.equal(resultado.yaEstaba, true);
    assert.equal(resultado.baja.cancelada_en, '2026-09-01T12:00:00.000Z');
    assert.equal(llamadasAStripe.length, 0);
    assert.equal(guardado(), undefined);
  });
});

describe('el acceso que no se da de baja', () => {
  it('el que no existe —o es de otra Familia— se contesta y no se llama a nadie', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', () => []);
    const resultado = await darDeBaja();
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, MOTIVO_BAJA.ACCESO_INEXISTENTE);
    assert.equal(llamadasAStripe.length, 0);
    assert.equal(guardado(), undefined);
  });

  it('sin decir de quién es, no se da de baja nada ni se consulta la base', async () => {
    // Una baja sin alcance daría de baja el acceso de cualquiera con sólo saber su identificador.
    const resultado = await darDeBajaElAcceso({ accesoId: ACCESO });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, MOTIVO_BAJA.ACCESO_INEXISTENTE);
    assert.equal(llamadas.length, 0);
  });

  it('una forma que no se renueva sola no tiene nada que apagar', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', () =>
      accesoVivo({ formas_de_cobro_marketplace: { renueva_sola: false } })
    );
    const resultado = await darDeBaja();
    assert.equal(resultado.motivo, MOTIVO_BAJA.FORMA_QUE_NO_SE_RENUEVA);
    assert.equal(llamadasAStripe.length, 0);
    assert.equal(guardado(), undefined);
  });
});

describe('cuando la baja falla en el medio', () => {
  it('si el proveedor rechaza, no se anota nada: se vuelve a intentar', async () => {
    // Es el peor caso posible al revés: dado de baja acá y cobrándose allá todos los meses.
    stripeRechaza = true;
    const resultado = await darDeBaja();
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, MOTIVO_BAJA.PROVEEDOR_RECHAZO);
    assert.equal(guardado(), undefined);
  });

  it('el rechazo del proveedor queda del lado del servidor y no sale en la respuesta', async () => {
    stripeRechaza = true;
    const resultado = await darDeBaja();
    assert.equal(JSON.stringify(resultado).includes('cuenta de cobro 1234'), false);
    assert.ok(anotados.join(' ').includes('cuenta de cobro 1234'));
  });

  it('sin credencial no se le avisa a nadie ni se anota la baja', async () => {
    respuestas.set('POST /rest/v1/rpc/leer_credencial_pasarela_pago', () => null);
    const resultado = await darDeBaja();
    assert.equal(resultado.motivo, MOTIVO_BAJA.SIN_CREDENCIAL);
    assert.equal(llamadasAStripe.length, 0);
    assert.equal(guardado(), undefined);
  });

  it('un riel que el código ya no conoce corta antes de pedir la credencial', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', () =>
      accesoVivo({ proveedor: 'una_pasarela_que_no_existe' })
    );
    const resultado = await darDeBaja();
    assert.equal(resultado.motivo, MOTIVO_BAJA.PROVEEDOR_DESCONOCIDO);
    assert.equal(llamadas.some((l) => l.clave.includes('leer_credencial_pasarela_pago')), false);
    assert.equal(guardado(), undefined);
  });
});
