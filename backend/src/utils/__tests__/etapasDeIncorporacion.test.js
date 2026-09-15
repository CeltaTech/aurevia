/**
 * Las etapas del Proceso de Incorporación salen de la tabla de cada Prestadora.
 *
 *   npm test --prefix backend
 *
 * QUÉ SE PRUEBA ACÁ. Que las filas con las que arranca un Asistente nuevo sean las etapas que esa
 * Prestadora configuró y en el orden que ella les dio; que se pregunte por su Prestadora y por
 * ninguna otra, y sólo por las activas; que la política de alta decida cuáles nacen cumplidas y
 * nunca cuáles son; y que una Prestadora sin etapas activas corte el alta en vez de recibir un
 * proceso inventado.
 *
 * CÓMO PUEDE FALLAR. Comprobar que devuelve cinco filas no probaría nada: cinco eran las que había
 * escritas en el código, y una función que las siguiera devolviendo pasaría esa prueba igual. Por
 * eso las etapas que contesta la base falsa no son las cinco viejas, y el filtro y el orden se
 * comprueban mirando la dirección con la que se llamó: una consulta sin `activa=eq.true`, contra
 * una base falsa que devuelve sólo las activas, daría exactamente el mismo resultado.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const OTRA_PRESTADORA = '22222222-2222-2222-2222-222222222222';
const ASISTENTE = '33333333-3333-3333-3333-333333333333';
const QUIEN_REVISA = '44444444-4444-4444-4444-444444444444';

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
const { APROBADAS, etapasActivasDeLaPrestadora, filasDeIncorporacion } = await import(
  '../etapasDeIncorporacion.js'
);

after(() => baseFalsa.close());

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
});

const ETAPAS = 'GET /rest/v1/etapas_incorporacion_asistente';

/** Un proceso que no se parece a las cinco claves que estaban escritas en el código. */
const PROCESO_PROPIO = [
  { clave: 'postulacion' },
  { clave: 'examen_preocupacional' },
  { clave: 'firma_del_convenio' },
];

describe('las etapas activas de la Prestadora', () => {
  it('devuelve las claves en el orden en que ella las puso', async () => {
    respuestas.set(ETAPAS, PROCESO_PROPIO);

    const claves = await etapasActivasDeLaPrestadora(PRESTADORA);

    assert.deepEqual(claves, ['postulacion', 'examen_preocupacional', 'firma_del_convenio']);
  });

  it('pregunta por su Prestadora, sólo por las activas y pidiendo el orden', async () => {
    respuestas.set(ETAPAS, PROCESO_PROPIO);

    await etapasActivasDeLaPrestadora(PRESTADORA);

    const consulta = llamadas.find((l) => l.clave === ETAPAS);
    assert.ok(consulta, 'no se consultó la tabla de etapas');
    assert.ok(
      consulta.busqueda.includes(`prestadora_id=eq.${PRESTADORA}`),
      `la consulta salió sin el filtro por Prestadora: ${consulta.busqueda}`,
    );
    assert.ok(
      !consulta.busqueda.includes(OTRA_PRESTADORA),
      'la consulta nombró a otra Prestadora',
    );
    assert.ok(
      consulta.busqueda.includes('activa=eq.true'),
      `la consulta no dejó afuera las etapas apagadas: ${consulta.busqueda}`,
    );
    assert.ok(
      consulta.busqueda.includes('order=orden'),
      `la consulta no pidió el orden de la Prestadora: ${consulta.busqueda}`,
    );
  });

  it('sin ninguna etapa activa, corta con un motivo que la pantalla sabe explicar', async () => {
    respuestas.set(ETAPAS, []);

    await assert.rejects(
      () => etapasActivasDeLaPrestadora(PRESTADORA),
      (error) => {
        assert.equal(error.motivo, 'sin_etapas_incorporacion');
        return true;
      },
    );
  });

  it('una consulta que falla no inventa un proceso', async () => {
    // Sin respuesta preparada la base falsa contesta 400: es el caso de la consulta rota.
    await assert.rejects(() => etapasActivasDeLaPrestadora(PRESTADORA));
  });
});

