/**
 * A qué plazo paga cada Familia lo que se le factura.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. De este valor sale la fecha de vencimiento de cada factura, y de
 * esa fecha sale si una Familia figura en mora o no. Cuatro agujeros que tapa:
 *
 *  1. Que una Prestadora vea o pise el plazo de otra.
 *  2. Que vacío se guarde como cero. Cero es «paga el mismo día» y vacío es «no se acordó nada»;
 *     confundirlos pone en mora a todo el mundo el día que alguien guarda sin completar nada.
 *  3. Que entre un plazo disparatado. Un cero de más manda el vencimiento a diez años y nadie lo
 *     nota hasta que alguien tiene que reclamar.
 *  4. Que el mensaje de rechazo describa la base.
 *
 * Se levanta el router de verdad contra una base de mentira y se mira qué contesta y qué escribe.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

import { PLAZO_MAXIMO_EN_DIAS } from '../../utils/facturacionDeFamilias.js';

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
    llamadas.push({ clave, filtros: direccion.searchParams, cuerpo: crudo ? JSON.parse(crudo) : null });

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
  const respuesta = await fetch(`${DIRECCION}/facturacion-familias`, {
    headers: { Authorization: 'Bearer token-de-mentira' },
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

async function guardar(cuerpo) {
  const respuesta = await fetch(`${DIRECCION}/facturacion-familias`, {
    method: 'PUT',
    headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

/** Lo que el motor escribió, o `undefined` si no escribió nada. */
function loEscrito() {
  return llamadas.find((l) => l.clave === 'POST /rest/v1/configuracion_facturacion_familias')?.cuerpo;
}

let rolDelUsuario = 'admin_prestadora';

beforeEach(() => {
  llamadas = [];
  rolDelUsuario = 'admin_prestadora';
  respuestas.clear();
  respuestas.set('GET /auth/v1/user', () => ({ id: USUARIO, aud: 'authenticated' }));
  respuestas.set('GET /rest/v1/usuarios', () => [{ rol: rolDelUsuario, prestadora_id: PRESTADORA }]);
  respuestas.set('GET /rest/v1/configuracion_facturacion_familias', () => []);
  respuestas.set('POST /rest/v1/configuracion_facturacion_familias', () => []);
});

// ---------------------------------------------------------------------------------------

describe('leer el plazo de pago', () => {
  it('sin nada guardado no hay plazo, y no se inventa ninguno', async () => {
    const { estado, cuerpo } = await leer();
    assert.equal(estado, 200);
    assert.equal(cuerpo.configuracion.dias_hasta_el_vencimiento, null);
  });

  it('contesta lo que esa Prestadora configuró', async () => {
    respuestas.set('GET /rest/v1/configuracion_facturacion_familias', () => [
      { regla: { dias_hasta_el_vencimiento: 10 } },
    ]);
    const { cuerpo } = await leer();
    assert.equal(cuerpo.configuracion.dias_hasta_el_vencimiento, 10);
  });

  it('la consulta lleva el filtro de Prestadora escrito', async () => {
    await leer();
    const consulta = llamadas.find((l) => l.clave === 'GET /rest/v1/configuracion_facturacion_familias');
    assert.equal(consulta.filtros.get('prestadora_id'), `eq.${PRESTADORA}`);
  });
});

describe('guardar el plazo de pago', () => {
  it('lo guardado es de esta Prestadora y de ninguna otra', async () => {
    const { estado } = await guardar({ dias_hasta_el_vencimiento: 15 });
    assert.equal(estado, 200);
    assert.equal(loEscrito().prestadora_id, PRESTADORA);
    assert.deepEqual(loEscrito().regla, { dias_hasta_el_vencimiento: 15 });
  });

  it('vacío se guarda como «no se acordó nada», nunca como cero', async () => {
    await guardar({ dias_hasta_el_vencimiento: '' });
    assert.deepEqual(loEscrito().regla, {});
  });

  it('cero sí se guarda: es «paga el mismo día», que es un acuerdo posible', async () => {
    await guardar({ dias_hasta_el_vencimiento: 0 });
    assert.deepEqual(loEscrito().regla, { dias_hasta_el_vencimiento: 0 });
  });

  it('un plazo más largo que el tope se rechaza y no escribe nada', async () => {
    const { estado, cuerpo } = await guardar({ dias_hasta_el_vencimiento: PLAZO_MAXIMO_EN_DIAS + 1 });
    assert.equal(estado, 400);
    assert.equal(loEscrito(), undefined, 'dijo que no y guardó igual');
    noFiltraLaBase(cuerpo);
  });

  it('un plazo negativo o con decimales tampoco entra', async () => {
    for (const dias of [-5, 7.5, 'diez']) {
      llamadas = [];
      const { estado } = await guardar({ dias_hasta_el_vencimiento: dias });
      assert.equal(estado, 400, `entró un plazo que no debía: ${dias}`);
      assert.equal(loEscrito(), undefined);
    }
  });

  it('quien no administra no cambia el plazo', async () => {
    rolDelUsuario = 'coordinador';
    const { estado } = await guardar({ dias_hasta_el_vencimiento: 15 });
    assert.equal(estado, 403);
    assert.equal(loEscrito(), undefined);
  });
});

/**
 * Que el mensaje no describa la base (CLAUDE.md §6). Quien configura ve qué valor está mal, no en
 * qué tabla vive.
 */
function noFiltraLaBase(cuerpo) {
  const texto = String(cuerpo?.error ?? '');
  assert.doesNotMatch(
    texto,
    /configuracion_facturacion_familias|prestadora_id|jsonb|constraint|select|column|relation|PGRST/i,
    `el mensaje nombra algo de la base: ${texto}`
  );
}
