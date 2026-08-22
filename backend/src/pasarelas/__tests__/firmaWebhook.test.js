/**
 * Pruebas de la comprobación de firma de los avisos de cobro (pendiente #159).
 *
 * Usan el banco de pruebas que ya trae Node adentro (`node --test`), sin instalar nada:
 * acá no hace falta ni servidor ni base, lo que se prueba es una cuenta —un HMAC— y las
 * cinco formas en que un aviso puede no ser de fiar.
 *
 *   npm test --prefix backend
 *
 * La prueba que más importa de todas es la última de Stripe: la que arma el cuerpo de nuevo
 * a partir del objeto ya leído y muestra que la firma deja de coincidir. Ese es el error que
 * se rompe en silencio —la comprobación queda escrita, se ve bien, y rechaza absolutamente
 * todo— y por eso está probado en vez de recordado.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { createHmac } from 'node:crypto';

import * as stripe from '../stripe.js';
import * as mercadopago from '../mercadopago.js';
import { MOTIVO, TOLERANCIA_SEGUNDOS, esRechazoDeAutenticidad } from '../firmaWebhook.js';

const SECRETO = 'whsec_un_secreto_de_mentira_para_la_prueba';
const AHORA_MS = Date.UTC(2026, 7, 22, 12, 0, 0);
const AHORA_S = Math.floor(AHORA_MS / 1000);

// ---------------------------------------------------------------------------------------
// Stripe
// ---------------------------------------------------------------------------------------

const EVENTO_STRIPE = {
  type: 'invoice.paid',
  data: { object: { id: 'sub_1234567890' } },
};

/** El cuerpo tal cual viajaría por la red, con los espacios que le puso Stripe y no los que
 *  les pondría `JSON.stringify` acá. */
const CRUDO_STRIPE = Buffer.from(JSON.stringify(EVENTO_STRIPE, null, 2), 'utf8');

function firmaStripe(cuerpo, instante = AHORA_S, secreto = SECRETO) {
  return createHmac('sha256', secreto).update(`${instante}.`).update(cuerpo).digest('hex');
}

function avisoStripe({ cabecera, cuerpoCrudo = CRUDO_STRIPE, secretoFirma = SECRETO } = {}) {
  return stripe.verificarWebhook({
    secretoFirma,
    headers: cabecera === undefined ? { 'stripe-signature': `t=${AHORA_S},v1=${firmaStripe(cuerpoCrudo)}` } : cabecera,
    cuerpoCrudo,
    body: JSON.parse(cuerpoCrudo.toString('utf8')),
    ahoraMs: AHORA_MS,
  });
}

