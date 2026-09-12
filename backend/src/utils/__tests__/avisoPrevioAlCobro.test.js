/**
 * El aviso previo al primer cobro, cuando está por terminar el período gratuito.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El §3.2 del `docs/PRD_07_Modalidad_Marketplace.md` dice «nunca un
 * cobro silencioso», y un aviso se puede equivocar de las cuatro maneras, todas caras:
 *
 *   * no salir, y entonces el cobro es silencioso, que es lo que este trabajo viene a impedir;
 *   * salir tarde —después de la fecha del cobro—, que no es un aviso previo sino una noticia;
 *   * salir todos los días, y entonces deja de leerse antes de llegar el día que importa;
 *   * salirle a quien ya se dio de baja, que es anunciarle un cobro que no va a ocurrir.
 *
 * La entrega del push se reemplaza acá. `web-push` sólo entrega contra una dirección segura, así
 * que no hay servicio de mentira posible; lo que esta prueba necesita decidir es si el aviso salió
 * o no, porque de eso depende todo lo demás: a quién se le manda, qué dice y qué queda anotado.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const ACCESO = '33333333-3333-3333-3333-333333333333';
const OTRO_ACCESO = '55555555-5555-5555-5555-555555555555';
const FAMILIA = '11111111-1111-1111-1111-111111111111';
const PACIENTE = '22222222-2222-2222-2222-222222222222';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba pisa lo que necesita cambiar. */
const respuestas = new Map();
/** Todo lo que se le pidió a la base, para poder afirmar que NO se pidió algo. */
let llamadas = [];
/** Los avisos que se le mandaron a cada Familia, y si el envío salió. */
let empujados = [];
let elEnvioSale = true;

/** El push, reemplazado: anota a quién se le mandó y qué, y contesta lo mismo que contestaría
 *  `enviarPushFamilia` —true si llegó a algún dispositivo—. */
function avisarDeMentira(familiaId, texto) {
  empujados.push({ familiaId, texto });
  return Promise.resolve(elEnvioSale);
}
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
const { avisarElPrimerCobroQueViene, textoDelAviso } = await import('../avisoPrevioAlCobro.js');

const avisarDeVerdad = console.error;
console.error = (...partes) => anotados.push(partes.join(' '));

after(() => {
  console.error = avisarDeVerdad;
  baseFalsa.close();
});

/** Hoy y los días de alrededor, en el mismo formato que guarda la base. */
const HOY = new Date().toISOString().slice(0, 10);

function corrido(dias) {
  const fecha = new Date();
  fecha.setUTCDate(fecha.getUTCDate() + dias);
  return fecha.toISOString().slice(0, 10);
}

/** Un acceso cuyo período gratuito termina pasado mañana. */
function accesoPorCobrarse(cambios = {}) {
  return {
    id: ACCESO,
    familia_id: FAMILIA,
    paciente_id: PACIENTE,
    importe: '4500.00',
    moneda: 'ARS',
    gratis_hasta: corrido(2),
    ...cambios,
  };
}

/** Lo que la base recibió para guardar, o `undefined` si no se guardó nada. */
function loAnotado() {
  return llamadas.find((l) => l.clave === 'PATCH /rest/v1/accesos_marketplace');
}

beforeEach(() => {
  llamadas = [];
  empujados = [];
  elEnvioSale = true;
  anotados = [];
  respuestas.clear();
  respuestas.set('PATCH /rest/v1/accesos_marketplace', []);
});

