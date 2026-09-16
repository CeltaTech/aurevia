/**
 * El correo sale por un despachante que habla por el puerto 443, no por SMTP.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Railway no deja salir tráfico por los puertos de correo, así que
 * el envío por SMTP no entrega nada. Que el motor use el despachante no se puede comprobar
 * mirando el código, porque los dos caminos conviven a propósito: el de SMTP queda para la
 * máquina de desarrollo. Lo que hay que sostener es que **la elección del medio la hacen las
 * variables de entorno**, y no una edición a mano el día del corte.
 *
 * Y hay cuatro cosas más que se rompen en silencio:
 *
 *   1. LOS DESTINATARIOS VIAJAN COMO LISTA. El motor los junta con comas para nodemailer; el
 *      despachante espera una lista. Si se le manda el texto con comas, toma todo eso como una
 *      sola dirección, la rechaza, y no llega ninguno de los avisos de ese evento.
 *   2. LAS RESPUESTAS VUELVEN A LA PRESTADORA. Un aviso sale desde una dirección del producto
 *      que no recibe nada; sin la dirección de respuesta, quien conteste le escribe a un buzón
 *      que no existe y esa respuesta se pierde sin que nadie se entere.
 *   3. EL ERROR NO REPITE EL MENSAJE. El despachante contesta el error con el correo entero
 *      adentro, destinatarios incluidos, y eso no puede terminar en un registro.
 *   4. SIN CREDENCIAL NO SE INTENTA Y NO SE ROMPE. Es lo que ya hacía cuando lo único que
 *      miraba era `SMTP_USER`, y de eso dependen las pruebas que dan de alta cosas que avisan.
 */
import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';

// El módulo de correo arrastra la conexión a la base, que se arma al importarla y no acepta una
// dirección vacía. Acá nunca se la consulta —todos los envíos van sin Prestadora, así que no hay
// marca ni dirección de respuesta que buscar—, pero tiene que existir para que el archivo se
// pueda importar. Se le da una dirección que no lleva a ningún lado a propósito: si alguna vez
// esta prueba empieza a preguntarle algo a la base, se va a notar.
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

const { enviarEmail, hayMedioDeEnvio } = await import('../email.js');

const VARIABLES = ['RESEND_API_KEY', 'REMITENTE_AVISOS', 'SMTP_USER', 'SMTP_PASSWORD'];

let originales;
let fetchOriginal;
let pedidos;

