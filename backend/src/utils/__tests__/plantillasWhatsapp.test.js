/**
 * El alta de una plantilla de mensaje en Meta.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Hasta acá el botón «Enviar a Meta» del Panel no le preguntaba nada a
 * Meta: cambiaba el estado guardado y listo. La plantilla quedaba escrita como enviada, nadie la
 * había dado de alta en ningún lado, y el día que hiciera falta usarla el mensaje rebotaba. Lo que
 * se prueba acá no es que ande el camino feliz —eso es lo fácil— sino las formas de salir mal, que
 * son las que dejan una plantilla escrita como algo que no es:
 *
 *   * pedirla contra el número en vez de contra la cuenta, que es el error de identificador que
 *     Meta contesta con un rechazo difícil de leer;
 *   * mandarle el nombre o el idioma tal como los escribió la persona, que Meta no admite;
 *   * guardar «esperando» una plantilla que Meta ya aprobó o ya rechazó en el momento;
 *   * darla por dada de alta cuando Meta no contestó ningún identificador;
 *   * y dejar que lo que Meta contesta —o el token de la Prestadora— salga hacia afuera.
 *
 * Se levanta la base de mentira igual que `altaEnPasarela.test.js`, y un Meta de mentira puesto en
 * lugar de `fetch`: lo que no va a Meta se deriva al `fetch` de verdad, que es el que usa la base.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const PLANTILLA = '22222222-2222-2222-2222-222222222222';
/** La cuenta de WhatsApp Business, que es contra la que se dan de alta las plantillas. */
const CUENTA = '100000000000001';
/** El número por el que salen los mensajes. Es otro, y no sirve para esto. */
const NUMERO = '200000000000002';
const TOKEN = 'token-de-mentira-que-no-tiene-que-salir';

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
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada() : preparada;
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

// Un Meta de mentira. Se pone antes de importar nada porque la conexión a la base se arma en el
// momento del import y podría quedarse con el `fetch` que encuentre; derivar lo que no es de Meta
// al `fetch` de verdad deja andando a las dos.
const fetchDeVerdad = globalThis.fetch;
/** Todo lo que se le mandó a Meta, para poder mirarlo y para afirmar que NO se le mandó nada. */
let pedidosAMeta = [];
/** Lo que Meta contesta. Cada prueba lo pisa; si es una función se le pasa la dirección, que es lo
 *  que hace falta para contestar distinto en cada pedazo de una lista paginada. */
let respuestaDeMeta = { estado: 200, cuerpo: { id: '900000000000009', status: 'PENDING' } };
globalThis.fetch = async (url, opciones) => {
  const direccion = String(url);
  if (!direccion.startsWith('https://graph.facebook.com/')) return fetchDeVerdad(url, opciones);
  pedidosAMeta.push({
    direccion,
    encabezados: opciones?.headers ?? {},
    cuerpo: opciones?.body ? JSON.parse(opciones.body) : null,
  });
  const preparada = typeof respuestaDeMeta === 'function' ? respuestaDeMeta(direccion) : respuestaDeMeta;
  return new Response(JSON.stringify(preparada.cuerpo), {
    status: preparada.estado,
    headers: { 'Content-Type': 'application/json' },
  });
};

// El import va después de dejar puestas las variables de entorno y el Meta de mentira.
const { darDeAltaEnMeta, estadoSegunMeta, motivoDeMeta, nombreParaMeta, traerEstadosDeMeta } =
  await import('../plantillasWhatsapp.js');

const avisarDeVerdad = console.error;
console.error = (...partes) => anotados.push(partes.join(' '));

after(() => {
  console.error = avisarDeVerdad;
  globalThis.fetch = fetchDeVerdad;
  baseFalsa.close();
});

/** La plantilla tal como está en la base antes de salir: un borrador que escribió una persona. */
function plantilla(cambios = {}) {
  return {
    id: PLANTILLA,
    prestadora_id: PRESTADORA,
    nombre_interno: 'Aviso de visita',
    categoria: 'utility',
    idioma: 'es-AR',
    cuerpo_texto: 'Le recordamos su visita de mañana.',
    estado: 'borrador',
    ...cambios,
  };
}

