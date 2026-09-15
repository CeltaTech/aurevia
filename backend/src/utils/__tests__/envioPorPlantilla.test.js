/**
 * El mensaje que empieza la Prestadora sale por plantilla, no por texto suelto.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El motor armaba siempre `type: 'text'`. Adentro de una conversación
 * que abrió la otra persona eso anda, y por eso nunca se notó: en las pruebas con una conversación
 * abierta el mensaje llega. El día que la Prestadora empieza el mensaje —que es lo que hace cada
 * aviso al Coordinador y cada recordatorio a la Asistente— Meta lo rechaza, y el aviso se pierde
 * sin que nadie se entere. Lo que se prueba acá son las formas de perderlo:
 *
 *   * mandar como texto suelto un mensaje que la Prestadora empieza;
 *   * mandar la plantilla con el nombre o el idioma tal como los escribió la persona;
 *   * usar una plantilla que Meta todavía no aprobó, o que rechazó;
 *   * usar la plantilla de otra Prestadora;
 *   * completar una plantilla con menos datos de los que pide, que manda una frase incompleta;
 *   * y dar por avisado a alguien a quien no se le avisó.
 *
 * Se levanta la base de mentira y un Meta de mentira, igual que `plantillasWhatsapp.test.js`.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const OTRA_PRESTADORA = '33333333-3333-3333-3333-333333333333';
const PLANTILLA = '22222222-2222-2222-2222-222222222222';
const CUENTA = '100000000000001';
/** El número por el que salen los mensajes. Los mensajes van contra éste y no contra la cuenta. */
const NUMERO = '200000000000002';
const TOKEN = 'token-de-mentira-que-no-tiene-que-salir';
const TELEFONO = '+5491100000000';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba pisa lo que necesita cambiar. */
const respuestas = new Map();
/** Los avisos que quedaron del lado del servidor. Se juntan para no ensuciar la salida. */
let anotados = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const direccion = new URL(req.url, 'http://interno');
    const clave = `${req.method} ${direccion.pathname}`;

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

// Un Meta de mentira, puesto antes de importar nada: la conexión a la base se arma en el momento
// del import y podría quedarse con el `fetch` que encuentre. Lo que no va a Meta se deriva al
// `fetch` de verdad, que es el que usa la base de mentira.
const fetchDeVerdad = globalThis.fetch;
/** Todo lo que se le mandó a Meta, para poder mirarlo y para afirmar que NO se le mandó nada. */
let pedidosAMeta = [];
let respuestaDeMeta = { estado: 200, cuerpo: { messages: [{ id: 'wamid.de-mentira' }] } };
globalThis.fetch = async (url, opciones) => {
  const direccion = String(url);
  if (!direccion.startsWith('https://graph.facebook.com/')) return fetchDeVerdad(url, opciones);
  pedidosAMeta.push({
    direccion,
    encabezados: opciones?.headers ?? {},
    cuerpo: opciones?.body ? JSON.parse(opciones.body) : null,
  });
  return new Response(JSON.stringify(respuestaDeMeta.cuerpo), {
    status: respuestaDeMeta.estado,
    headers: { 'Content-Type': 'application/json' },
  });
};

// El import va después de dejar puestas las variables de entorno y el Meta de mentira.
const { avisarPorWhatsapp, enviarWhatsApp, enviarWhatsAppPorPlantilla, plantillaDelEvento } =
  await import('../whatsapp.js');
const { huecosDePlantilla, valoresDePlantilla } = await import('../nombresDeMeta.js');

const avisarDeVerdad = console.error;
console.error = (...partes) => anotados.push(partes.join(' '));

after(() => {
  console.error = avisarDeVerdad;
  globalThis.fetch = fetchDeVerdad;
  baseFalsa.close();
});

