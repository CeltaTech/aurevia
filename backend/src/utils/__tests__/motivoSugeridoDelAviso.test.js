/**
 * Leer un aviso de ausencia contado con palabras y sugerir uno de los motivos de la Prestadora.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Acá hay dos cosas que no fallan solas y por eso hay que mirarlas.
 *
 * La primera es la lista que viaja al modelo: si se le mandaran motivos de más —los que la
 * Prestadora dio de baja— el modelo igual contestaría algo, la pantalla igual mostraría una
 * sugerencia, y nadie se enteraría de que propone una opción que el desplegable no tiene. Por eso
 * se mira lo que sale hacia el modelo, y no solamente lo que vuelve.
 *
 * La segunda es lo que se contó. Puede traer el diagnóstico de quien llama o el de un familiar
 * suyo, que es dato de salud de una persona que no es Paciente de nadie, y no puede quedar escrito
 * en ningún lado (`celtatech/CLAUDE.md` §6). Una prueba que sólo mirara la respuesta pasaría igual
 * con el texto guardado en el registro de uso.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';

/** Los motivos de esta Prestadora inventada. No son los de ninguna otra, y uno está de baja. */
const MOTIVOS = [
  { nombre: 'Problema de salud propio', activo: true },
  { nombre: 'Se cortó el transporte', activo: true },
  { nombre: 'Tuvo que atender a un familiar', activo: true },
  { nombre: 'Corte de luz en el barrio', activo: false },
];

/** Todo lo que se escribió contra la base, que es donde podría filtrarse lo que se contó. */
let escritoEnLaBase = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    escritoEnLaBase.push({ ruta: new URL(req.url, 'http://interno').pathname, cuerpo: crudo });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';
process.env.ANTHROPIC_API_KEY = 'clave-de-mentira-que-no-sale-de-acá';

/** Todo lo que se le mandó al modelo, que es la otra mitad de lo que se prueba acá. */
let pedidosAlModelo = [];
/** Lo que el modelo contesta. Cada prueba lo pisa con lo suyo. */
let loQueContesta = null;
/** Con qué número contesta el modelo: sirve para probar que una caída no rompe la pantalla. */
let comoContesta = 200;

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
    if (comoContesta !== 200) {
      res.writeHead(comoContesta, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'de mentira' } }));
      return;
    }
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

const { sugerirMotivoDelAviso, nombresElegibles } = await import('../motivoSugeridoDelAviso.js');

after(() => {
  baseFalsa.close();
  modeloFalso.close();
});

beforeEach(() => {
  pedidosAlModelo = [];
  escritoEnLaBase = [];
  comoContesta = 200;
  loQueContesta = { motivo: 'Problema de salud propio' };
});

/** Todo lo que se le dijo al modelo en un pedido, junto, para buscar adentro. */
function loQueSeLeDijo(pedido) {
  return [pedido.system, ...pedido.messages.map((m) => m.content)].join('\n');
}

