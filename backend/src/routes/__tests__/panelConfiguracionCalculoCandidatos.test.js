/**
 * Cómo ordena cada Prestadora su lista de candidatos.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Los números con los que se ordena la lista de quiénes pueden cubrir
 * un hueco pasaron de estar escritos en el código a ser configuración de cada Prestadora. Eso
 * abre tres agujeros que esta prueba tapa:
 *
 *  1. Que una Prestadora vea o pise la configuración de otra.
 *  2. Que se guarden los cuarenta números en vez de lo que esa Prestadora corrió. Si se guardaran
 *     todos, el día que un valor de fábrica cambie, quien alguna vez abrió la pantalla y guardó
 *     sin tocar nada se queda con los viejos para siempre.
 *  3. Que entre un número absurdo. Un peso de −1000 esconde a alguien que sí puede tomar la
 *     guardia, con el mismo número con el que el sistema marca lo que de verdad bloquea.
 *
 * Se levanta el router de verdad contra una base de mentira y se mira qué contesta y qué escribe.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

import { PESOS, TOPES } from '../../utils/perfilesDeCandidatos.js';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const USUARIO = '22222222-2222-2222-2222-222222222222';

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
    const valor = typeof preparada === 'function' ? preparada(direccion.searchParams) : preparada;
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
const { panelConfiguracionRouter } = await import('../panelConfiguracion.js');

const app = express();
app.use(express.json());
app.use('/api/panel/configuracion', panelConfiguracionRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/panel/configuracion`;

after(() => {
  motor.close();
  baseFalsa.close();
});

async function leer() {
  const respuesta = await fetch(`${DIRECCION}/calculo-candidatos`, {
    headers: { Authorization: 'Bearer token-de-mentira' },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

async function guardar(cuerpo) {
  const respuesta = await fetch(`${DIRECCION}/calculo-candidatos`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** Lo que el motor escribió, o `undefined` si no escribió nada. */
function loEscrito() {
  const escritura = llamadas.find((l) => l.clave === 'POST /rest/v1/configuracion_calculo_candidatos');
  return escritura?.cuerpo;
}

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'admin_prestadora', prestadora_id: PRESTADORA }]);
  // Por omisión, esta Prestadora nunca entró a la pantalla y guardar sale bien.
  respuestas.set('GET /rest/v1/configuracion_calculo_candidatos', () => []);
  respuestas.set('POST /rest/v1/configuracion_calculo_candidatos', () => []);
});

// ---------------------------------------------------------------------------------------

describe('leer cómo ordena esta Prestadora', () => {
  it('sin nada guardado, contesta los valores de fábrica', async () => {
    const { estado, cuerpo } = await leer();
    assert.equal(estado, 200);
    assert.equal(cuerpo.configuracion.perfil, 'continuidad');
    assert.equal(cuerpo.configuracion.pesos.continuidad_por_vez, PESOS.continuidad_por_vez);
    assert.equal(cuerpo.configuracion.topes.horas_semanales, TOPES.horas_semanales);
    assert.deepEqual(cuerpo.configuracion.corridos, { pesos: {}, topes: {} });
  });

  it('con un perfil guardado, contesta los números de ese perfil', async () => {
    respuestas.set('GET /rest/v1/configuracion_calculo_candidatos', () => [
      { perfil: 'descanso', pesos: {}, topes: {} },
    ]);
    const { cuerpo } = await leer();
    assert.equal(cuerpo.configuracion.perfil, 'descanso');
    assert.equal(cuerpo.configuracion.pesos.descanso_corto, -60);
    assert.equal(cuerpo.configuracion.topes.horas_descanso_minimo, 14);
  });

  it('lo que la Prestadora corrió a mano manda sobre el perfil', async () => {
    respuestas.set('GET /rest/v1/configuracion_calculo_candidatos', () => [
      { perfil: 'descanso', pesos: { cerca: 22 }, topes: {} },
    ]);
    const { cuerpo } = await leer();
    assert.equal(cuerpo.configuracion.pesos.cerca, 22);
    assert.equal(cuerpo.configuracion.pesos.descanso_corto, -60, 'el perfil se perdió');
    assert.deepEqual(cuerpo.configuracion.corridos.pesos, { cerca: 22 });
  });

  it('pregunta por esta Prestadora y no por cualquiera', async () => {
    await leer();
    const pregunta = llamadas.find((l) => l.clave === 'GET /rest/v1/configuracion_calculo_candidatos');
    assert.equal(pregunta.filtros.get('prestadora_id'), `eq.${PRESTADORA}`);
  });

  it('un número guardado fuera de borde se ignora y manda el de fábrica', async () => {
    // Puede haber quedado de una versión anterior, con otros bordes. Una lista de candidatos
    // vale más que una pantalla de error.
    respuestas.set('GET /rest/v1/configuracion_calculo_candidatos', () => [
      { perfil: 'continuidad', pesos: { cerca: -1000 }, topes: {} },
    ]);
    const { cuerpo } = await leer();
    assert.equal(cuerpo.configuracion.pesos.cerca, PESOS.cerca);
  });
});

