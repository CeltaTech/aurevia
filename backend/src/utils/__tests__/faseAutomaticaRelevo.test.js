/**
 * La fase automática de la escalada de relevo: a quién sale a buscar y a quién no.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Hasta acá la fase automática no buscaba a nadie: le avisaba a quien
 * coordina que tendría que haber arrancado. Ahora sale a preguntar quién cubre, y eso son mensajes
 * que le llegan a gente real. Lo que se mira acá es justamente lo que no se puede ver desde
 * afuera: a quiénes se les escribió, en qué orden, y a quiénes no.
 *
 * Nadie recibe el push en esta prueba —no hay claves VAPID cargadas—, así que todos los avisos
 * caen al canal de respaldo. Eso es a propósito: es el camino que deja ver el destinatario.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const PLANTILLA = '22222222-2222-2222-2222-222222222222';
const GUARDIA = '33333333-3333-3333-3333-333333333333';
const AUSENTE = 'aaaaaaaa-0000-0000-0000-000000000001';
const SUPLENTE_LIBRE = 'aaaaaaaa-0000-0000-0000-000000000002';
const SUPLENTE_OCUPADO = 'aaaaaaaa-0000-0000-0000-000000000003';
const FRANQUERO = 'aaaaaaaa-0000-0000-0000-000000000004';

const TELEFONOS = {
  [AUSENTE]: '+5491100000001',
  [SUPLENTE_LIBRE]: '+5491100000002',
  [SUPLENTE_OCUPADO]: '+5491100000003',
  [FRANQUERO]: '+5491100000004',
};

const INCIDENTE = { id: '44444444-4444-4444-4444-444444444444', guardia_entrante_id: GUARDIA, nivel_actual: 1 };

/** La guardia que quedó sin nadie: de 22:00 a 06:00, la que cruza la medianoche. */
const GUARDIA_ENTRANTE = {
  id: GUARDIA,
  asistente_id: AUSENTE,
  fecha: '2026-09-15',
  hora_inicio: '22:00',
  hora_fin: '06:00',
};

const respuestas = new Map();
let consultas = [];
/** Quiénes figuran hoy como plantel activo de la Prestadora. */
let plantelActivo = [];
/** Quiénes movieron su interruptor a "no disponible" desde su aplicación. */
let noDisponibles = new Set();

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
// Sin claves de push nadie recibe el aviso al celular y todos caen al canal de respaldo, que es
// el que deja ver a qué número salió cada mensaje.
delete process.env.VAPID_PUBLIC_KEY;
delete process.env.VAPID_PRIVATE_KEY;

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

const { correrFaseAutomatica, aQuienesSeLesEscribe } = await import('../faseAutomaticaRelevo.js');

after(() => {
  globalThis.fetch = fetchDeVerdad;
  baseFalsa.close();
});

/** El identificador que viaja en un `?columna=eq.<valor>` de PostgREST. */
function valorDe(busqueda, columna) {
  return (busqueda.get(columna) ?? '').replace(/^eq\./, '');
}

