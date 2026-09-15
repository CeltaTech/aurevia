/**
 * La IA escribe el texto de una plantilla, y corrige la que Meta rechazó.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Lo que se le pide al modelo se manda como texto, y un texto no
 * falla: si el pedido sale sin lo que Meta objetó, el modelo igual contesta algo, la pantalla
 * igual muestra una propuesta, y nadie se entera de que esa propuesta se escribió a ciegas. Por
 * eso acá se mira lo que viaja hacia el modelo, y no solamente lo que vuelve.
 *
 * Lo otro que se cuida es lo que vuelve: una respuesta que no se puede leer no puede terminar en
 * una plantilla vacía guardada como si fuera un texto.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';

/** Qué contesta la base a cada `MÉTODO /ruta`. */
const respuestas = new Map([['POST /uso_ia', []]]);

const baseFalsa = createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    const clave = `${req.method} ${new URL(req.url, 'http://interno').pathname}`;
    const valor = respuestas.get(clave);
    if (valor === undefined) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `la prueba no preparó respuesta para ${clave}` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(valor));
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';
process.env.ANTHROPIC_API_KEY = 'clave-de-mentira-que-no-sale-de-acá';

/** Todo lo que se le mandó al modelo, que es la mitad de lo que se prueba acá. */
let pedidosAlModelo = [];
/** Lo que el modelo contesta. Cada prueba lo pisa con lo suyo. */
let loQueContesta = null;

// Un modelo de mentira. No alcanza con sustituir `fetch`: el SDK se queda con el suyo, y la
// prueba terminaba saliendo a la API de verdad. La puerta que sí queda es la dirección, que el
// propio SDK lee de `ANTHROPIC_BASE_URL`, puesta acá antes de importar nada.
const modeloFalso = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    pedidosAlModelo.push(JSON.parse(crudo));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'msg_de_mentira',
        type: 'message',
        role: 'assistant',
        model: 'modelo-de-mentira',
        content: [{ type: 'text', text: typeof loQueContesta === 'string' ? loQueContesta : JSON.stringify(loQueContesta) }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
    );
  });
});

