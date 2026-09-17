/**
 * La puerta por la que el software de facturación avisa lo que emitió.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Es una dirección pública: la llama un software de afuera, sin
 * sesión. Lo único que separa un aviso de verdad de uno inventado es la firma, y lo único que
 * separa una Prestadora de otra es el filtro escrito en la consulta. Cinco agujeros que tapa:
 *
 *  1. Que entre un aviso sin firma, con una firma que no da, o cuando esa Prestadora todavía no
 *     cargó ningún secreto.
 *  2. Que el secreto de una Prestadora sirva para escribir sobre una factura de otra.
 *  3. Que una factura ya facturada se pise. El mismo aviso repetido tiene que no hacer nada.
 *  4. Que un identificador mal escrito llegue hasta la base.
 *  5. Que la respuesta, o el rechazo, cuente algo de la base.
 *
 * Se levanta el router de verdad contra una base de mentira y se mira qué contesta y qué escribe.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const OTRA_PRESTADORA = '99999999-9999-9999-9999-999999999999';
const FACTURA = '60000000-0000-4000-8000-000000000001';
const SECRETO = 'un-secreto-largo-de-mas-de-32-caracteres';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, con los filtros de la dirección incluidos. */
let llamadas = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const direccion = new URL(req.url, 'http://interno');
    const clave = `${req.method} ${direccion.pathname}`;
    llamadas.push({
      clave,
      filtros: direccion.searchParams,
      cuerpo: crudo ? JSON.parse(crudo) : null,
    });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada(direccion.searchParams, crudo) : preparada;
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

// El import va después de dejar puestas las variables de entorno: la conexión a la base se arma
// en el momento en que se importa, y con la dirección que haya en ese instante.
const { default: express } = await import('express');
await import('express-async-errors');
const { avisoDeFacturacionExternaRouter } = await import('../avisoDeFacturacionExterna.js');

