/**
 * Con cuánta anticipación una ausencia se considera avisada con tiempo.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. De este número sale si una falta le llega a la Coordinadora como
 * tarea para cuando pueda o como alarma para ahora mismo. Tres agujeros que tapa:
 *
 *  1. Que una Prestadora vea o pise la configuración de otra.
 *  2. Que se guarde la regla entera en vez de lo que esa Prestadora corrió. Guardada entera, quien
 *     abrió la pantalla y guardó sin tocar nada se queda con los valores viejos el día que los de
 *     fábrica cambien.
 *  3. Que entre un número absurdo. Con cero horas ninguna ausencia sería nunca urgente, ni la que
 *     avisan con el turno ya empezado, y las alarmas dejarían de salir sin que nadie se entere.
 *
 * Se levanta el router de verdad contra una base de mentira y se mira qué contesta y qué escribe.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

import { REGLA_DE_AVISO_DE_AUSENCIA } from '../../utils/avisoDeAusencia.js';

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
  const respuesta = await fetch(`${DIRECCION}/ausencias`, {
    headers: { Authorization: 'Bearer token-de-mentira' },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

async function guardar(cuerpo) {
  const respuesta = await fetch(`${DIRECCION}/ausencias`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** Lo que el motor escribió, o `undefined` si no escribió nada. */
function loEscrito() {
  return llamadas.find((l) => l.clave === 'POST /rest/v1/configuracion_ausencias')?.cuerpo;
}

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: 'admin_prestadora', prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/configuracion_ausencias', () => []);
  respuestas.set('POST /rest/v1/configuracion_ausencias', () => []);
});

// ---------------------------------------------------------------------------------------

describe('leer con cuánta anticipación se considera con tiempo', () => {
  it('sin nada guardado, contesta los valores de fábrica', async () => {
    const { estado, cuerpo } = await leer();
    assert.equal(estado, 200);
    assert.deepEqual(cuerpo.configuracion.regla, REGLA_DE_AVISO_DE_AUSENCIA);
    assert.deepEqual(cuerpo.configuracion.corridos, {});
  });

  it('lo que la Prestadora corrió manda, y lo demás sigue de fábrica', async () => {
    respuestas.set('GET /rest/v1/configuracion_ausencias', () => [
      { regla: { horas_para_considerarla_con_tiempo: 72 } },
    ]);
    const { cuerpo } = await leer();
    assert.equal(cuerpo.configuracion.regla.horas_para_considerarla_con_tiempo, 72);
    assert.equal(
      cuerpo.configuracion.regla.horas_entre_avisos,
      REGLA_DE_AVISO_DE_AUSENCIA.horas_entre_avisos
    );
    assert.deepEqual(cuerpo.configuracion.corridos, { horas_para_considerarla_con_tiempo: 72 });
  });

  it('pregunta por esta Prestadora y no por cualquiera', async () => {
    await leer();
    const pregunta = llamadas.find((l) => l.clave === 'GET /rest/v1/configuracion_ausencias');
    assert.equal(pregunta.filtros.get('prestadora_id'), `eq.${PRESTADORA}`);
  });

  it('un número guardado fuera de borde se ignora y manda el de fábrica', async () => {
    // Puede haber quedado de una versión anterior, con otros bordes. Que salgan las alarmas vale
    // más que una pantalla de error.
    respuestas.set('GET /rest/v1/configuracion_ausencias', () => [
      { regla: { horas_para_considerarla_con_tiempo: 0 } },
    ]);
    const { cuerpo } = await leer();
    assert.equal(
      cuerpo.configuracion.regla.horas_para_considerarla_con_tiempo,
      REGLA_DE_AVISO_DE_AUSENCIA.horas_para_considerarla_con_tiempo
    );
  });
});

describe('guardar', () => {
  it('escribe sólo lo que se corrió', async () => {
    const { estado, cuerpo } = await guardar({
      regla: { ...REGLA_DE_AVISO_DE_AUSENCIA, horas_para_considerarla_con_tiempo: 72 },
    });
    assert.equal(estado, 200);
    assert.equal(cuerpo.ok, true);
    const escrito = loEscrito();
    assert.deepEqual(escrito.regla, { horas_para_considerarla_con_tiempo: 72 }, 'guardó más de lo que se corrió');
    assert.equal(escrito.prestadora_id, PRESTADORA);
  });

  it('guardar sin tocar nada no congela ningún valor de fábrica', async () => {
    await guardar({ regla: { ...REGLA_DE_AVISO_DE_AUSENCIA } });
    assert.deepEqual(loEscrito().regla, {});
  });

  it('cero horas se rechaza y no escribe nada', async () => {
    // Con cero, ninguna ausencia sería nunca urgente y las alarmas dejarían de salir en silencio.
    const { estado, cuerpo } = await guardar({ regla: { horas_para_considerarla_con_tiempo: 0 } });
    assert.equal(estado, 400);
    assert.equal(loEscrito(), undefined, 'dijo que no y guardó igual');
    noFiltraLaBase(cuerpo);
  });

  it('una anticipación absurdamente larga también se rechaza', async () => {
    // Con todas las ausencias clasificadas como urgentes, la alarma deja de significar algo.
    const { estado } = await guardar({ regla: { horas_para_considerarla_con_tiempo: 5000 } });
    assert.equal(estado, 400);
    assert.equal(loEscrito(), undefined);
  });

  it('insistir cada cero horas se rechaza', async () => {
    const { estado } = await guardar({ regla: { horas_entre_avisos: 0 } });
    assert.equal(estado, 400);
    assert.equal(loEscrito(), undefined);
  });

  it('una clave que nadie puede tocar no llega a guardarse', async () => {
    const { estado } = await guardar({ regla: { lo_que_sea: 7 } });
    assert.equal(estado, 200);
    assert.deepEqual(loEscrito().regla, {});
  });

  it('escribe para esta Prestadora y no para cualquiera', async () => {
    await guardar({ regla: { horas_entre_avisos: 6 } });
    assert.equal(loEscrito().prestadora_id, PRESTADORA);
  });
});

/**
 * Que el mensaje no describa la base (CLAUDE.md §6). Quien configura ve qué número está mal, no en
 * qué tabla vive.
 */
function noFiltraLaBase(cuerpo) {
  const texto = String(cuerpo?.error ?? '');
  assert.doesNotMatch(
    texto,
    /configuracion_ausencias|prestadora_id|jsonb|constraint|select|column|relation|PGRST/i,
    `el mensaje nombra algo de la base: ${texto}`
  );
}