/** La plantilla tal como queda en la base después de que Meta la aprobó. */
function plantilla(cambios = {}) {
  return {
    id: PLANTILLA,
    prestadora_id: PRESTADORA,
    nombre_interno: 'Aviso de visita',
    idioma: 'es-AR',
    cuerpo_texto: 'Hola, {{1}}. {{2}}',
    estado: 'aprobada',
    ...cambios,
  };
}

/** La Prestadora con la cuenta y el número configurados, y el token guardado. */
beforeEach(() => {
  anotados = [];
  pedidosAMeta = [];
  respuestaDeMeta = { estado: 200, cuerpo: { messages: [{ id: 'wamid.de-mentira' }] } };
  respuestas.clear();
  respuestas.set('GET /rest/v1/configuracion_whatsapp_prestadora', () => [
    { activo: true, phone_number_id: NUMERO, waba_id: CUENTA },
  ]);
  respuestas.set('POST /rest/v1/rpc/leer_token_whatsapp', () => TOKEN);
});

describe('cuántos datos pide una plantilla', () => {
  it('cuenta el hueco más alto y no cuántas veces aparece', () => {
    assert.equal(huecosDePlantilla('Hola, {{1}}. Le escribimos a {{1}} por {{2}}.'), 2);
  });

  it('un texto sin huecos no pide ninguno', () => {
    assert.equal(huecosDePlantilla('Le recordamos su visita de mañana.'), 0);
  });

  it('entrega los valores en orden y descarta los que sobran', () => {
    assert.deepEqual(valoresDePlantilla('Hola, {{1}}.', ['uno', 'dos']), ['uno']);
  });

  it('no completa con vacío lo que falta: devuelve nada', () => {
    assert.equal(valoresDePlantilla('Hola, {{1}}. {{2}}', ['uno']), null);
  });

  it('un valor vacío no cuenta como dato', () => {
    assert.equal(valoresDePlantilla('Hola, {{1}}.', ['   ']), null);
  });
});

