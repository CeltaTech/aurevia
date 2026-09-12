/**
 * El corte de un acceso del Marketplace al que se le terminó el período pagado.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El corte se equivoca de los dos lados y los dos cuestan:
 *
 *   * cortar antes de tiempo le saca a alguien un período que ya pagó, que es justo lo que el §3.2
 *     del `docs/PRD_07_Modalidad_Marketplace.md` prohíbe;
 *   * y no cortar nunca deja accesos `vigente` sin pagar para siempre, que es como estaba hasta
 *     ahora y lo que este trabajo viene a corregir.
 *
 * Además se comprueba lo que el corte **no** toca: un acceso que no se dio de baja y al que se le
 * pasó la fecha no se apaga acá — eso es el período de gracia, que es otro paso del plan.
 *
 * Se levanta la base de mentira igual que `bajaDelAcceso.test.js`.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const ACCESO = '33333333-3333-3333-3333-333333333333';
const OTRO_ACCESO = '55555555-5555-5555-5555-555555555555';

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

    // Una respuesta puede ser una falla: es la única forma de probar que un corte que no se guarda
    // no frena a los que siguen.
    if (valor && valor.__falla) {
      res.writeHead(valor.__falla.codigo ?? 400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: valor.__falla.message }));
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

// El import va después de dejar puestas las variables de entorno: la conexión a la base se arma en
// el momento en que se importa el archivo.
const { cortarLosAccesosDadosDeBaja } = await import('../corteDelAcceso.js');

const avisarDeVerdad = console.error;
console.error = (...partes) => anotados.push(partes.join(' '));

after(() => {
  console.error = avisarDeVerdad;
  baseFalsa.close();
});

/** Hoy y los días de alrededor, en el mismo formato que guarda la base. */
const HOY = new Date().toISOString().slice(0, 10);
const AYER = corrido(-1);
const MANANA = corrido(1);

function corrido(dias) {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** Un acceso dado de baja al que ya se le terminó el período pagado. */
function accesoApagado(cambios = {}) {
  return { id: ACCESO, vigente_hasta: AYER, gratis_hasta: null, ...cambios };
}

/** Lo que la base recibió para guardar, o `undefined` si no se guardó nada. */
function loGuardado() {
  return llamadas.find((l) => l.clave === 'PATCH /rest/v1/accesos_marketplace');
}

beforeEach(() => {
  llamadas = [];
  anotados = [];
  respuestas.clear();
  respuestas.set('PATCH /rest/v1/accesos_marketplace', []);
});

describe('el acceso que se corta', () => {
  it('apaga el que se dio de baja y ya se le terminó lo pagado', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', [accesoApagado()]);

    const { cortados } = await cortarLosAccesosDadosDeBaja();

    assert.equal(cortados, 1);
    assert.equal(loGuardado().cuerpo.estado, 'cancelada');
    assert.match(loGuardado().url, /id=eq\.33333333/);
  });

  it('corta el mismo día en que vence, no al siguiente', async () => {
    // `vigente_hasta` es la fecha del cobro que no se va a hacer: el primer día que ya no está
    // pagado. Esperar un día más regalaría un período.
    respuestas.set('GET /rest/v1/accesos_marketplace', [accesoApagado({ vigente_hasta: HOY })]);

    const { cortados } = await cortarLosAccesosDadosDeBaja();

    assert.equal(cortados, 1);
  });

  it('corta en el acto al que se dio de baja sin haber pagado ningún período', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', [accesoApagado({ vigente_hasta: null })]);

    assert.equal((await cortarLosAccesosDadosDeBaja()).cortados, 1);
  });

  it('mira el fin del período gratis cuando no hay período pagado', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', [
      accesoApagado({ vigente_hasta: null, gratis_hasta: AYER }),
    ]);

    assert.equal((await cortarLosAccesosDadosDeBaja()).cortados, 1);
  });

  it('no toca ni la fecha de la baja ni hasta cuándo llegaba lo pagado', async () => {
    // El corte no reescribe la historia del acceso: dice que se apagó y nada más.
    respuestas.set('GET /rest/v1/accesos_marketplace', [accesoApagado()]);

    await cortarLosAccesosDadosDeBaja();

    const cuerpo = loGuardado().cuerpo;
    assert.equal('cancelada_en' in cuerpo, false);
    assert.equal('vigente_hasta' in cuerpo, false);
    assert.equal('proximo_cobro' in cuerpo, false);
  });

  it('vuelve a exigir al guardar que siga vigente y dado de baja', async () => {
    // Entre la consulta y el guardado puede haber entrado un cobro, y entonces el acceso volvió a
    // estar pago: cortarlo ahí le sacaría un período a alguien que lo abonó.
    respuestas.set('GET /rest/v1/accesos_marketplace', [accesoApagado()]);

    await cortarLosAccesosDadosDeBaja();

    assert.match(loGuardado().url, /estado=eq\.vigente/);
    assert.match(loGuardado().url, /cancelada_en=not\.is\.null/);
  });
});

describe('el acceso que no se corta', () => {
  it('no toca al que todavía tiene período pagado por delante', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', [accesoApagado({ vigente_hasta: MANANA })]);

    const { cortados } = await cortarLosAccesosDadosDeBaja();

    assert.equal(cortados, 0);
    assert.equal(loGuardado(), undefined);
  });

  it('sólo le pregunta a la base por los vigentes que se dieron de baja', async () => {
    // Lo que no se dio de baja y se le pasó la fecha está esperando un cobro, no terminado:
    // suspenderlo es el período de gracia, que es otro paso del plan.
    respuestas.set('GET /rest/v1/accesos_marketplace', []);

    await cortarLosAccesosDadosDeBaja();

    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/accesos_marketplace').url;
    assert.match(consulta, /estado=eq\.vigente/);
    assert.match(consulta, /cancelada_en=not\.is\.null/);
  });

  it('no escribe nada si la consulta falla', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', { __falla: { message: 'la base no contesta' } });

    const { cortados } = await cortarLosAccesosDadosDeBaja();

    assert.equal(cortados, 0);
    assert.equal(loGuardado(), undefined);
    assert.equal(anotados.length, 1);
  });
});

describe('cuando un corte no se puede guardar', () => {
  it('sigue con los demás y anota el que falló', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', [
      accesoApagado(),
      accesoApagado({ id: OTRO_ACCESO }),
    ]);
    let vez = 0;
    respuestas.set('PATCH /rest/v1/accesos_marketplace', () => {
      vez += 1;
      return vez === 1 ? { __falla: { message: 'la base no contesta' } } : [];
    });

    const { cortados } = await cortarLosAccesosDadosDeBaja();

    assert.equal(cortados, 1);
    assert.equal(llamadas.filter((l) => l.clave === 'PATCH /rest/v1/accesos_marketplace').length, 2);
    assert.equal(anotados.length, 1);
  });
});