/** La Prestadora con la cuenta y el número configurados, y el token guardado. */
beforeEach(() => {
  anotados = [];
  pedidosAMeta = [];
  respuestaDeMeta = { estado: 200, cuerpo: { id: '900000000000009', status: 'PENDING' } };
  respuestas.clear();
  respuestas.set('GET /rest/v1/configuracion_whatsapp_prestadora', () => [
    { activo: true, phone_number_id: NUMERO, waba_id: CUENTA },
  ]);
  respuestas.set('POST /rest/v1/rpc/leer_token_whatsapp', () => TOKEN);
});

describe('el nombre con el que la plantilla queda dada de alta en Meta', () => {
  it('baja las mayúsculas y reemplaza lo que Meta no admite', () => {
    assert.equal(nombreParaMeta('Aviso de Visita'), 'aviso_de_visita');
  });

  it('saca las tildes en vez de convertirlas en guión bajo', () => {
    assert.equal(nombreParaMeta('Confirmación de día'), 'confirmacion_de_dia');
  });

  it('no deja guiones bajos colgando en las puntas', () => {
    assert.equal(nombreParaMeta('  ¡Aviso!  '), 'aviso');
  });

  it('deja pasar el que ya viene en la forma que Meta admite', () => {
    assert.equal(nombreParaMeta('aviso_de_visita_2'), 'aviso_de_visita_2');
  });
});

describe('el alta que sale bien', () => {
  it('la pide contra la cuenta de WhatsApp Business y no contra el número', async () => {
    await darDeAltaEnMeta(plantilla());

    assert.equal(pedidosAMeta.length, 1);
    assert.ok(
      pedidosAMeta[0].direccion.endsWith(`/${CUENTA}/message_templates`),
      `la pidió a ${pedidosAMeta[0].direccion}`,
    );
    assert.ok(!pedidosAMeta[0].direccion.includes(NUMERO));
  });

  it('manda el nombre, el idioma, la categoría y el cuerpo como los pide Meta', async () => {
    await darDeAltaEnMeta(plantilla());

    assert.deepEqual(pedidosAMeta[0].cuerpo, {
      name: 'aviso_de_visita',
      language: 'es_AR',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Le recordamos su visita de mañana.' }],
    });
  });

  it('manda el token en el encabezado y no en el cuerpo del pedido', async () => {
    await darDeAltaEnMeta(plantilla());

    assert.equal(pedidosAMeta[0].encabezados.Authorization, `Bearer ${TOKEN}`);
    assert.ok(!JSON.stringify(pedidosAMeta[0].cuerpo).includes(TOKEN));
  });

  it('devuelve el identificador que contestó Meta, como texto', async () => {
    respuestaDeMeta = { estado: 200, cuerpo: { id: 900000000000009, status: 'PENDING' } };

    const resultado = await darDeAltaEnMeta(plantilla());

    assert.deepEqual(resultado, { metaTemplateId: '900000000000009', estado: 'enviada_meta' });
  });
});

describe('el idioma dicho como lo nombra Meta', () => {
  for (const [delProducto, deMeta] of [
    ['es-AR', 'es_AR'],
    ['en', 'en_US'],
    ['pt-BR', 'pt_BR'],
  ]) {
    it(`${delProducto} sale como ${deMeta}`, async () => {
      await darDeAltaEnMeta(plantilla({ idioma: delProducto }));
      assert.equal(pedidosAMeta[0].cuerpo.language, deMeta);
    });
  }

  it('un idioma que el producto no tiene no deja la plantilla sin idioma', async () => {
    await darDeAltaEnMeta(plantilla({ idioma: 'fr-CA' }));
    assert.equal(pedidosAMeta[0].cuerpo.language, 'es_AR');
  });
});