describe('las filas con las que arranca un Asistente nuevo', () => {
  it('con la primera aprobada: la postulación ya pasó, el resto queda por delante', async () => {
    respuestas.set(ETAPAS, PROCESO_PROPIO);

    const filas = await filasDeIncorporacion(ASISTENTE, PRESTADORA, {
      aprobadas: APROBADAS.LA_PRIMERA,
      revisadoPor: QUIEN_REVISA,
    });

    assert.deepEqual(
      filas.map(({ etapa, estado }) => [etapa, estado]),
      [
        ['postulacion', 'aprobada'],
        ['examen_preocupacional', 'pendiente'],
        ['firma_del_convenio', 'pendiente'],
      ],
    );
    assert.equal(filas[0].revisado_por, QUIEN_REVISA);
    assert.ok(filas[0].completado_en, 'la etapa cumplida quedó sin momento');
    assert.equal(filas[1].revisado_por, null);
    assert.equal(filas[1].completado_en, null);
    assert.ok(filas.every((f) => f.asistente_id === ASISTENTE));
  });

  it('con ninguna aprobada: el proceso entero queda por delante', async () => {
    respuestas.set(ETAPAS, PROCESO_PROPIO);

    const filas = await filasDeIncorporacion(ASISTENTE, PRESTADORA, {
      aprobadas: APROBADAS.NINGUNA,
      revisadoPor: QUIEN_REVISA,
    });

    assert.ok(filas.every((f) => f.estado === 'pendiente'));
    assert.ok(filas.every((f) => f.revisado_por === null && f.completado_en === null));
  });

  it('con todas aprobadas: cada etapa queda a nombre de quien dio el alta', async () => {
    respuestas.set(ETAPAS, PROCESO_PROPIO);

    const filas = await filasDeIncorporacion(ASISTENTE, PRESTADORA, {
      aprobadas: APROBADAS.TODAS,
      revisadoPor: QUIEN_REVISA,
    });

    assert.ok(filas.every((f) => f.estado === 'aprobada'));
    assert.ok(filas.every((f) => f.revisado_por === QUIEN_REVISA && f.completado_en));
  });

  it('la política decide cuáles nacen cumplidas, nunca cuáles son', async () => {
    respuestas.set(ETAPAS, PROCESO_PROPIO);
    const porLaPuertaDeLaPostulacion = await filasDeIncorporacion(ASISTENTE, PRESTADORA, {
      aprobadas: APROBADAS.LA_PRIMERA,
      revisadoPor: QUIEN_REVISA,
    });

    respuestas.set(ETAPAS, PROCESO_PROPIO);
    const porLaPuertaDelAltaDirecta = await filasDeIncorporacion(ASISTENTE, PRESTADORA, {
      aprobadas: APROBADAS.TODAS,
      revisadoPor: QUIEN_REVISA,
    });

    assert.deepEqual(
      porLaPuertaDeLaPostulacion.map((f) => f.etapa),
      porLaPuertaDelAltaDirecta.map((f) => f.etapa),
      'las dos puertas armaron procesos distintos',
    );
  });

  it('una Prestadora con un proceso de una sola etapa recibe una sola fila', async () => {
    respuestas.set(ETAPAS, [{ clave: 'entrevista' }]);

    const filas = await filasDeIncorporacion(ASISTENTE, PRESTADORA, {
      aprobadas: APROBADAS.LA_PRIMERA,
      revisadoPor: QUIEN_REVISA,
    });

    assert.deepEqual(filas.map((f) => f.etapa), ['entrevista']);
  });

  it('sin etapas activas no se crea un Asistente aprobado de hecho', async () => {
    respuestas.set(ETAPAS, []);

    await assert.rejects(
      () =>
        filasDeIncorporacion(ASISTENTE, PRESTADORA, {
          aprobadas: APROBADAS.NINGUNA,
          revisadoPor: QUIEN_REVISA,
        }),
      (error) => {
        assert.equal(error.motivo, 'sin_etapas_incorporacion');
        return true;
      },
    );
  });
});