describe('sugerir el motivo de un aviso', () => {
  it('devuelve uno de los motivos de esa Prestadora', async () => {
    const { motivo } = await sugerirMotivoDelAviso({
      texto: 'Me desperté con fiebre y no voy a poder ir',
      motivos: MOTIVOS,
      prestadoraId: PRESTADORA,
    });

    assert.equal(motivo, 'Problema de salud propio');
  });

  it('le manda al modelo los motivos de esa Prestadora, y sólo los activos', async () => {
    await sugerirMotivoDelAviso({ texto: 'Se cortó el tren', motivos: MOTIVOS, prestadoraId: PRESTADORA });

    const dicho = loQueSeLeDijo(pedidosAlModelo[0]);
    assert.match(dicho, /Problema de salud propio/);
    assert.match(dicho, /Se cortó el transporte/);
    assert.match(dicho, /Tuvo que atender a un familiar/);
    // El que la Prestadora dio de baja no se le ofrece: sugerirlo sería proponer una opción que
    // el desplegable ya no tiene.
    assert.equal(dicho.includes('Corte de luz en el barrio'), false);
    // Y no se le sugieren categorías escritas acá adentro, que es de lo que se salió: los motivos
    // los arma cada Prestadora.
    assert.equal(dicho.includes('Problema de transporte'), false);
  });

  it('un motivo que no está en la lista no llega a la pantalla', async () => {
    // El modelo inventa una categoría razonable, que esta Prestadora no tiene.
    loQueContesta = { motivo: 'Emergencia familiar' };

    const { motivo } = await sugerirMotivoDelAviso({
      texto: 'Tuve que llevar a mi hijo al hospital',
      motivos: MOTIVOS,
      prestadoraId: PRESTADORA,
    });

    assert.equal(motivo, null);
  });

  it('un motivo dado de baja tampoco llega, aunque el modelo lo nombre', async () => {
    loQueContesta = { motivo: 'Corte de luz en el barrio' };

    const { motivo } = await sugerirMotivoDelAviso({
      texto: 'Se cortó la luz y no puedo salir',
      motivos: MOTIVOS,
      prestadoraId: PRESTADORA,
    });

    assert.equal(motivo, null);
  });

  it('cuando ninguno corresponde, no se fuerza ninguno', async () => {
    loQueContesta = { motivo: null };

    const { motivo } = await sugerirMotivoDelAviso({ texto: 'Después le cuento', motivos: MOTIVOS, prestadoraId: PRESTADORA });

    assert.equal(motivo, null);
  });

  it('una respuesta que no se puede leer no pasa como sugerencia', async () => {
    loQueContesta = 'Yo diría que es un problema de salud.';

    const { motivo } = await sugerirMotivoDelAviso({ texto: 'Tengo fiebre', motivos: MOTIVOS, prestadoraId: PRESTADORA });

    assert.equal(motivo, null);
  });

  it('con el modelo caído, la pantalla sigue funcionando sin sugerencia', async () => {
    comoContesta = 529;

    const { motivo } = await sugerirMotivoDelAviso({ texto: 'Tengo fiebre', motivos: MOTIVOS, prestadoraId: PRESTADORA });

    assert.equal(motivo, null);
  });

  it('sin motivos cargados, ni se le pregunta al modelo', async () => {
    const { motivo } = await sugerirMotivoDelAviso({ texto: 'Tengo fiebre', motivos: [], prestadoraId: PRESTADORA });

    assert.equal(motivo, null);
    assert.equal(pedidosAlModelo.length, 0);
  });

  it('sin nada contado, tampoco', async () => {
    const { motivo } = await sugerirMotivoDelAviso({ texto: '   ', motivos: MOTIVOS, prestadoraId: PRESTADORA });

    assert.equal(motivo, null);
    assert.equal(pedidosAlModelo.length, 0);
  });

  it('sin clave de la API devuelve que no hay sugerencia, y no sale a ningún lado', async () => {
    const clave = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    // Una copia nueva del archivo: la de arriba ya armó su cliente con la clave puesta, y lo que
    // se prueba acá es justamente el arranque sin ninguna.
    const sinClave = await import('../motivoSugeridoDelAviso.js?sin-clave');
    try {
      const { motivo } = await sinClave.sugerirMotivoDelAviso({
        texto: 'Tengo fiebre',
        motivos: MOTIVOS,
        prestadoraId: PRESTADORA,
      });
      assert.equal(motivo, null);
      assert.equal(pedidosAlModelo.length, 0);
    } finally {
      process.env.ANTHROPIC_API_KEY = clave;
    }
  });

  it('lo que se contó no queda escrito en ningún lado', async () => {
    const contado = 'Mi mamá tuvo un ACV y estoy en el hospital con ella';

    await sugerirMotivoDelAviso({ texto: contado, motivos: MOTIVOS, prestadoraId: PRESTADORA });
    // El registro de uso se manda sin esperar, así que se le da su vuelta al ciclo de eventos.
    await new Promise((listo) => setTimeout(listo, 50));

    assert.ok(escritoEnLaBase.length > 0, 'la prueba no vale si no se escribió nada en la base');
    for (const { ruta, cuerpo } of escritoEnLaBase) {
      assert.equal(cuerpo.includes('ACV'), false, `lo que se contó llegó a ${ruta}`);
      assert.equal(cuerpo.includes('hospital'), false, `lo que se contó llegó a ${ruta}`);
    }
  });
});

describe('los motivos elegibles', () => {
  it('deja afuera los de baja y los que no tienen nombre', () => {
    const elegibles = nombresElegibles([
      ...MOTIVOS,
      { nombre: '   ', activo: true },
      { nombre: null, activo: true },
    ]);

    assert.deepEqual(elegibles, ['Problema de salud propio', 'Se cortó el transporte', 'Tuvo que atender a un familiar']);
  });

  it('sin lista, no hay elegibles', () => {
    assert.deepEqual(nombresElegibles(undefined), []);
    assert.deepEqual(nombresElegibles(null), []);
  });
});
