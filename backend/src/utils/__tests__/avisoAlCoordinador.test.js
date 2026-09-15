/**
 * Por dónde le llega un aviso a quien coordina, y a qué número.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. La pantalla de Avisos dibuja una casilla de WhatsApp por aviso, y
 * encenderla no rompe nada: si el aviso no tiene a quién mandárselo, el mensaje simplemente no
 * sale y el correo llega igual. O sea que la casilla puede quedar encendida durante meses sin que
 * nadie note que no hizo nada. Eso es justo lo que pasaba con los avisos que nacen de un proceso
 * —una guardia sin cubrir, un documento por vencer—: ninguno tenía un número de destino.
 *
 * Acá se mira que, con el canal encendido y una plantilla aprobada, el mensaje efectivamente salga
 * al WhatsApp de contacto de la Prestadora; y que con el canal apagado no se le pregunte nada a la
 * base, porque ese aviso va por correo.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const PLANTILLA = '22222222-2222-2222-2222-222222222222';
const NUMERO = '200000000000002';
const TOKEN = 'token-de-mentira-que-no-tiene-que-salir';
const WHATSAPP_DE_LA_PRESTADORA = '+5491100000000';
const TELEFONO_PROPIO = '+5491199999999';

/** Qué contesta la base a cada `MÉTODO /ruta`, y qué rutas se le preguntaron. */
const respuestas = new Map();
let consultas = [];

const baseFalsa = createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    const direccion = new URL(req.url, 'http://interno');
    const clave = `${req.method} ${direccion.pathname}`;
    consultas.push(clave);

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
// Sin casilla de correo configurada el envío por correo se saltea solo, que es lo que acá hace
// falta: lo que se prueba es el otro canal, y el correo tiene sus propias pruebas.
delete process.env.SMTP_USER;

const fetchDeVerdad = globalThis.fetch;
let pedidosAMeta = [];
globalThis.fetch = async (url, opciones) => {
  const direccion = String(url);
  if (!direccion.startsWith('https://graph.facebook.com/')) return fetchDeVerdad(url, opciones);
  pedidosAMeta.push(opciones?.body ? JSON.parse(opciones.body) : null);
  return new Response(JSON.stringify({ messages: [{ id: 'wamid.de-mentira' }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};

const { notificarCoordinador, telefonoDeAvisos } = await import('../whatsapp.js');

after(() => {
  globalThis.fetch = fetchDeVerdad;
  baseFalsa.close();
});

/** La Prestadora con todo puesto: cuenta de Meta, token, plantilla aprobada y número de contacto. */
beforeEach(() => {
  pedidosAMeta = [];
  consultas = [];
  respuestas.clear();
  respuestas.set('GET /rest/v1/configuracion_whatsapp_prestadora', () => [
    { activo: true, phone_number_id: NUMERO, waba_id: '100000000000001' },
  ]);
  respuestas.set('POST /rest/v1/rpc/leer_token_whatsapp', () => TOKEN);
  respuestas.set('GET /rest/v1/plantillas_whatsapp', () => [
    {
      id: PLANTILLA,
      prestadora_id: PRESTADORA,
      nombre_interno: 'Documento por vencer',
      idioma: 'es-AR',
      cuerpo_texto: '{{1}}: {{2}}',
      estado: 'aprobada',
    },
  ]);
  respuestas.set('GET /rest/v1/configuracion_prestadora', () => [
    { whatsapp_numero: WHATSAPP_DE_LA_PRESTADORA },
  ]);
  respuestas.set('GET /rest/v1/configuracion_notificaciones', () => [
    { emails: [], activo: true, whatsapp_activo: true, notificar_familia: false, plantilla_whatsapp_id: PLANTILLA },
  ]);
});

describe('a qué número le llega un aviso', () => {
  it('al WhatsApp de contacto de la Prestadora cuando quien avisa no tiene uno', async () => {
    await notificarCoordinador({
      evento: 'vencimiento_documento_asistente',
      prestadoraId: PRESTADORA,
      asunto: 'Documentos por vencer',
      texto: 'Hay documentos que vencen esta semana.',
    });

    assert.equal(pedidosAMeta.length, 1);
    assert.equal(pedidosAMeta[0].to, WHATSAPP_DE_LA_PRESTADORA);
    assert.equal(pedidosAMeta[0].type, 'template');
  });

  it('el número propio de quien avisa gana sobre el de contacto', async () => {
    await notificarCoordinador({
      evento: 'incidente_relevo_sin_resolver',
      prestadoraId: PRESTADORA,
      asunto: 'Incidente sin resolver',
      texto: 'Nadie lo resolvió.',
      telefono: TELEFONO_PROPIO,
    });

    assert.equal(pedidosAMeta[0].to, TELEFONO_PROPIO);
  });

  it('sin número de contacto cargado no se manda nada por WhatsApp', async () => {
    respuestas.set('GET /rest/v1/configuracion_prestadora', () => [{ whatsapp_numero: null }]);

    await notificarCoordinador({
      evento: 'vencimiento_documento_asistente',
      prestadoraId: PRESTADORA,
      asunto: 'Documentos por vencer',
      texto: 'Hay documentos que vencen esta semana.',
    });

    assert.equal(pedidosAMeta.length, 0);
  });

  it('con el canal apagado ni se le pregunta el número a la base', async () => {
    respuestas.set('GET /rest/v1/configuracion_notificaciones', () => [
      { emails: [], activo: true, whatsapp_activo: false, notificar_familia: false, plantilla_whatsapp_id: PLANTILLA },
    ]);

    await notificarCoordinador({
      evento: 'vencimiento_documento_asistente',
      prestadoraId: PRESTADORA,
      asunto: 'Documentos por vencer',
      texto: 'Hay documentos que vencen esta semana.',
    });

    assert.equal(pedidosAMeta.length, 0);
    assert.ok(!consultas.includes('GET /rest/v1/configuracion_prestadora'));
  });

  it('el número se pide acotado a la Prestadora', async () => {
    let parametros = null;
    respuestas.set('GET /rest/v1/configuracion_prestadora', (busqueda) => {
      parametros = busqueda;
      return [{ whatsapp_numero: WHATSAPP_DE_LA_PRESTADORA }];
    });

    assert.equal(await telefonoDeAvisos(PRESTADORA), WHATSAPP_DE_LA_PRESTADORA);
    assert.equal(parametros.get('prestadora_id'), `eq.${PRESTADORA}`);
  });
});