describe('el estado que queda guardado según lo que Meta contesta', () => {
  for (const [deMeta, guardado] of [
    ['APPROVED', 'aprobada'],
    ['REJECTED', 'rechazada'],
    ['PENDING', 'enviada_meta'],
  ]) {
    it(`${deMeta} se guarda como ${guardado}`, async () => {
      respuestaDeMeta = { estado: 200, cuerpo: { id: '77', status: deMeta } };
      const resultado = await darDeAltaEnMeta(plantilla());
      assert.equal(resultado.estado, guardado);
    });
  }

  it('un estado que Meta todavía no tenía queda esperando, no aprobado', async () => {
    respuestaDeMeta = { estado: 200, cuerpo: { id: '77', status: 'SOMETHING_NEW' } };
    const resultado = await darDeAltaEnMeta(plantilla());
    assert.equal(resultado.estado, 'enviada_meta');
  });
});

describe('cuando no se puede dar de alta', () => {
  it('sin la cuenta configurada avisa que falta, y no le pregunta nada a Meta', async () => {
    respuestas.set('GET /rest/v1/configuracion_whatsapp_prestadora', () => [
      { activo: true, phone_number_id: NUMERO, waba_id: null },
    ]);

    await assert.rejects(darDeAltaEnMeta(plantilla()), (err) => {
      assert.equal(err.motivo, 'whatsapp_sin_cuenta');
      return true;
    });
    assert.equal(pedidosAMeta.length, 0);
  });

  it('con WhatsApp apagado avisa lo mismo', async () => {
    respuestas.set('GET /rest/v1/configuracion_whatsapp_prestadora', () => [
      { activo: false, phone_number_id: NUMERO, waba_id: CUENTA },
    ]);

    await assert.rejects(darDeAltaEnMeta(plantilla()), (err) => err.motivo === 'whatsapp_sin_cuenta');
    assert.equal(pedidosAMeta.length, 0);
  });

  it('sin el token guardado avisa lo mismo', async () => {
    respuestas.set('POST /rest/v1/rpc/leer_token_whatsapp', () => null);

    await assert.rejects(darDeAltaEnMeta(plantilla()), (err) => err.motivo === 'whatsapp_sin_cuenta');
    assert.equal(pedidosAMeta.length, 0);
  });

  it('cuando Meta rechaza, sube el motivo y el detalle se queda de este lado', async () => {
    respuestaDeMeta = {
      estado: 400,
      cuerpo: { error: { message: 'Template name is invalid', code: 100 } },
    };

    await assert.rejects(darDeAltaEnMeta(plantilla()), (err) => {
      assert.equal(err.motivo, 'meta_no_acepto');
      // El detalle existe, y es lo que se guarda para que alguien corrija la plantilla. Lo que no
      // puede pasar es que lleve el token de la Prestadora adentro.
      assert.ok(err.message.includes('Template name is invalid'));
      assert.ok(!err.message.includes(TOKEN));
      return true;
    });
  });

  it('una respuesta sin identificador no se da por dada de alta', async () => {
    respuestaDeMeta = { estado: 200, cuerpo: { status: 'PENDING' } };

    await assert.rejects(darDeAltaEnMeta(plantilla()), (err) => err.motivo === 'meta_no_acepto');
  });
});

describe('lo que dice Meta, dicho como lo guarda el producto', () => {
  it('lo que se puede usar y lo que no', () => {
    assert.equal(estadoSegunMeta('APPROVED'), 'aprobada');
    assert.equal(estadoSegunMeta('REJECTED'), 'rechazada');
    // Una plantilla pausada o dada de baja no entrega: queda del lado de la que no se puede usar,
    // porque dejarla «esperando» diría que va a salir cuando no va a salir.
    assert.equal(estadoSegunMeta('PAUSED'), 'rechazada');
    assert.equal(estadoSegunMeta('DISABLED'), 'rechazada');
    assert.equal(estadoSegunMeta('PENDING'), 'enviada_meta');
    assert.equal(estadoSegunMeta('IN_APPEAL'), 'enviada_meta');
  });

  it('de una respuesta que no se entiende no se deduce que está aprobada', () => {
    assert.equal(estadoSegunMeta('SOMETHING_NEW'), 'enviada_meta');
    assert.equal(estadoSegunMeta(undefined), 'enviada_meta');
    assert.equal(estadoSegunMeta(null), 'enviada_meta');
  });

  it('la objeción se guarda solamente cuando hay algo que corregir', () => {
    assert.equal(motivoDeMeta('REJECTED', 'INVALID_FORMAT'), 'REJECTED: INVALID_FORMAT');
    assert.equal(motivoDeMeta('PAUSED', 'NONE'), 'PAUSED');
    assert.equal(motivoDeMeta('APPROVED', 'NONE'), null);
    // Una plantilla que sigue esperando no tiene objeción, y guardarle una de antes la dejaría
    // mostrando un rechazo que ya no es.
    assert.equal(motivoDeMeta('PENDING', 'INVALID_FORMAT'), null);
  });
});