beforeEach(() => {
  pedidosAMeta = [];
  consultas = [];
  respuestas.clear();

  respuestas.set('GET /rest/v1/configuracion_escalada_relevo', () => [
    { orden_prioridad: ['suplente', 'franquero'], plantilla_mensaje: 'Necesitamos quien cubra esta noche.' },
  ]);
  respuestas.set('GET /rest/v1/guardias', (busqueda) =>
    busqueda.has('id')
      ? [GUARDIA_ENTRANTE]
      : [
          GUARDIA_ENTRANTE,
          // De 18:00 a 02:00: empieza antes que la entrante y sigue corriendo después de la
          // medianoche, así que a las 22:00 esta persona ya está trabajando.
          { id: 'otra', asistente_id: SUPLENTE_OCUPADO, fecha: '2026-09-15', hora_inicio: '18:00', hora_fin: '02:00' },
        ],
  );
  plantelActivo = [AUSENTE, SUPLENTE_LIBRE, SUPLENTE_OCUPADO, FRANQUERO];
  noDisponibles = new Set();
  // La base falsa filtra de verdad por `disponible_para_ofertas`: si alguien sacara ese filtro
  // de la consulta, acá volverían todos y la prueba lo vería.
  respuestas.set('GET /rest/v1/asistentes', (busqueda) =>
    busqueda.has('estado')
      ? plantelActivo
          .filter((id) => busqueda.get('disponible_para_ofertas') !== 'eq.true' || !noDisponibles.has(id))
          .map((id) => ({ id }))
      : [{ telefono: TELEFONOS[valorDe(busqueda, 'id')] ?? null }],
  );
  respuestas.set('GET /rest/v1/personal_emergencia', () => [
    {
      asistente_id: FRANQUERO,
      tipo: 'franquero',
      asistentes: { estado: 'activo', disponible_para_ofertas: !noDisponibles.has(FRANQUERO) },
    },
  ]);
  respuestas.set('GET /rest/v1/configuracion_notificaciones', () => [
    { emails: [], activo: true, whatsapp_activo: true, notificar_familia: false, plantilla_whatsapp_id: PLANTILLA },
  ]);
  respuestas.set('GET /rest/v1/configuracion_whatsapp_prestadora', () => [
    { activo: true, phone_number_id: '200000000000002', waba_id: '100000000000001' },
  ]);
  respuestas.set('POST /rest/v1/rpc/leer_token_whatsapp', () => 'token-de-mentira');
  respuestas.set('GET /rest/v1/plantillas_whatsapp', () => [
    {
      id: PLANTILLA,
      prestadora_id: PRESTADORA,
      nombre_interno: 'Convocatoria de relevo',
      idioma: 'es-AR',
      cuerpo_texto: '{{1}}: {{2}}',
      estado: 'aprobada',
    },
  ]);
  respuestas.set('GET /rest/v1/push_subscriptions', () => []);
});

const correr = () => correrFaseAutomatica({ incidente: INCIDENTE, prestadoraId: PRESTADORA, idioma: 'es-AR' });

