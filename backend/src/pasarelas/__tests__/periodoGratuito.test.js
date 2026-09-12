/**
 * El período gratuito en los rieles que cobran solos.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Stripe y Mercado Pago dejan el cobro andando de su lado, y por
 * omisión los dos cobran el primer período apenas se crea la suscripción. Si el alta no se los
 * dice, el período gratuito que armó la Prestadora queda escrito en esta base y en ningún otro
 * lado: la Familia ve «gratis hasta el 30» y le cobran hoy. Es exactamente el cobro silencioso que
 * el §3.2 del `docs/PRD_07_Modalidad_Marketplace.md` prohíbe, y no se ve leyendo el código de acá,
 * porque lo que decide es qué campo viaja hacia afuera.
 *
 * Y la otra mitad: una fecha vencida no se manda. Los dos proveedores rechazan el alta entera por
 * eso, y rechazar el alta por un período gratuito que ya terminó sería perder el acceso por querer
 * regalar días que ya no quedan.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const ACCESO = '33333333-3333-3333-3333-333333333333';
const CREDENCIAL = 'credencial-de-mentira';
const CADA_MES = { cantidad: 1, unidad: 'mes' };
const CORREO = 'familia@sandbox.local';

/** Lo que recibió cada proveedor: la dirección y el cuerpo, ya interpretado. */
let recibidoPorStripe = new Map();
let recibidoPorMercadoPago = [];

const stripeFalso = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    recibidoPorStripe.set(req.url, new URLSearchParams(crudo));
    const cuerpo = req.url.includes('/customers')
      ? { id: 'cus_de_mentira' }
      : req.url.includes('/prices')
        ? { id: 'price_de_mentira' }
        : { id: 'sub_de_mentira', status: 'active' };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cuerpo));
  });
});

const mercadoPagoFalso = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    recibidoPorMercadoPago.push(JSON.parse(crudo));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'preapproval_de_mentira', status: 'pending', init_point: 'https://mp/ir' }));
  });
});

await new Promise((listo) => stripeFalso.listen(0, '127.0.0.1', listo));
await new Promise((listo) => mercadoPagoFalso.listen(0, '127.0.0.1', listo));
process.env.STRIPE_API_BASE = `http://127.0.0.1:${stripeFalso.address().port}`;
process.env.MERCADOPAGO_API_BASE = `http://127.0.0.1:${mercadoPagoFalso.address().port}`;

// El import va después: cada adaptador se queda con la dirección de su proveedor en el momento en
// que se lo importa.
const stripe = await import('../stripe.js');
const mercadopago = await import('../mercadopago.js');

after(() => {
  stripeFalso.close();
  mercadoPagoFalso.close();
});

function corrido(dias) {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

const DENTRO_DE_DOS_SEMANAS = corrido(14);
const AYER = corrido(-1);

const loComun = {
  credencial: CREDENCIAL,
  accesoId: ACCESO,
  monto: 12500,
  moneda: 'ARS',
  periodo: CADA_MES,
  emailPagador: CORREO,
};

/** Lo que Stripe recibió al crear la suscripción — no el cliente ni el precio. */
function suscripcionDeStripe() {
  const url = [...recibidoPorStripe.keys()].find((u) => u.includes('/subscriptions'));
  return recibidoPorStripe.get(url);
}

beforeEach(() => {
  recibidoPorStripe = new Map();
  recibidoPorMercadoPago = [];
});

describe('Stripe', () => {
  it('le dice hasta cuándo no cobrar', async () => {
    await stripe.crearSuscripcion({ ...loComun, gratisHasta: DENTRO_DE_DOS_SEMANAS });

    const enviado = suscripcionDeStripe().get('trial_end');
    assert.ok(enviado, 'la suscripción viaja con el fin de la prueba gratis');
    // Stripe lo quiere en segundos desde 1970, y tiene que ser exactamente ese día.
    assert.equal(
      new Date(Number(enviado) * 1000).toISOString().slice(0, 10),
      DENTRO_DE_DOS_SEMANAS
    );
  });

  it('sin período gratuito no manda nada: cobra desde el primer día', async () => {
    await stripe.crearSuscripcion({ ...loComun, gratisHasta: null });

    assert.equal(suscripcionDeStripe().has('trial_end'), false);
  });

  it('una fecha que ya pasó no se manda', async () => {
    // Stripe rechaza el alta entera por un `trial_end` vencido, y lo que corresponde ahí es cobrar
    // ya, que es justo lo que hace sin la marca.
    await stripe.crearSuscripcion({ ...loComun, gratisHasta: AYER });

    assert.equal(suscripcionDeStripe().has('trial_end'), false);
  });
});

describe('Mercado Pago', () => {
  it('le dice desde cuándo empezar a cobrar', async () => {
    await mercadopago.crearSuscripcion({ ...loComun, gratisHasta: DENTRO_DE_DOS_SEMANAS });

    const recurrente = recibidoPorMercadoPago[0].auto_recurring;
    assert.ok(recurrente.start_date, 'el cobro recurrente viaja con su fecha de comienzo');
    assert.equal(recurrente.start_date.slice(0, 10), DENTRO_DE_DOS_SEMANAS);
    // Y lo demás del cobro recurrente sigue estando: el período gratuito se suma, no reemplaza.
    assert.equal(recurrente.transaction_amount, 12500);
    assert.equal(recurrente.currency_id, 'ARS');
  });

  it('sin período gratuito no manda nada: cobra desde el primer día', async () => {
    await mercadopago.crearSuscripcion({ ...loComun, gratisHasta: null });

    assert.equal('start_date' in recibidoPorMercadoPago[0].auto_recurring, false);
  });

  it('una fecha que ya pasó no se manda', async () => {
    await mercadopago.crearSuscripcion({ ...loComun, gratisHasta: AYER });

    assert.equal('start_date' in recibidoPorMercadoPago[0].auto_recurring, false);
  });
});