// Se anota lo que va al despachante y nada más. El motor además cuenta cada correo que sale, y
// esa anotación es otro pedido: mezclarla acá haría que esta prueba hablara de dos cosas.
function contestarComoElDespachante({ estado = 200, cuerpo = {} } = {}) {
  globalThis.fetch = async (url, opciones) => {
    if (!String(url).includes('api.resend.com')) {
      return new Response('[]', { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    pedidos.push({ url: String(url), opciones });
    return { ok: estado < 400, status: estado, json: async () => cuerpo };
  };
}

function loQueSeMando(pedido) {
  return JSON.parse(pedido.opciones.body);
}

function cargarCredencialDelDespachante() {
  process.env.RESEND_API_KEY = 'clave-del-despachante';
  process.env.REMITENTE_AVISOS = 'avisos@ejemplo.local';
}

beforeEach(() => {
  originales = Object.fromEntries(VARIABLES.map((nombre) => [nombre, process.env[nombre]]));
  for (const nombre of VARIABLES) delete process.env[nombre];
  fetchOriginal = globalThis.fetch;
  pedidos = [];
});

afterEach(() => {
  for (const nombre of VARIABLES) {
    if (originales[nombre] === undefined) delete process.env[nombre];
    else process.env[nombre] = originales[nombre];
  }
  globalThis.fetch = fetchOriginal;
});

describe('el medio de envío lo eligen las variables de entorno', () => {
  it('sin nada cargado no hay medio, y mandar no rompe ni sale a la red', async () => {
    globalThis.fetch = async () => {
      throw new Error('no se debería salir a la red sin credencial');
    };

    assert.equal(hayMedioDeEnvio(), false);
    await enviarEmail({ to: 'alguien@ejemplo.local', asunto: 'Hola', texto: 'Cuerpo' });
  });

  it('con la credencial del despachante hay medio, aunque no haya ninguna casilla SMTP', () => {
    cargarCredencialDelDespachante();
    assert.equal(hayMedioDeEnvio(), true);
  });

  it('la credencial sin dirección de remitente no alcanza', () => {
    process.env.RESEND_API_KEY = 'clave-del-despachante';
    assert.equal(hayMedioDeEnvio(), false);
  });

  it('la casilla SMTP sola sigue siendo un medio válido, para la máquina de desarrollo', () => {
    process.env.SMTP_USER = 'desarrollo@ejemplo.local';
    assert.equal(hayMedioDeEnvio(), true);
  });
});

describe('enviarEmail por el despachante', () => {
  it('manda el correo con la credencial, el remitente, el destinatario y el cuerpo', async () => {
    cargarCredencialDelDespachante();
    contestarComoElDespachante();

    await enviarEmail({
      to: 'coordinacion@ejemplo.local',
      asunto: 'Guardia sin cerrar',
      texto: 'Hay una guardia de ayer que no se cerro.',
    });

    assert.equal(pedidos.length, 1);
    assert.match(pedidos[0].url, /api\.resend\.com/);
    assert.equal(pedidos[0].opciones.headers.Authorization, 'Bearer clave-del-despachante');

    const mensaje = loQueSeMando(pedidos[0]);
    assert.equal(mensaje.from, 'avisos@ejemplo.local');
    assert.deepEqual(mensaje.to, ['coordinacion@ejemplo.local']);
    assert.equal(mensaje.subject, 'Guardia sin cerrar');
    assert.match(mensaje.text, /no se cerro/);
  });

  it('varios destinatarios viajan como lista, no como un texto con comas', async () => {
    cargarCredencialDelDespachante();
    contestarComoElDespachante();

    await enviarEmail({
      to: 'una@ejemplo.local, otra@ejemplo.local',
      asunto: 'Aviso',
      texto: 'Cuerpo',
    });

    assert.deepEqual(loQueSeMando(pedidos[0]).to, ['una@ejemplo.local', 'otra@ejemplo.local']);
  });

  it('el asunto con acentos llega entero', async () => {
    cargarCredencialDelDespachante();
    contestarComoElDespachante();

    await enviarEmail({
      to: 'coordinacion@ejemplo.local',
      asunto: 'Matrícula próxima a vencer',
      texto: 'Aviso',
    });

    assert.equal(loQueSeMando(pedidos[0]).subject, 'Matrícula próxima a vencer');
  });

  it('sin Prestadora no se manda dirección de respuesta, en vez de mandarla vacía', async () => {
    cargarCredencialDelDespachante();
    contestarComoElDespachante();

    await enviarEmail({ to: 'alguien@ejemplo.local', asunto: 'Uno', texto: 'Uno' });

    assert.equal('reply_to' in loQueSeMando(pedidos[0]), false);
  });

  it('si el despachante rechaza el envío, el error sale con el número y sin el mensaje', async () => {
    cargarCredencialDelDespachante();
    contestarComoElDespachante({
      estado: 422,
      cuerpo: { message: 'to: coordinacion@ejemplo.local no es valida' },
    });

    await assert.rejects(
      () =>
        enviarEmail({ to: 'coordinacion@ejemplo.local', asunto: 'Uno', texto: 'Uno' }),
      (error) => {
        assert.match(error.message, /El despachante rechazó el envío \(422\)/);
        assert.doesNotMatch(error.message, /coordinacion@ejemplo\.local/);
        return true;
      },
    );
  });
});