describe('a quiénes sale a buscar la fase automática', () => {
  it('le escribe al suplente libre y al franquero, y no al que faltó', async () => {
    const hecho = await correr();

    const destinos = pedidosAMeta.map((p) => p.to);
    assert.deepEqual(destinos, [TELEFONOS[SUPLENTE_LIBRE], TELEFONOS[FRANQUERO]]);
    assert.equal(hecho.contactados, 2);
  });

  it('no le escribe a quien está adentro de una guardia que se pisa', async () => {
    await correr();

    assert.ok(!pedidosAMeta.map((p) => p.to).includes(TELEFONOS[SUPLENTE_OCUPADO]));
  });

  it('tampoco a quien sigue adentro de la guardia de anoche', async () => {
    // La que quedó sin nadie empieza a las 06:00 de la mañana. Quien entró ayer a las 22:00 sale
    // recién a las 08:00: buscando sólo por la fecha de hoy, aparecería libre.
    const temprana = { ...GUARDIA_ENTRANTE, fecha: '2026-09-16', hora_inicio: '06:00', hora_fin: '14:00' };
    respuestas.set('GET /rest/v1/guardias', (busqueda) =>
      busqueda.has('id')
        ? [temprana]
        : [
            temprana,
            { id: 'anoche', asistente_id: SUPLENTE_OCUPADO, fecha: '2026-09-15', hora_inicio: '22:00', hora_fin: '08:00' },
          ],
    );

    await correr();

    assert.deepEqual(pedidosAMeta.map((p) => p.to), [TELEFONOS[SUPLENTE_LIBRE], TELEFONOS[FRANQUERO]]);
  });

  // El interruptor de disponibilidad lo mueve el propio Asistente
  // (`asistentes.disponible_para_ofertas`). Acá se respeta sin preguntar, y esa es la diferencia
  // con el panel de cobertura: allá la lista la lee una persona, que puede llamarlo igual porque
  // sabe algo que el sistema no sabe; acá no hay nadie leyendo, sale un mensaje solo.
  it('no le escribe a quien se puso como no disponible', async () => {
    noDisponibles.add(SUPLENTE_LIBRE);

    await correr();

    assert.ok(!pedidosAMeta.map((p) => p.to).includes(TELEFONOS[SUPLENTE_LIBRE]));
    assert.deepEqual(pedidosAMeta.map((p) => p.to), [TELEFONOS[FRANQUERO]]);
  });

  it('y estar anotado en el roster de emergencia no lo hace una excepción', async () => {
    noDisponibles.add(FRANQUERO);

    await correr();

    assert.deepEqual(pedidosAMeta.map((p) => p.to), [TELEFONOS[SUPLENTE_LIBRE]]);
  });

  it('el orden que escribió la Prestadora es el orden en que salen los mensajes', async () => {
    respuestas.set('GET /rest/v1/configuracion_escalada_relevo', () => [
      { orden_prioridad: ['franquero', 'suplente'], plantilla_mensaje: 'Necesitamos quien cubra esta noche.' },
    ]);

    await correr();

    assert.deepEqual(pedidosAMeta.map((p) => p.to), [TELEFONOS[FRANQUERO], TELEFONOS[SUPLENTE_LIBRE]]);
  });

  it('el mensaje que sale es el que escribió la Prestadora, sin retoques', async () => {
    await correr();

    const valores = pedidosAMeta[0].template.components[0].parameters.map((p) => p.text);
    assert.equal(valores[1], 'Necesitamos quien cubra esta noche.');
  });

  it('sin nivel de escalada configurado no se contacta a nadie, y se dice por qué', async () => {
    respuestas.set('GET /rest/v1/configuracion_escalada_relevo', () => []);

    const hecho = await correr();

    assert.equal(pedidosAMeta.length, 0);
    assert.equal(hecho.sinNivel, true);
    // Ni siquiera se le pregunta a la base quién está disponible: sin orden cargado no hay a quién
    // escribirle, y esas consultas serían por nada.
    assert.ok(!consultas.includes('GET /rest/v1/personal_emergencia'));
  });

  it('sin orden de prioridad cargado tampoco, y se dice por qué', async () => {
    respuestas.set('GET /rest/v1/configuracion_escalada_relevo', () => [
      { orden_prioridad: [], plantilla_mensaje: 'Necesitamos quien cubra esta noche.' },
    ]);

    const hecho = await correr();

    assert.equal(pedidosAMeta.length, 0);
    assert.equal(hecho.sinOrden, true);
  });

  it('al familiar no le escribe el sistema: ese escalón queda en manos de quien coordina', async () => {
    respuestas.set('GET /rest/v1/configuracion_escalada_relevo', () => [
      { orden_prioridad: ['familiar'], plantilla_mensaje: 'Necesitamos quien cubra esta noche.' },
    ]);

    const hecho = await correr();

    assert.equal(pedidosAMeta.length, 0);
    assert.equal(hecho.quedaElFamiliar, true);
    assert.equal(hecho.sinOrden, false);
  });

  it('quien se fue de la Prestadora no es un candidato, aunque siga anotado en el roster', async () => {
    // El roster de emergencia no se limpia cuando alguien se va: la ficha sigue ahí, con el
    // Asistente dado de baja. Ese no es un candidato peor puesto; no es un candidato.
    respuestas.set('GET /rest/v1/personal_emergencia', () => [
      { asistente_id: FRANQUERO, tipo: 'franquero', asistentes: { estado: 'baja' } },
    ]);
    plantelActivo = plantelActivo.filter((id) => id !== FRANQUERO);

    const hecho = await correr();

    assert.deepEqual(pedidosAMeta.map((p) => p.to), [TELEFONOS[SUPLENTE_LIBRE]]);
    assert.equal(hecho.contactados, 1);
  });
});

describe('la lista de a quiénes se les escribe', () => {
  it('respeta el orden de los roles y no le escribe dos veces a la misma persona', () => {
    const porRol = new Map([
      ['suplente', ['ana', 'luis']],
      ['franquero', ['luis', 'marta']],
    ]);

    assert.deepEqual(aQuienesSeLesEscribe(['franquero', 'suplente'], porRol), [
      { asistenteId: 'luis', rol: 'franquero' },
      { asistenteId: 'marta', rol: 'franquero' },
      { asistenteId: 'ana', rol: 'suplente' },
    ]);
  });

  it('un rol que la Prestadora no cargó no agrega a nadie', () => {
    assert.deepEqual(aQuienesSeLesEscribe(['emergencia'], new Map([['suplente', ['ana']]])), []);
  });
});