describe('Stripe — el aviso de cobro se comprueba antes de creerle', () => {
  it('una firma válida se acepta, y trae la referencia y el estado', () => {
    const resultado = avisoStripe();
    assert.equal(resultado.valido, true);
    assert.equal(resultado.motivo, null);
    assert.equal(resultado.referenciaExterna, 'sub_1234567890');
    assert.equal(resultado.estado, 'exitoso');
  });

  it('una firma inventada se rechaza', () => {
    const resultado = avisoStripe({ cabecera: { 'stripe-signature': `t=${AHORA_S},v1=${'a'.repeat(64)}` } });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, MOTIVO.FIRMA_NO_COINCIDE);
    assert.ok(esRechazoDeAutenticidad(resultado.motivo));
  });

  it('sin cabecera de firma se rechaza', () => {
    const resultado = avisoStripe({ cabecera: {} });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, MOTIVO.CABECERA_AUSENTE);
    assert.ok(esRechazoDeAutenticidad(resultado.motivo));
  });

  it('una cabecera que no se entiende se rechaza, no se adivina', () => {
    const resultado = avisoStripe({ cabecera: { 'stripe-signature': 'firma-cualquiera' } });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, MOTIVO.CABECERA_ILEGIBLE);
  });

  it('un aviso viejo con firma buena se rechaza igual: así no se reenvía uno copiado', () => {
    const viejo = AHORA_S - TOLERANCIA_SEGUNDOS - 1;
    const resultado = avisoStripe({
      cabecera: { 'stripe-signature': `t=${viejo},v1=${firmaStripe(CRUDO_STRIPE, viejo)}` },
    });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, MOTIVO.INSTANTE_VENCIDO);
  });

  it('justo en el borde de la tolerancia todavía se acepta', () => {
    const alFilo = AHORA_S - TOLERANCIA_SEGUNDOS;
    const resultado = avisoStripe({
      cabecera: { 'stripe-signature': `t=${alFilo},v1=${firmaStripe(CRUDO_STRIPE, alFilo)}` },
    });
    assert.equal(resultado.valido, true);
  });

  it('sin secreto guardado se rechaza — nunca se sigue igual', () => {
    const resultado = avisoStripe({ secretoFirma: null });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, MOTIVO.SECRETO_AUSENTE);
    assert.ok(esRechazoDeAutenticidad(resultado.motivo));
  });

  it('sin el cuerpo crudo no hay nada que comprobar y se rechaza', () => {
    const resultado = stripe.verificarWebhook({
      secretoFirma: SECRETO,
      headers: { 'stripe-signature': `t=${AHORA_S},v1=${firmaStripe(CRUDO_STRIPE)}` },
      cuerpoCrudo: null,
      body: EVENTO_STRIPE,
      ahoraMs: AHORA_MS,
    });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, MOTIVO.CUERPO_AUSENTE);
  });

  it('mientras se rota el secreto vienen dos firmas y alcanza con que una dé', () => {
    const cabecera = {
      'stripe-signature': `t=${AHORA_S},v1=${'b'.repeat(64)},v1=${firmaStripe(CRUDO_STRIPE)}`,
    };
    assert.equal(avisoStripe({ cabecera }).valido, true);
  });

  it('el cuerpo rearmado a partir del objeto ya leído NO coincide: por eso se guarda el crudo', () => {
    // Mismos datos, otros bytes: sin los saltos de línea con que viajó. Si la ruta le pasara
    // al adaptador el cuerpo re-serializado en vez del que llegó, esta sería la respuesta de
    // todos los avisos, también los auténticos.
    const rearmado = Buffer.from(JSON.stringify(EVENTO_STRIPE), 'utf8');
    assert.notEqual(rearmado.toString('utf8'), CRUDO_STRIPE.toString('utf8'));
    const resultado = stripe.verificarWebhook({
      secretoFirma: SECRETO,
      headers: { 'stripe-signature': `t=${AHORA_S},v1=${firmaStripe(CRUDO_STRIPE)}` },
      cuerpoCrudo: rearmado,
      body: EVENTO_STRIPE,
      ahoraMs: AHORA_MS,
    });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, MOTIVO.FIRMA_NO_COINCIDE);
  });

  it('firmado de verdad pero sin referencia de cobro adentro: se rechaza, y no por falso', () => {
    const cuerpo = Buffer.from(JSON.stringify({ type: 'invoice.paid', data: { object: {} } }), 'utf8');
    const resultado = stripe.verificarWebhook({
      secretoFirma: SECRETO,
      headers: { 'stripe-signature': `t=${AHORA_S},v1=${firmaStripe(cuerpo)}` },
      cuerpoCrudo: cuerpo,
      body: JSON.parse(cuerpo.toString('utf8')),
      ahoraMs: AHORA_MS,
    });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, MOTIVO.SIN_REFERENCIA);
    assert.equal(esRechazoDeAutenticidad(resultado.motivo), false);
  });
});

// ---------------------------------------------------------------------------------------
// Mercado Pago
// ---------------------------------------------------------------------------------------

const ID_AVISO = '2c938084726fca480172750000000000';
const ID_REQUISITORIA = 'f7a1c2d3-0000-4000-8000-000000000000';
const CUERPO_MP = { type: 'payment', data: { id: ID_AVISO } };
const CRUDO_MP = Buffer.from(JSON.stringify(CUERPO_MP), 'utf8');

function firmaMercadoPago(instante = AHORA_S, id = ID_AVISO, secreto = SECRETO) {
  return createHmac('sha256', secreto)
    .update(`id:${id.toLowerCase()};request-id:${ID_REQUISITORIA};ts:${instante};`)
    .digest('hex');
}