describe('guardar', () => {
  it('escribe el perfil y sólo lo que se corrió, nunca los cuarenta números', async () => {
    const { estado, cuerpo } = await guardar({
      perfil: 'descanso',
      pesos: {
        ...PESOS,
        continuidad_maxima: 36,
        descanso_ok: 14,
        descanso_corto: -60,
        horas_cerca_del_tope: -30,
        horas_pasa_el_tope: -70,
        cerca: 22,
      },
      topes: { ...TOPES, horas_descanso_minimo: 14 },
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    const escrito = loEscrito();
    assert.equal(escrito.perfil, 'descanso');
    assert.deepEqual(escrito.pesos, { cerca: 22 }, 'guardó más de lo que se corrió');
    assert.deepEqual(escrito.topes, {});
    assert.equal(escrito.prestadora_id, PRESTADORA);
  });

  it('guardar sin tocar nada no congela ningún valor de fábrica', async () => {
    await guardar({ perfil: 'continuidad', pesos: { ...PESOS }, topes: { ...TOPES } });
    const escrito = loEscrito();
    assert.deepEqual(escrito.pesos, {});
    assert.deepEqual(escrito.topes, {});
  });

  it('un peso fuera de borde se rechaza y no escribe nada', async () => {
    const { estado, cuerpo } = await guardar({ perfil: 'continuidad', pesos: { cerca: -1000 }, topes: {} });
    assert.equal(estado, 400);
    assert.equal(loEscrito(), undefined, 'dijo que no y guardó igual');
    noFiltraLaBase(cuerpo);
  });

  it('un tope fuera de borde también', async () => {
    const { estado } = await guardar({ perfil: 'continuidad', pesos: {}, topes: { horas_semanales: 400 } });
    assert.equal(estado, 400);
    assert.equal(loEscrito(), undefined);
  });

  it('un perfil que no existe se rechaza', async () => {
    const { estado } = await guardar({ perfil: 'lo_que_sea', pesos: {}, topes: {} });
    assert.equal(estado, 400);
    assert.equal(loEscrito(), undefined);
  });

  it('una clave que nadie puede tocar no llega a guardarse', async () => {
    // `ocupado` vale −1000 para mandar al fondo lo que ya está bloqueado. Si se pudiera tocar,
    // se podría subir a la cabeza de la lista a alguien que no puede tomar la guardia.
    const { estado } = await guardar({ perfil: 'continuidad', pesos: { ocupado: 500 }, topes: {} });
    assert.equal(estado, 200);
    const escrito = loEscrito();
    assert.equal(escrito.pesos.ocupado, undefined, 'entró un peso de bloqueo');
  });

  it('escribe para esta Prestadora y no para cualquiera', async () => {
    await guardar({ perfil: 'cercania', pesos: {}, topes: {} });
    assert.equal(loEscrito().prestadora_id, PRESTADORA);
  });
});

/**
 * Que el mensaje no describa la base (CLAUDE.md §6). Quien configura ve qué número está mal, no
 * en qué tabla vive.
 */
function noFiltraLaBase(cuerpo) {
  const texto = String(cuerpo?.error ?? '');
  assert.doesNotMatch(
    texto,
    /configuracion_calculo_candidatos|prestadora_id|jsonb|constraint|select|column|relation|PGRST/i,
    `el mensaje nombra algo de la base: ${texto}`
  );
}
