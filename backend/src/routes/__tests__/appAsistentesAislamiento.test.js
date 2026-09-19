/**
 * Las consultas de la aplicación del Asistente que cuelgan de su identificador y de nada más:
 * sus calificaciones, su consentimiento y la baja del aviso al celular.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El motor entra a la base con la llave de servicio y se saltea la
 * protección por fila, así que lo único que separa una Prestadora de otra son los filtros
 * escritos en cada consulta. Estas tres se apoyaban nada más que en el identificador del
 * Asistente, y una misma persona tiene una ficha por cada Prestadora donde trabaja: el día que
 * ese identificador se repita, la aplicación muestra lo de otra Prestadora y la pantalla se ve
 * igual de bien. No lo encuentra nadie mirando.
 *
 * La del consentimiento es la que más pesa: de esa lectura sale el identificador con el que
 * después se retira o se reemplaza una decisión, así que el filtro de acá es el que sostiene
 * todo lo que viene atrás.
 *
 * Qué daría con el sistema roto: si a cualquiera de las tres le faltara el filtro, su
 * comprobación falla. Los datos son inventados.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';
import { olvidarPedidos } from '../../middleware/topeDePedidos.js';

const PRESTADORA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USUARIO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // la cuenta: usuarios.id === auth.uid()
// El Legajo de esa persona en esta Prestadora. Es a propósito otro número que el de la cuenta: si
// alguna consulta volviera a usar el de la cuenta, estas comprobaciones fallan.
const LEGAJO = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CALIFICACION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/** Qué contesta la base a cada `MÉTODO /ruta`. Cada prueba prepara lo suyo. */
const respuestas = new Map();
/** Todo lo que el motor le pidió a la base, con la dirección entera: los filtros van ahí. */
let llamadas = [];

const baseFalsa = createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    llamadas.push({ clave, url: req.url });

    const preparada = respuestas.get(clave);
    // Lo que esta prueba no prepara contesta vacío: acá se mira con qué filtros se consultó una
    // sola tabla, y hacer fallar el pedido entero por una consulta de al lado no probaría eso.
    const valor = typeof preparada === 'function' ? preparada({ url: req.url }) : preparada ?? [];

    // `.single()` y `.maybeSingle()` piden una fila sola con este encabezado.
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
const { appAsistentesRouter } = await import('../appAsistentes.js');
const { appAsistentesConsentimientosRouter } = await import('../appAsistentesConsentimientos.js');

const app = express();
app.use(express.json());
// El mismo orden de montaje que en `server.js`: el camino más largo primero.
app.use('/api/app-asistentes/consentimientos', appAsistentesConsentimientosRouter);
app.use('/api/app-asistentes', appAsistentesRouter);
const motor = app.listen(0, '127.0.0.1');
await new Promise((listo) => motor.on('listening', listo));
const DIRECCION = `http://127.0.0.1:${motor.address().port}/api/app-asistentes`;

after(() => {
  motor.close();
  baseFalsa.close();
});

/** Las direcciones con las que se consultó una tabla. Los filtros están ahí. */
function consultasA(tabla, metodo = 'GET') {
  return llamadas.filter((l) => l.clave === `${metodo} /rest/v1/${tabla}`).map((l) => l.url);
}

beforeEach(() => {
  respuestas.clear();
  llamadas = [];
  // El tope de pedidos por minuto lleva su cuenta en la memoria del proceso y todas las pruebas
  // entran con el mismo Asistente: sin esto, las últimas fallarían por algo que no prueban.
  olvidarPedidos();
  delete process.env.TOPE_PEDIDOS_POR_MINUTO;

  respuestas.set('GET /auth/v1/user', { id: USUARIO, aud: 'authenticated' });
  respuestas.set('GET /rest/v1/usuarios', [{ rol: 'asistente', prestadora_id: PRESTADORA }]);
  // El Legajo con el que entra la sesión: lo busca el middleware por la cuenta y la Prestadora.
  respuestas.set('GET /rest/v1/asistentes', [{ id: LEGAJO, prestadora_id: PRESTADORA }]);
});

describe('las calificaciones que el Asistente ve de sí mismo', () => {
  it('se piden filtradas por la Prestadora de la sesión', async () => {
    respuestas.set('GET /rest/v1/calificaciones_asistente', [
      { id: CALIFICACION, estrellas: 4, comentario: null, visible_publica: true,
        descargo_asistente: null, descargo_en: null, created_at: '2026-09-01T10:00:00Z' },
    ]);

    const respuesta = await fetch(`${DIRECCION}/calificaciones`, {
      headers: { Authorization: 'Bearer token-de-mentira' },
    });
    assert.equal(respuesta.status, 200);

    const [url] = consultasA('calificaciones_asistente');
    assert.ok(url, 'no se consultaron las calificaciones');
    assert.ok(
      url.includes(`prestadora_id=eq.${PRESTADORA}`),
      'la consulta de las calificaciones no lleva el filtro de Prestadora'
    );
    assert.ok(url.includes(`asistente_id=eq.${LEGAJO}`), url);
  });
});

describe('la baja del aviso al celular', () => {
  it('borra la suscripción de esta Prestadora, no la de cualquiera', async () => {
    respuestas.set('DELETE /rest/v1/push_subscriptions', []);

    const respuesta = await fetch(`${DIRECCION}/push/suscribir`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer token-de-mentira', 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint: 'https://aviso.ejemplo.test/abc' }),
    });
    assert.equal(respuesta.status, 200);

    const [url] = consultasA('push_subscriptions', 'DELETE');
    assert.ok(url, 'no se borró ninguna suscripción');
    assert.ok(
      url.includes(`prestadora_id=eq.${PRESTADORA}`),
      'la baja de la suscripción no lleva el filtro de Prestadora'
    );
    assert.ok(url.includes(`asistente_id=eq.${LEGAJO}`), url);
  });
});

describe('la decisión de consentimiento que ya tomó', () => {
  it('se lee filtrada por la Prestadora de la sesión', async () => {
    respuestas.set('GET /rest/v1/asistentes', [
      { id: LEGAJO, prestadora_id: PRESTADORA, tipo_vinculo: 'monotributo' },
    ]);
    respuestas.set('GET /rest/v1/prestadoras', [{ pais: 'AR' }]);
    respuestas.set('GET /rest/v1/textos_consentimiento', [
      { id: 't-1', version: 1, idioma: 'es-AR', titulo: 'Título inventado', cuerpo: 'Cuerpo inventado',
        puntos_clave: [], es_borrador: false },
    ]);
    respuestas.set('GET /rest/v1/consentimientos_asistente', []);

    const respuesta = await fetch(`${DIRECCION}/consentimientos`, {
      headers: { Authorization: 'Bearer token-de-mentira' },
    });
    assert.equal(respuesta.status, 200);

    const [url] = consultasA('consentimientos_asistente');
    assert.ok(url, 'no se leyó la decisión');
    assert.ok(
      url.includes(`prestadora_id=eq.${PRESTADORA}`),
      'la lectura del consentimiento no lleva el filtro de Prestadora'
    );
    assert.ok(url.includes(`asistente_id=eq.${LEGAJO}`), url);
  });
});