describe('a quién se le avisa', () => {
  it('le avisa a la Familia y anota cuándo', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', [accesoPorCobrarse()]);

    const { avisados } = await avisarElPrimerCobroQueViene({ avisar: avisarDeMentira });

    assert.equal(avisados, 1);
    assert.equal(empujados.length, 1);
    assert.ok(loAnotado().cuerpo.aviso_previo_en);
    assert.match(loAnotado().url, /id=eq\.33333333/);
  });

  it('avisa también el mismo día del primer cobro', async () => {
    // Es el último momento en que el aviso todavía es previo. Si el trabajo no corrió antes —el
    // motor estuvo caído, la Familia no tenía dispositivo—, éste es el día que queda.
    respuestas.set('GET /rest/v1/accesos_marketplace', [accesoPorCobrarse({ gratis_hasta: HOY })]);

    assert.equal((await avisarElPrimerCobroQueViene({ avisar: avisarDeMentira })).avisados, 1);
    assert.equal(empujados.length, 1);
  });

  it('le pide a la base sólo los que están adentro de la ventana y sin avisar', async () => {
    // Lo que decide a quién se le avisa es la consulta, y por eso se comprueba la consulta: el que
    // ya se dio de baja no espera ningún cobro, el que ya fue avisado no se avisa dos veces, y el
    // que tiene la fecha lejos todavía no tiene nada que saber.
    respuestas.set('GET /rest/v1/accesos_marketplace', []);

    await avisarElPrimerCobroQueViene({ avisar: avisarDeMentira });

    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/accesos_marketplace').url;
    assert.match(consulta, /estado=eq\.vigente/);
    assert.match(consulta, /cancelada_en=is\.null/);
    assert.match(consulta, /aviso_previo_en=is\.null/);
    assert.match(consulta, /gratis_hasta=not\.is\.null/);
    assert.match(consulta, new RegExp(`gratis_hasta=gte\\.${HOY}`));
    assert.match(consulta, new RegExp(`gratis_hasta=lte\\.${corrido(3)}`));
  });

  it('no avisa ni escribe nada si la consulta falla', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', { __falla: { message: 'la base no contesta' } });

    const { avisados } = await avisarElPrimerCobroQueViene({ avisar: avisarDeMentira });

    assert.equal(avisados, 0);
    assert.equal(empujados.length, 0);
    assert.equal(loAnotado(), undefined);
    assert.equal(anotados.length, 1);
  });
});

describe('qué dice el aviso', () => {
  it('nombra el día, el importe con su moneda y adónde ir', () => {
    // El cuerpo del push viaja cifrado, así que lo que se comprueba es lo que la función arma.
    const texto = textoDelAviso(accesoPorCobrarse({ gratis_hasta: '2026-10-07' }));

    assert.match(texto.cuerpo, /7\/10\/2026/);
    assert.match(texto.cuerpo, /4500\.00 ARS/);
    assert.equal(texto.url, `/pacientes/${PACIENTE}/acceso`);
    assert.ok(texto.titulo);
  });

  it('nunca deja el importe sin su moneda', () => {
    const texto = textoDelAviso(accesoPorCobrarse({ moneda: 'BRL' }));

    assert.match(texto.cuerpo, /4500\.00 BRL/);
  });
});

describe('cuando el aviso no llega', () => {
  it('no lo anota si no había dispositivo al que mandarlo', async () => {
    // Anotarlo sería dar por avisada a una Familia que no recibió nada, y el aviso no volvería a
    // salir nunca. Sin anotarlo, mañana se vuelve a intentar mientras la ventana dure.
    respuestas.set('GET /rest/v1/accesos_marketplace', [accesoPorCobrarse()]);
    elEnvioSale = false;

    const { avisados } = await avisarElPrimerCobroQueViene({ avisar: avisarDeMentira });

    assert.equal(avisados, 0);
    assert.equal(loAnotado(), undefined);
  });

  it('sigue con las demás Familias cuando una anotación falla', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', [
      accesoPorCobrarse(),
      accesoPorCobrarse({ id: OTRO_ACCESO }),
    ]);
    let vez = 0;
    respuestas.set('PATCH /rest/v1/accesos_marketplace', () => {
      vez += 1;
      return vez === 1 ? { __falla: { message: 'la base no contesta' } } : [];
    });

    const { avisados } = await avisarElPrimerCobroQueViene({ avisar: avisarDeMentira });

    assert.equal(avisados, 1);
    assert.equal(empujados.length, 2);
    assert.equal(anotados.length, 1);
  });

  it('vuelve a exigir al anotar que nadie haya avisado en el medio', async () => {
    respuestas.set('GET /rest/v1/accesos_marketplace', [accesoPorCobrarse()]);

    await avisarElPrimerCobroQueViene({ avisar: avisarDeMentira });

    assert.match(loAnotado().url, /aviso_previo_en=is\.null/);
  });
});
