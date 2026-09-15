/**
 * Cómo se llega a la Prestadora desde el teléfono de una Familia.
 *
 *   npm test --prefix backend
 *
 * QUÉ SE PRUEBA ACÁ. Que se pregunte por la Prestadora de quien mira y por ninguna otra —el motor
 * entra con la llave de servicio y se saltea la protección por fila, así que ese filtro es lo
 * único que separa una Prestadora de otra—; que un canal cargado a medias no cuente como canal; y
 * que una consulta que falla no rompa la pantalla ni invente un teléfono.
 *
 * CÓMO PUEDE FALLAR. La base falsa no contesta nada que la prueba no haya preparado, así que una
 * consulta de más —o una que se dejó de hacer— cambia el resultado. El filtro se comprueba mirando
 * la dirección con la que se llamó, no el resultado: una consulta sin filtro, contra una base
 * falsa que devuelve una sola fila, daría exactamente lo mismo que una bien escrita.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';

const respuestas = new Map();
let llamadas = [];

const baseFalsa = createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    const direccion = new URL(req.url, 'http://interno');
    const clave = `${req.method} ${direccion.pathname}`;
    llamadas.push({ clave, busqueda: direccion.search });

    const preparada = respuestas.get(clave);
    if (preparada === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `la prueba no preparó respuesta para ${clave}` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(typeof preparada === 'function' ? preparada() : preparada));
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

// Después de las variables de entorno: la conexión a la base se arma al importar.
const { contactoDeLaPrestadora, hayPorDondeLlamar } = await import('../contactoDeLaPrestadora.js');

after(() => baseFalsa.close());

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
});

const PRESTADORAS = 'GET /rest/v1/prestadoras';

describe('el contacto de la Prestadora', () => {
  it('devuelve los tres canales que ella cargó', async () => {
    respuestas.set(PRESTADORAS, [
      {
        telefono: '+54 11 5555 0000',
        whatsapp_numero: '+54 9 11 5555 0001',
        email: 'guardia@prestadora.invalido',
      },
    ]);

    const contacto = await contactoDeLaPrestadora(PRESTADORA);

    assert.deepEqual(contacto, {
      telefono: '+54 11 5555 0000',
      whatsapp: '+54 9 11 5555 0001',
      email: 'guardia@prestadora.invalido',
    });
    assert.equal(hayPorDondeLlamar(contacto), true);
  });

  it('pregunta por la Prestadora de quien mira, y por ninguna otra', async () => {
    respuestas.set(PRESTADORAS, [{ telefono: '+54 11 5555 0000', whatsapp_numero: null, email: null }]);

    await contactoDeLaPrestadora(PRESTADORA);

    const consulta = llamadas.find((l) => l.clave === PRESTADORAS);
    assert.ok(consulta, 'no se consultó la tabla de Prestadoras');
    assert.ok(
      consulta.busqueda.includes(`id=eq.${PRESTADORA}`),
      `la consulta salió sin el filtro por Prestadora: ${consulta.busqueda}`
    );
  });

  it('un canal cargado con espacios no es un canal', async () => {
    respuestas.set(PRESTADORAS, [{ telefono: '   ', whatsapp_numero: '', email: null }]);

    const contacto = await contactoDeLaPrestadora(PRESTADORA);

    assert.deepEqual(contacto, { telefono: null, whatsapp: null, email: null });
    assert.equal(hayPorDondeLlamar(contacto), false);
  });

  it('la Prestadora que no cargó ninguno no tiene por dónde ser llamada', async () => {
    respuestas.set(PRESTADORAS, []);

    const contacto = await contactoDeLaPrestadora(PRESTADORA);

    assert.deepEqual(contacto, { telefono: null, whatsapp: null, email: null });
    assert.equal(hayPorDondeLlamar(contacto), false);
  });

  it('sin Prestadora no consulta nada', async () => {
    const contacto = await contactoDeLaPrestadora(null);

    assert.deepEqual(contacto, { telefono: null, whatsapp: null, email: null });
    assert.equal(llamadas.length, 0, 'se consultó la base sin saber de qué Prestadora se trata');
  });

  it('una consulta que falla no inventa un teléfono ni rompe la pantalla', async () => {
    // Sin respuesta preparada la base falsa contesta 400: es el caso de la consulta rota.
    const contacto = await contactoDeLaPrestadora(PRESTADORA);

    assert.deepEqual(contacto, { telefono: null, whatsapp: null, email: null });
    assert.equal(hayPorDondeLlamar(contacto), false);
  });
});

describe('si hay por dónde llamar', () => {
  it('alcanza con un solo canal', () => {
    assert.equal(hayPorDondeLlamar({ telefono: null, whatsapp: null, email: 'a@b.invalido' }), true);
    assert.equal(hayPorDondeLlamar({ telefono: '+54 11 5555 0000', whatsapp: null, email: null }), true);
  });

  it('sin contacto, no', () => {
    assert.equal(hayPorDondeLlamar(null), false);
    assert.equal(hayPorDondeLlamar(undefined), false);
  });
});