describe('el mensaje que empieza la Prestadora', () => {
  it('sale por el número, no por la cuenta', async () => {
    await enviarWhatsAppPorPlantilla({
      prestadoraId: PRESTADORA,
      telefono: TELEFONO,
      plantilla: plantilla(),
      valores: ['Ana', 'Le recordamos su visita.'],
    });

    assert.equal(pedidosAMeta.length, 1);
    assert.ok(pedidosAMeta[0].direccion.endsWith(`/${NUMERO}/messages`));
    assert.ok(!pedidosAMeta[0].direccion.includes(CUENTA));
  });

  it('va como plantilla y nunca como texto suelto', async () => {
    await enviarWhatsAppPorPlantilla({
      prestadoraId: PRESTADORA,
      telefono: TELEFONO,
      plantilla: plantilla(),
      valores: ['Ana', 'Le recordamos su visita.'],
    });

    assert.deepEqual(pedidosAMeta[0].cuerpo, {
      messaging_product: 'whatsapp',
      to: TELEFONO,
      type: 'template',
      template: {
        name: 'aviso_de_visita',
        language: { code: 'es_AR' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Ana' },
              { type: 'text', text: 'Le recordamos su visita.' },
            ],
          },
        ],
      },
    });
  });

  it('nombra la plantilla igual que el alta, con la forma que Meta admite', async () => {
    await enviarWhatsAppPorPlantilla({
      prestadoraId: PRESTADORA,
      telefono: TELEFONO,
      plantilla: plantilla({ nombre_interno: 'Confirmación de día', idioma: 'pt-BR' }),
      valores: ['Ana', 'Hola'],
    });

    assert.equal(pedidosAMeta[0].cuerpo.template.name, 'confirmacion_de_dia');
    assert.equal(pedidosAMeta[0].cuerpo.template.language.code, 'pt_BR');
  });

  it('una plantilla sin huecos viaja sin componentes', async () => {
    await enviarWhatsAppPorPlantilla({
      prestadoraId: PRESTADORA,
      telefono: TELEFONO,
      plantilla: plantilla({ cuerpo_texto: 'Le recordamos su visita de mañana.' }),
      valores: ['Ana', 'Le recordamos su visita.'],
    });

    assert.equal(pedidosAMeta[0].cuerpo.template.components, undefined);
  });

  it('el token viaja en el encabezado y no en el cuerpo', async () => {
    await enviarWhatsAppPorPlantilla({
      prestadoraId: PRESTADORA,
      telefono: TELEFONO,
      plantilla: plantilla(),
      valores: ['Ana', 'Hola'],
    });

    assert.equal(pedidosAMeta[0].encabezados.Authorization, `Bearer ${TOKEN}`);
    assert.ok(!JSON.stringify(pedidosAMeta[0].cuerpo).includes(TOKEN));
  });

  it('no manda nada con una plantilla que Meta todavía no aprobó', async () => {
    await assert.rejects(
      enviarWhatsAppPorPlantilla({
        prestadoraId: PRESTADORA,
        telefono: TELEFONO,
        plantilla: plantilla({ estado: 'enviada_meta' }),
        valores: ['Ana', 'Hola'],
      }),
      /whatsapp_plantilla_no_aprobada/,
    );
    assert.equal(pedidosAMeta.length, 0);
  });

  it('no manda una frase incompleta cuando falta un dato', async () => {
    await assert.rejects(
      enviarWhatsAppPorPlantilla({
        prestadoraId: PRESTADORA,
        telefono: TELEFONO,
        plantilla: plantilla(),
        valores: ['Ana'],
      }),
      /whatsapp_plantilla_incompleta/,
    );
    assert.equal(pedidosAMeta.length, 0);
  });

  it('no manda nada si la Prestadora no tiene WhatsApp configurado', async () => {
    respuestas.set('GET /rest/v1/configuracion_whatsapp_prestadora', () => []);

    await assert.rejects(
      enviarWhatsAppPorPlantilla({
        prestadoraId: PRESTADORA,
        telefono: TELEFONO,
        plantilla: plantilla(),
        valores: ['Ana', 'Hola'],
      }),
      /whatsapp_no_configurado/,
    );
    assert.equal(pedidosAMeta.length, 0);
  });

  it('lo que Meta contesta cuando no acepta no sale con el token adentro', async () => {
    respuestaDeMeta = { estado: 400, cuerpo: { error: { message: 'Template name does not exist' } } };

    await assert.rejects(
      enviarWhatsAppPorPlantilla({
        prestadoraId: PRESTADORA,
        telefono: TELEFONO,
        plantilla: plantilla(),
        valores: ['Ana', 'Hola'],
      }),
      (err) => err.message.startsWith('whatsapp_envio_fallido') && !err.message.includes(TOKEN),
    );
  });
});

describe('la respuesta adentro de una conversación abierta', () => {
  it('sigue saliendo como texto suelto', async () => {
    await enviarWhatsApp({ prestadoraId: PRESTADORA, telefono: TELEFONO, texto: 'Ya la avisamos.' });

    assert.deepEqual(pedidosAMeta[0].cuerpo, {
      messaging_product: 'whatsapp',
      to: TELEFONO,
      type: 'text',
      text: { body: 'Ya la avisamos.' },
    });
  });
});