const app = express();
// Montado como en `server.js`: antes de cualquier lector de JSON general, porque la firma se
// calcula sobre los bytes exactos que llegaron.
app.use('/api/avisos-de-facturacion', avisoDeFacturacionExternaRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/avisos-de-facturacion`;

after(() => {
  motor.close();
  baseFalsa.close();
});

/** La cabecera que arma un software que conoce el secreto, igual que la de las pasarelas. */
function firmaDe(cuerpo, secreto = SECRETO, instante = Math.floor(Date.now() / 1000)) {
  const firma = createHmac('sha256', secreto).update(`${instante}.`).update(cuerpo).digest('hex');
  return `ts=${instante},v1=${firma}`;
}

async function avisar(cuerpo, { firma, prestadora = PRESTADORA } = {}) {
  const texto = JSON.stringify(cuerpo);
  const cabeceras = { 'Content-Type': 'application/json' };
  if (firma !== null) cabeceras['x-signature'] = firma ?? firmaDe(texto);
  const respuesta = await fetch(`${DIRECCION}/${prestadora}`, {
    method: 'POST',
    headers: cabeceras,
    body: texto,
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** Lo que el motor escribió en la factura, o `undefined` si no escribió nada. */
function loEscrito() {
  return llamadas.find((l) => l.clave === 'PATCH /rest/v1/facturas_familia')?.cuerpo;
}

const AVISO = {
  factura_id: FACTURA,
  comprobante_tipo: 'Factura B',
  comprobante_numero: '0001-00000123',
  monto_facturado: 1500,
};

let facturaEnLaBase = { id: FACTURA, facturado_at: null };
let secretoCargado = SECRETO;

beforeEach(() => {
  llamadas = [];
  facturaEnLaBase = { id: FACTURA, facturado_at: null };
  secretoCargado = SECRETO;
  respuestas.clear();
  respuestas.set('POST /rest/v1/rpc/leer_secreto_del_aviso_de_facturacion', () => secretoCargado);
  respuestas.set('GET /rest/v1/facturas_familia', (filtros) =>
    // La base sólo devuelve lo que pide el filtro: si la consulta no lleva escrito el filtro de
    // Prestadora, esta prueba no lo detectaría, así que se mira aparte más abajo.
    filtros.get('id') === `eq.${FACTURA}` && facturaEnLaBase ? [facturaEnLaBase] : []
  );
  respuestas.set('PATCH /rest/v1/facturas_familia', () => []);
});

// ---------------------------------------------------------------------------------------

describe('sin firma no entra nada', () => {
  it('el aviso sin cabecera de firma se rechaza y no escribe', async () => {
    const { estado } = await avisar(AVISO, { firma: null });
    assert.equal(estado, 401);
    assert.equal(loEscrito(), undefined, 'dijo que no y escribió igual');
  });

  it('una firma calculada con otro secreto no entra', async () => {
    const { estado } = await avisar(AVISO, { firma: firmaDe(JSON.stringify(AVISO), 'otro-secreto') });
    assert.equal(estado, 401);
    assert.equal(loEscrito(), undefined);
  });

  it('una firma de hace horas no entra', async () => {
    const vieja = Math.floor(Date.now() / 1000) - 60 * 60 * 5;
    const { estado } = await avisar(AVISO, { firma: firmaDe(JSON.stringify(AVISO), SECRETO, vieja) });
    assert.equal(estado, 401);
    assert.equal(loEscrito(), undefined);
  });

  it('sin secreto cargado no entra ningún aviso, aunque venga firmado', async () => {
    secretoCargado = null;
    const { estado } = await avisar(AVISO);
    assert.equal(estado, 401);
    assert.equal(loEscrito(), undefined);
  });

  it('una Prestadora que no tiene forma de identificador se corta antes de tocar la base', async () => {
    const { estado } = await avisar(AVISO, { prestadora: 'la-de-siempre' });
    assert.equal(estado, 401);
    assert.equal(llamadas.length, 0, 'le preguntó a la base por algo que no es un identificador');
  });

  it('el rechazo no cuenta cuál de las comprobaciones falló', async () => {
    const sinFirma = await avisar(AVISO, { firma: null });
    const conOtroSecreto = await avisar(AVISO, { firma: firmaDe(JSON.stringify(AVISO), 'otro') });
    assert.deepEqual(sinFirma.cuerpo, conOtroSecreto.cuerpo);
    noFiltraLaBase(sinFirma.cuerpo);
  });
});

describe('el aviso firmado se anota', () => {
  it('guarda el comprobante, su número y el monto que informó quien emitió', async () => {
    const { estado, cuerpo } = await avisar(AVISO);
    assert.equal(estado, 200);
    assert.equal(cuerpo.anotadas, 1);
    assert.equal(loEscrito().comprobante_tipo, 'Factura B');
    assert.equal(loEscrito().comprobante_numero, '0001-00000123');
    assert.equal(loEscrito().monto_facturado, 1500);
    assert.ok(loEscrito().facturado_at, 'no quedó anotado cuándo se facturó');
  });

  it('no pisa el vencimiento acordado cuando el aviso no informa ninguno', async () => {
    await avisar(AVISO);
    assert.equal('fecha_vencimiento' in loEscrito(), false);
  });

  it('lo escribe sólo sobre una factura de esa Prestadora', async () => {
    await avisar(AVISO);
    const escritura = llamadas.find((l) => l.clave === 'PATCH /rest/v1/facturas_familia');
    assert.equal(escritura.filtros.get('prestadora_id'), `eq.${PRESTADORA}`);
    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/facturas_familia');
    assert.equal(consulta.filtros.get('prestadora_id'), `eq.${PRESTADORA}`);
  });

  it('atiende varias facturas en el mismo aviso', async () => {
    const { cuerpo } = await avisar({ facturas: [AVISO, AVISO] });
    // La segunda es la misma factura repetida adentro del mismo aviso: se anota una sola vez.
    assert.equal(cuerpo.anotadas, 1);
    assert.equal(cuerpo.ya_facturadas, 1);
  });
});

describe('lo que no se toca', () => {
  it('una factura que ya tiene comprobante anotado no se pisa', async () => {
    facturaEnLaBase = { id: FACTURA, facturado_at: '2026-09-10T10:00:00Z' };
    const { estado, cuerpo } = await avisar(AVISO);
    assert.equal(estado, 200);
    assert.equal(cuerpo.ya_facturadas, 1);
    assert.equal(loEscrito(), undefined, 'pisó una factura ya emitida');
  });

  it('una factura que no es de esa Prestadora se rechaza como si no existiera', async () => {
    facturaEnLaBase = null;
    const { cuerpo } = await avisar(AVISO, { prestadora: OTRA_PRESTADORA });
    assert.equal(cuerpo.rechazadas, 1);
    assert.equal(cuerpo.resultados[0].motivo, 'no_encontrada');
    assert.equal(loEscrito(), undefined);
  });

  it('un identificador mal escrito no llega hasta la base', async () => {
    const { cuerpo } = await avisar({ ...AVISO, factura_id: '0001-00000123' });
    assert.equal(cuerpo.rechazadas, 1);
    assert.equal(cuerpo.resultados[0].motivo, 'factura_id');
    assert.equal(
      llamadas.some((l) => l.clave === 'GET /rest/v1/facturas_familia'),
      false,
      'le preguntó a la base por algo que no es un identificador'
    );
  });

  it('un aviso sin el nombre del comprobante se rechaza diciendo cuál es el dato', async () => {
    const { cuerpo } = await avisar({ ...AVISO, comprobante_tipo: '' });
    assert.equal(cuerpo.rechazadas, 1);
    assert.equal(cuerpo.resultados[0].motivo, 'comprobante_tipo');
    assert.equal(loEscrito(), undefined);
  });

  it('un renglón malo no impide que se anoten los demás', async () => {
    const { cuerpo } = await avisar({
      facturas: [{ ...AVISO, factura_id: 'cualquier-cosa' }, AVISO],
    });
    assert.equal(cuerpo.rechazadas, 1);
    assert.equal(cuerpo.anotadas, 1);
  });

  it('la respuesta no cuenta nada de la base', async () => {
    const { cuerpo } = await avisar({ ...AVISO, comprobante_tipo: '' });
    noFiltraLaBase(cuerpo);
  });
});

/**
 * Que el mensaje no describa la base (`CLAUDE.md` §6). Del otro lado hay un software de afuera:
 * ve qué dato le rechazaron, no en qué tabla vive.
 */
function noFiltraLaBase(cuerpo) {
  const texto = JSON.stringify(cuerpo ?? {});
  assert.doesNotMatch(
    texto,
    /facturas_familia|configuracion_facturacion|prestadora_id|jsonb|constraint|select|column|relation|PGRST|vault/i,
    `el mensaje nombra algo de la base: ${texto}`
  );
}
