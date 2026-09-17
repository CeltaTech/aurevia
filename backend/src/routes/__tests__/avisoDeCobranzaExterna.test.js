/**
 * La puerta por la que el software de créditos y cobranzas avisa cómo va la cobranza.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Es una dirección pública: la llama un software de afuera, sin sesión.
 * Lo único que separa un aviso de verdad de uno inventado es la firma, y lo único que separa una
 * Prestadora de otra es el filtro escrito en la consulta. Seis agujeros que tapa:
 *
 *  1. Que entre un aviso sin firma, con una firma que no da, o cuando esa Prestadora todavía no
 *     cargó ningún secreto.
 *  2. Que el secreto de una Prestadora sirva para escribir sobre una Familia de otra.
 *  3. Que el mismo aviso repetido anote dos veces.
 *  4. Que quien hoy manda sólo la restricción deje de entrar al ampliarse la puerta.
 *  5. Que entre un estado de cuenta sin moneda, o con un saldo que no es número.
 *  6. Que la respuesta, o el rechazo, cuente algo de la base.
 *
 * Se levanta el router de verdad contra una base de mentira y se mira qué contesta y qué escribe.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const OTRA_PRESTADORA = '99999999-9999-9999-9999-999999999999';
const FAMILIA = '60000000-0000-4000-8000-000000000001';
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

    // Así se le hace decir que no a la base: la clave repetida y la caída se prueban igual que
    // pasan de verdad, con el código que devuelve PostgREST.
    if (valor && valor.__falla) {
      res.writeHead(valor.__falla.estado, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ code: valor.__falla.code, message: valor.__falla.message }));
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
const { avisoDeCobranzaExternaRouter } = await import('../avisoDeCobranzaExterna.js');

const app = express();
// Montado como en `server.js`: antes de cualquier lector de JSON general, porque la firma se
// calcula sobre los bytes exactos que llegaron.
app.use('/api/avisos-de-cobranza', avisoDeCobranzaExternaRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/avisos-de-cobranza`;

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

/** Lo que el motor escribió en cada tabla, o `undefined` si no escribió nada. */
function laRestriccion() {
  return llamadas.find((l) => l.clave === 'POST /rest/v1/restricciones_de_cobranza')?.cuerpo;
}
function elEstado() {
  return llamadas.find((l) => l.clave === 'POST /rest/v1/estados_de_cuenta_externos')?.cuerpo;
}

const ESTADO_DE_CUENTA = {
  saldo: 48500.5,
  moneda: 'ARS',
  atrasado: true,
  dias_de_atraso: 12,
  vencimiento_mas_antiguo: '2026-08-10',
  fecha_del_estado: '2026-09-17',
};

let familiaEnLaBase = { id: FAMILIA };
let secretoCargado = SECRETO;

beforeEach(() => {
  llamadas = [];
  familiaEnLaBase = { id: FAMILIA };
  secretoCargado = SECRETO;
  respuestas.clear();
  respuestas.set('POST /rest/v1/rpc/leer_secreto_del_aviso_de_cobranza', () => secretoCargado);
  respuestas.set('GET /rest/v1/familias', (filtros) =>
    // La base sólo devuelve lo que pide el filtro: si la consulta no lleva escrito el filtro de
    // Prestadora, esta prueba no lo detectaría, así que se mira aparte más abajo.
    filtros.get('id') === `eq.${FAMILIA}` && familiaEnLaBase ? [familiaEnLaBase] : []
  );
  respuestas.set('POST /rest/v1/restricciones_de_cobranza', () => []);
  respuestas.set('POST /rest/v1/estados_de_cuenta_externos', () => []);
});

// ---------------------------------------------------------------------------------------