describe('con qué plantilla sale cada aviso', () => {
  it('la pide por identificador y acotada a la Prestadora', async () => {
    let parametros = null;
    respuestas.set('GET /rest/v1/plantillas_whatsapp', (busqueda) => {
      parametros = busqueda;
      return [plantilla()];
    });

    const elegida = await plantillaDelEvento(PLANTILLA, PRESTADORA);

    assert.equal(elegida.id, PLANTILLA);
    assert.equal(parametros.get('id'), `eq.${PLANTILLA}`);
    assert.equal(parametros.get('prestadora_id'), `eq.${PRESTADORA}`);
  });

  it('no alcanza la plantilla de otra Prestadora', async () => {
    // La base contesta vacío porque el filtro por Prestadora no la deja pasar. Que la consulta
    // lleve ese filtro lo prueba la anterior; esto prueba que sin fila no se manda nada.
    respuestas.set('GET /rest/v1/plantillas_whatsapp', () => []);

    assert.equal(await plantillaDelEvento(PLANTILLA, OTRA_PRESTADORA), null);
  });

  it('una plantilla que Meta no aprobó no se usa', async () => {
    respuestas.set('GET /rest/v1/plantillas_whatsapp', () => [plantilla({ estado: 'rechazada' })]);

    assert.equal(await plantillaDelEvento(PLANTILLA, PRESTADORA), null);
  });

  it('sin plantilla elegida no se le pregunta nada a la base', async () => {
    assert.equal(await plantillaDelEvento(null, PRESTADORA), null);
  });
});

describe('el aviso de un evento por WhatsApp', () => {
  it('sale con la plantilla que la Prestadora le eligió', async () => {
    respuestas.set('GET /rest/v1/plantillas_whatsapp', () => [plantilla()]);

    const salio = await avisarPorWhatsapp({
      config: { whatsapp_activo: true, plantilla_whatsapp_id: PLANTILLA },
      prestadoraId: PRESTADORA,
      telefono: TELEFONO,
      valores: ['Guardia sin cubrir', 'La guardia de mañana sigue sin Asistente.'],
    });

    assert.equal(salio, true);
    assert.equal(pedidosAMeta.length, 1);
    assert.equal(pedidosAMeta[0].cuerpo.type, 'template');
  });

  it('con el canal apagado no sale aunque haya plantilla elegida', async () => {
    respuestas.set('GET /rest/v1/plantillas_whatsapp', () => [plantilla()]);

    const salio = await avisarPorWhatsapp({
      config: { whatsapp_activo: false, plantilla_whatsapp_id: PLANTILLA },
      prestadoraId: PRESTADORA,
      telefono: TELEFONO,
      valores: ['Guardia sin cubrir', 'La guardia de mañana sigue sin Asistente.'],
    });

    assert.equal(salio, false);
    assert.equal(pedidosAMeta.length, 0);
  });

  it('sin teléfono no sale', async () => {
    respuestas.set('GET /rest/v1/plantillas_whatsapp', () => [plantilla()]);

    const salio = await avisarPorWhatsapp({
      config: { whatsapp_activo: true, plantilla_whatsapp_id: PLANTILLA },
      prestadoraId: PRESTADORA,
      telefono: null,
      valores: ['Guardia sin cubrir', 'La guardia de mañana sigue sin Asistente.'],
    });

    assert.equal(salio, false);
    assert.equal(pedidosAMeta.length, 0);
  });

  it('sin plantilla elegida no se manda nada y se dice que no salió', async () => {
    const salio = await avisarPorWhatsapp({
      config: { whatsapp_activo: true, plantilla_whatsapp_id: null },
      prestadoraId: PRESTADORA,
      telefono: TELEFONO,
      valores: ['Guardia sin cubrir', 'La guardia de mañana sigue sin Asistente.'],
    });

    assert.equal(salio, false);
    assert.equal(pedidosAMeta.length, 0);
  });

  it('con la plantilla sin aprobar tampoco se manda nada', async () => {
    respuestas.set('GET /rest/v1/plantillas_whatsapp', () => [plantilla({ estado: 'enviada_meta' })]);

    const salio = await avisarPorWhatsapp({
      config: { whatsapp_activo: true, plantilla_whatsapp_id: PLANTILLA },
      prestadoraId: PRESTADORA,
      telefono: TELEFONO,
      valores: ['Guardia sin cubrir', 'La guardia de mañana sigue sin Asistente.'],
    });

    assert.equal(salio, false);
    assert.equal(pedidosAMeta.length, 0);
  });
});