describe('preguntarle a Meta cómo quedaron las plantillas', () => {
  it('las pide contra la cuenta y devuelve el estado de cada una', async () => {
    respuestaDeMeta = {
      estado: 200,
      cuerpo: {
        data: [
          { id: '1', status: 'APPROVED', rejected_reason: 'NONE' },
          { id: '2', status: 'REJECTED', rejected_reason: 'INVALID_FORMAT' },
          { id: '3', status: 'PENDING' },
        ],
      },
    };

    const estados = await traerEstadosDeMeta(PRESTADORA);

    assert.ok(pedidosAMeta[0].direccion.includes(`/${CUENTA}/message_templates`));
    assert.deepEqual(estados.get('1'), { estado: 'aprobada', motivo: null });
    assert.deepEqual(estados.get('2'), { estado: 'rechazada', motivo: 'REJECTED: INVALID_FORMAT' });
    assert.deepEqual(estados.get('3'), { estado: 'enviada_meta', motivo: null });
  });

  it('las pide todas juntas y no una por una', async () => {
    respuestaDeMeta = { estado: 200, cuerpo: { data: [{ id: '1', status: 'APPROVED' }] } };
    await traerEstadosDeMeta(PRESTADORA);
    assert.equal(pedidosAMeta.length, 1);
  });

  it('sigue la lista hasta el final cuando Meta la entrega de a pedazos', async () => {
    respuestaDeMeta = (direccion) =>
      direccion.includes('pagina=2')
        ? { estado: 200, cuerpo: { data: [{ id: '2', status: 'REJECTED', rejected_reason: 'NONE' }] } }
        : {
            estado: 200,
            cuerpo: {
              data: [{ id: '1', status: 'APPROVED' }],
              paging: { next: 'https://graph.facebook.com/v20.0/algo?pagina=2' },
            },
          };

    const estados = await traerEstadosDeMeta(PRESTADORA);

    assert.equal(estados.size, 2);
    assert.equal(estados.get('2').estado, 'rechazada');
    assert.equal(estados.get('2').motivo, 'REJECTED');
  });

  it('una lista que nunca termina no deja el pedido dando vueltas para siempre', async () => {
    respuestaDeMeta = {
      estado: 200,
      cuerpo: {
        data: [{ id: '1', status: 'PENDING' }],
        paging: { next: 'https://graph.facebook.com/v20.0/siempre-hay-otra' },
      },
    };

    await traerEstadosDeMeta(PRESTADORA);

    assert.ok(pedidosAMeta.length <= 20, `dio ${pedidosAMeta.length} vueltas`);
  });

  it('sin la cuenta configurada avisa que falta, y no le pregunta nada a Meta', async () => {
    respuestas.set('GET /rest/v1/configuracion_whatsapp_prestadora', () => [
      { activo: true, phone_number_id: NUMERO, waba_id: null },
    ]);

    await assert.rejects(traerEstadosDeMeta(PRESTADORA), (err) => err.motivo === 'whatsapp_sin_cuenta');
    assert.equal(pedidosAMeta.length, 0);
  });

  it('cuando Meta no contesta una lista, no se da por sabido que no cambió nada', async () => {
    respuestaDeMeta = { estado: 400, cuerpo: { error: { message: 'Invalid OAuth access token' } } };

    await assert.rejects(traerEstadosDeMeta(PRESTADORA), (err) => {
      assert.equal(err.motivo, 'meta_no_acepto');
      assert.ok(!err.message.includes(TOKEN));
      return true;
    });
  });
});