describe('sin firma no entra nada', () => {
  const AVISO = { familia_id: FAMILIA, restringida: true };

  it('el aviso sin cabecera de firma se rechaza y no escribe', async () => {
    const { estado } = await avisar(AVISO, { firma: null });
    assert.equal(estado, 401);
    assert.equal(laRestriccion(), undefined, 'dijo que no y escribió igual');
  });

  it('una firma calculada con otro secreto no entra', async () => {
    const { estado } = await avisar(AVISO, { firma: firmaDe(JSON.stringify(AVISO), 'otro-secreto') });
    assert.equal(estado, 401);
    assert.equal(laRestriccion(), undefined);
  });

  it('una firma de hace horas no entra', async () => {
    const vieja = Math.floor(Date.now() / 1000) - 60 * 60 * 5;
    const { estado } = await avisar(AVISO, { firma: firmaDe(JSON.stringify(AVISO), SECRETO, vieja) });
    assert.equal(estado, 401);
    assert.equal(laRestriccion(), undefined);
  });

  it('sin secreto cargado no entra ningún aviso, aunque venga firmado', async () => {
    secretoCargado = null;
    const { estado } = await avisar(AVISO);
    assert.equal(estado, 401);
    assert.equal(laRestriccion(), undefined);
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

describe('la restricción sigue entrando igual que antes', () => {
  it('un aviso que sólo trae la restricción se anota', async () => {
    const { estado, cuerpo } = await avisar({ familia_id: FAMILIA, restringida: true, motivo: 'Mora' });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(laRestriccion().restringida, true);
    assert.equal(laRestriccion().motivo, 'Mora');
    assert.equal(laRestriccion().origen, 'software_externo');
    assert.equal(elEstado(), undefined, 'anotó un estado de cuenta que nadie informó');
  });

  it('el aviso que levanta la restricción también entra', async () => {
    await avisar({ familia_id: FAMILIA, restringida: false });
    assert.equal(laRestriccion().restringida, false);
  });
});

describe('el estado de cuenta entra por la misma puerta', () => {
  it('se anota tal como llegó, con su moneda', async () => {
    const { estado, cuerpo } = await avisar({ familia_id: FAMILIA, estado_de_cuenta: ESTADO_DE_CUENTA });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    assert.equal(elEstado().saldo, 48500.5);
    assert.equal(elEstado().moneda, 'ARS');
    assert.equal(elEstado().atrasado, true);
    assert.equal(elEstado().dias_de_atraso, 12);
    assert.equal(elEstado().vencimiento_mas_antiguo, '2026-08-10');
    assert.equal(laRestriccion(), undefined, 'restringió a una Familia que nadie restringió');
  });

  it('un saldo a favor entra: no se trata como error', async () => {
    await avisar({
      familia_id: FAMILIA,
      estado_de_cuenta: { saldo: -1200, moneda: 'ARS', atrasado: false },
    });
    assert.equal(elEstado().saldo, -1200);
  });

  it('lo que el otro software no lleva queda vacío, no inventado', async () => {
    await avisar({
      familia_id: FAMILIA,
      estado_de_cuenta: { saldo: 100, moneda: 'USD', atrasado: false },
    });
    assert.equal(elEstado().dias_de_atraso, null);
    assert.equal(elEstado().vencimiento_mas_antiguo, null);
    assert.equal(elEstado().fecha_del_estado, null);
  });

  it('las dos cosas en el mismo aviso se anotan las dos', async () => {
    const { estado } = await avisar({
      familia_id: FAMILIA,
      restringida: true,
      estado_de_cuenta: ESTADO_DE_CUENTA,
    });
    assert.equal(estado, 200);
    assert.ok(laRestriccion());
    assert.ok(elEstado());
  });
});

describe('lo que no entra', () => {
  it('un aviso que no informa ninguna de las dos cosas se rechaza', async () => {
    const { estado, cuerpo } = await avisar({ familia_id: FAMILIA });
    assert.equal(estado, 400);
    assert.equal(cuerpo.dato, 'aviso_vacio');
    assert.equal(laRestriccion(), undefined);
    assert.equal(elEstado(), undefined);
  });

  it('un estado de cuenta sin moneda se rechaza diciendo cuál es el dato', async () => {
    const { estado, cuerpo } = await avisar({
      familia_id: FAMILIA,
      estado_de_cuenta: { saldo: 100, atrasado: false },
    });
    assert.equal(estado, 400);
    assert.equal(cuerpo.dato, 'estado_de_cuenta.moneda');
    assert.equal(elEstado(), undefined);
  });

  it('un saldo que no es número se rechaza', async () => {
    const { cuerpo } = await avisar({
      familia_id: FAMILIA,
      estado_de_cuenta: { saldo: 'bastante', moneda: 'ARS', atrasado: false },
    });
    assert.equal(cuerpo.dato, 'estado_de_cuenta.saldo');
    assert.equal(elEstado(), undefined);
  });

  it('un atraso en días que no es un entero positivo se rechaza', async () => {
    const { cuerpo } = await avisar({
      familia_id: FAMILIA,
      estado_de_cuenta: { ...ESTADO_DE_CUENTA, dias_de_atraso: -3 },
    });
    assert.equal(cuerpo.dato, 'estado_de_cuenta.dias_de_atraso');
    assert.equal(elEstado(), undefined);
  });

  it('una Familia de otra Prestadora se rechaza y no escribe nada', async () => {
    familiaEnLaBase = null;
    const { estado } = await avisar({ familia_id: FAMILIA, estado_de_cuenta: ESTADO_DE_CUENTA }, {
      prestadora: OTRA_PRESTADORA,
    });
    assert.equal(estado, 404);
    assert.equal(elEstado(), undefined);
  });

  it('la Familia se busca siempre con el filtro de la Prestadora de la dirección', async () => {
    await avisar({ familia_id: FAMILIA, restringida: true });
    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/familias');
    assert.equal(consulta.filtros.get('prestadora_id'), `eq.${PRESTADORA}`);
  });

  it('un identificador de Familia mal escrito no llega hasta la base', async () => {
    const { estado } = await avisar({ familia_id: '0001-000123', restringida: true });
    assert.equal(estado, 400);
    assert.equal(
      llamadas.some((l) => l.clave === 'GET /rest/v1/familias'),
      false,
      'le preguntó a la base por algo que no es un identificador'
    );
  });
});

describe('el mismo aviso mandado dos veces', () => {
  it('se contesta que sí y no se anota de nuevo', async () => {
    respuestas.set('POST /rest/v1/estados_de_cuenta_externos', () => ({
      __falla: { estado: 409, code: '23505', message: 'duplicate key value' },
    }));
    const { estado, cuerpo } = await avisar({
      familia_id: FAMILIA,
      numero_del_aviso: 'A-100',
      estado_de_cuenta: ESTADO_DE_CUENTA,
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.repetido, true);
  });

  it('si la vez anterior sólo entró una de las dos, la otra se anota igual', async () => {
    respuestas.set('POST /rest/v1/restricciones_de_cobranza', () => ({
      __falla: { estado: 409, code: '23505', message: 'duplicate key value' },
    }));
    const { estado, cuerpo } = await avisar({
      familia_id: FAMILIA,
      numero_del_aviso: 'A-100',
      restringida: true,
      estado_de_cuenta: ESTADO_DE_CUENTA,
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.repetido, undefined, 'dio por repetido un aviso que anotó algo nuevo');
    assert.ok(elEstado(), 'se cortó en la restricción repetida y no anotó el estado de cuenta');
  });
});

describe('lo que no se cuenta hacia afuera', () => {
  it('una caída de la base no describe la base', async () => {
    respuestas.set('POST /rest/v1/estados_de_cuenta_externos', () => ({
      __falla: { estado: 500, code: '42P01', message: 'relation "estados_de_cuenta_externos" does not exist' },
    }));
    const { estado, cuerpo } = await avisar({ familia_id: FAMILIA, estado_de_cuenta: ESTADO_DE_CUENTA });
    assert.equal(estado, 500);
    noFiltraLaBase(cuerpo);
  });

  it('el rechazo de un dato tampoco', async () => {
    const { cuerpo } = await avisar({
      familia_id: FAMILIA,
      estado_de_cuenta: { saldo: 100, atrasado: false },
    });
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
    /restricciones_de_cobranza|estados_de_cuenta_externos|configuracion_facturacion|prestadora_id|jsonb|constraint|select|column|relation|PGRST|vault/i,
    `el mensaje nombra algo de la base: ${texto}`
  );
}