await new Promise((listo) => modeloFalso.listen(0, '127.0.0.1', listo));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${modeloFalso.address().port}`;

const { redactarPlantillaWhatsapp, corregirPlantillaWhatsapp } = await import('../iaPlantillasWhatsapp.js');

after(() => {
  baseFalsa.close();
  modeloFalso.close();
});

beforeEach(() => {
  pedidosAlModelo = [];
  loQueContesta = {
    cuerpo: 'Se confirma la guardia de {{1}} para el día {{2}}.',
    huecos: ['el nombre de quien la cubre', 'el día'],
    nota: 'Conviene revisar el texto antes de mandarlo a Meta.',
  };
});

/** Todo lo que se le dijo al modelo en un pedido, junto, para buscar adentro. */
function loQueSeLeDijo(pedido) {
  return [pedido.system, ...pedido.messages.map((m) => m.content)].join('\n');
}

describe('redactar una plantilla', () => {
  it('devuelve el texto, los huecos y la nota', async () => {
    const propuesta = await redactarPlantillaWhatsapp({
      proposito: 'avisarle a la Asistente que le confirmaron una guardia',
      categoria: 'utility',
      idioma: 'es-AR',
      prestadoraId: PRESTADORA,
    });

    assert.equal(propuesta.cuerpo, 'Se confirma la guardia de {{1}} para el día {{2}}.');
    assert.deepEqual(propuesta.huecos, ['el nombre de quien la cubre', 'el día']);
    assert.ok(propuesta.nota.length > 0);
  });

  it('le dice al modelo para qué es el mensaje, en qué idioma y de qué categoría', async () => {
    await redactarPlantillaWhatsapp({
      proposito: 'avisarle a la Asistente que le confirmaron una guardia',
      categoria: 'authentication',
      idioma: 'pt-BR',
      prestadoraId: PRESTADORA,
    });

    const dicho = loQueSeLeDijo(pedidosAlModelo[0]);
    assert.match(dicho, /le confirmaron una guardia/);
    assert.match(dicho, /pt-BR/);
    assert.match(dicho, /authentication/);
    // Y qué es esa categoría, para que no tenga que adivinarlo por el nombre en inglés.
    assert.match(dicho, /código de un solo uso/);
  });

  it('le dice las reglas del texto y el trato con quien lo lee', async () => {
    await redactarPlantillaWhatsapp({ proposito: 'avisar algo', prestadoraId: PRESTADORA });

    const dicho = loQueSeLeDijo(pedidosAlModelo[0]);
    assert.match(dicho, /\{\{1\}\}/);
    assert.match(dicho, /1024/);
    // Lo que nunca puede entrar en un texto que queda guardado del lado de Meta.
    assert.match(dicho, /nada de salud/);
    // El trato sale del punto único, no copiado acá.
    assert.match(dicho, /nunca tutea/);
  });

  it('sin decir para qué es el mensaje no se le pide nada al modelo', async () => {
    await assert.rejects(
      () => redactarPlantillaWhatsapp({ proposito: '   ', prestadoraId: PRESTADORA }),
      (err) => err.motivo === 'faltan_datos',
    );
    assert.equal(pedidosAlModelo.length, 0);
  });

  it('una respuesta que no se puede leer no pasa como propuesta', async () => {
    loQueContesta = 'Acá tiene el texto, sin ningún JSON.';
    await assert.rejects(
      () => redactarPlantillaWhatsapp({ proposito: 'avisar algo', prestadoraId: PRESTADORA }),
      (err) => err.motivo === 'ia_sin_propuesta',
    );
  });

  it('un cuerpo vacío tampoco pasa', async () => {
    loQueContesta = { cuerpo: '   ', huecos: [] };
    await assert.rejects(
      () => redactarPlantillaWhatsapp({ proposito: 'avisar algo', prestadoraId: PRESTADORA }),
      (err) => err.motivo === 'ia_sin_propuesta',
    );
  });
});

describe('corregir la que Meta rechazó', () => {
  const rechazada = {
    id: '22222222-2222-2222-2222-222222222222',
    categoria: 'utility',
    idioma: 'es-AR',
    cuerpo_texto: '{{1}}, aprovechá esta oferta.',
    motivo_rechazo: 'REJECTED: INVALID_FORMAT',
  };

  it('le pasa al modelo el texto rechazado y lo que Meta objetó', async () => {
    await corregirPlantillaWhatsapp({ plantilla: rechazada, prestadoraId: PRESTADORA });

    const dicho = loQueSeLeDijo(pedidosAlModelo[0]);
    assert.match(dicho, /aprovechá esta oferta/);
    assert.match(dicho, /REJECTED: INVALID_FORMAT/);
  });

  it('sin objeción de Meta no hay nada que corregir', async () => {
    await assert.rejects(
      () => corregirPlantillaWhatsapp({
        plantilla: { ...rechazada, motivo_rechazo: null },
        prestadoraId: PRESTADORA,
      }),
      (err) => err.motivo === 'plantilla_sin_rechazo',
    );
    assert.equal(pedidosAlModelo.length, 0);
  });

  it('devuelve una propuesta con la misma forma que la redacción', async () => {
    loQueContesta = {
      cuerpo: 'Se le informa a {{1}} que la guardia quedó confirmada.',
      huecos: ['el nombre de quien la cubre'],
      nota: 'Se sacó el ofrecimiento, que es lo que Meta no acepta en esta categoría.',
    };

    const propuesta = await corregirPlantillaWhatsapp({ plantilla: rechazada, prestadoraId: PRESTADORA });
    assert.equal(propuesta.cuerpo, 'Se le informa a {{1}} que la guardia quedó confirmada.');
    assert.deepEqual(propuesta.huecos, ['el nombre de quien la cubre']);
    assert.match(propuesta.nota, /Meta/);
  });
});