function avisoMercadoPago({ cabecera, consulta, secretoFirma = SECRETO } = {}) {
  return mercadopago.verificarWebhook({
    secretoFirma,
    headers:
      cabecera === undefined
        ? { 'x-signature': `ts=${AHORA_S},v1=${firmaMercadoPago()}`, 'x-request-id': ID_REQUISITORIA }
        : cabecera,
    consulta,
    cuerpoCrudo: CRUDO_MP,
    body: CUERPO_MP,
    ahoraMs: AHORA_MS,
  });
}

describe('Mercado Pago — el aviso de cobro se comprueba antes de creerle', () => {
  it('una firma válida se acepta y trae la referencia', () => {
    const resultado = avisoMercadoPago();
    assert.equal(resultado.valido, true);
    assert.equal(resultado.motivo, null);
    assert.equal(resultado.referenciaExterna, ID_AVISO);
  });

  it('el estado sigue siendo pendiente: la firma dice que es auténtico, no que la plata entró', () => {
    assert.equal(avisoMercadoPago().estado, 'pendiente');
  });

  it('el id firmado es el que viaja en la dirección, que es el que Mercado Pago usó', () => {
    const otroId = 'ABC123DEF456';
    const resultado = mercadopago.verificarWebhook({
      secretoFirma: SECRETO,
      headers: {
        'x-signature': `ts=${AHORA_S},v1=${firmaMercadoPago(AHORA_S, otroId)}`,
        'x-request-id': ID_REQUISITORIA,
      },
      consulta: { 'data.id': otroId },
      cuerpoCrudo: CRUDO_MP,
      body: CUERPO_MP,
      ahoraMs: AHORA_MS,
    });
    assert.equal(resultado.valido, true);
    // Se firma exactamente lo que después se mira: la referencia que sale es la de la
    // dirección, no la del cuerpo, que acá dice otra cosa.
    assert.equal(resultado.referenciaExterna, otroId);
  });

  it('una firma inventada se rechaza', () => {
    const resultado = avisoMercadoPago({
      cabecera: { 'x-signature': `ts=${AHORA_S},v1=${'c'.repeat(64)}`, 'x-request-id': ID_REQUISITORIA },
    });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, MOTIVO.FIRMA_NO_COINCIDE);
  });

  it('sin cabecera de firma se rechaza', () => {
    const resultado = avisoMercadoPago({ cabecera: { 'x-request-id': ID_REQUISITORIA } });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, MOTIVO.CABECERA_AUSENTE);
  });

  it('sin el identificador del envío tampoco se sigue: es un tercio de lo que se firma', () => {
    const resultado = avisoMercadoPago({
      cabecera: { 'x-signature': `ts=${AHORA_S},v1=${firmaMercadoPago()}` },
    });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, MOTIVO.CABECERA_AUSENTE);
  });

  it('un aviso viejo con firma buena se rechaza igual', () => {
    const viejo = AHORA_S - TOLERANCIA_SEGUNDOS - 1;
    const resultado = avisoMercadoPago({
      cabecera: {
        'x-signature': `ts=${viejo},v1=${firmaMercadoPago(viejo)}`,
        'x-request-id': ID_REQUISITORIA,
      },
    });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, MOTIVO.INSTANTE_VENCIDO);
  });

  it('sin secreto guardado se rechaza — nunca se sigue igual', () => {
    const resultado = avisoMercadoPago({ secretoFirma: null });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, MOTIVO.SECRETO_AUSENTE);
  });

  it('una firma calculada con otro secreto no sirve', () => {
    const resultado = avisoMercadoPago({
      cabecera: {
        'x-signature': `ts=${AHORA_S},v1=${firmaMercadoPago(AHORA_S, ID_AVISO, 'otro_secreto')}`,
        'x-request-id': ID_REQUISITORIA,
      },
    });
    assert.equal(resultado.valido, false);
    assert.equal(resultado.motivo, MOTIVO.FIRMA_NO_COINCIDE);
  });
});
