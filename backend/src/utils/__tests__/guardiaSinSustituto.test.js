/**
 * Una guardia tapada por una licencia no arranca hasta que tiene sustituto.
 *
 *   npm test --prefix backend
 *   node --test backend/src/utils/__tests__/guardiaSinSustituto.test.js
 *
 * POR QUÉ EXISTE ESTA PRUEBA. `docs/PRD_02B_Gestion_Personal.md:187` pide que ninguna guardia de
 * cobertura pase a «Activa» sin Asistente sustituto asignado, y el único lugar de todo el producto
 * que la pasa a activa es el check-in. Lo que decide ahí es esta función, así que si contesta mal
 * la guardia arranca igual y desaparece de la lista de las que quedaron sin cubrir, sin que nadie
 * haya resuelto nada.
 *
 * La base es de mentira y contesta por HTTP como la de verdad, así que además de mirar el
 * resultado se mira **qué se le pidió**: la consulta de ausencias no puede traer la columna
 * `tipo`, porque por qué alguien está de licencia es información de salud y no sale del legajo
 * (CLAUDE.md §6).
 *
 * Con el sistema roto —sin la comprobación, o leyendo la licencia sin mirar el día— las pruebas
 * de «la licencia que la tapa» y «la que ya terminó» dan al revés.
 *
 * Datos inventados, como manda CLAUDE.md §6.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const ASISTENTE = '22222222-2222-2222-2222-222222222222';

/** Lo que la base contesta en cada tabla, y lo que se le preguntó. */
let ausencias = [];
let coberturas = [];
let pedidos = [];

const baseFalsa = createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    const url = new URL(req.url, 'http://interno');
    pedidos.push({ ruta: url.pathname, parametros: url.searchParams });

    const cuerpo =
      url.pathname === '/rest/v1/ausencias' ? ausencias
        : url.pathname === '/rest/v1/guardias_cobertura' ? coberturas
          : [];
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(cuerpo));
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

// El import va después de las variables de entorno: la conexión se arma al importar.
const { faltaElSustituto } = await import('../guardiaSinSustituto.js');

/** Turno de mañana del martes. */
const GUARDIA = {
  id: 'g-1',
  asistente_id: ASISTENTE,
  prestadora_id: PRESTADORA,
  fecha: '2026-10-06',
  hora_inicio: '08:00',
  hora_fin: '16:00',
};

/** El mismo turno pero de noche: arranca el martes a las 22:00 y termina el miércoles a las 06:00. */
const GUARDIA_DE_NOCHE = { ...GUARDIA, id: 'g-2', hora_inicio: '22:00', hora_fin: '06:00' };

const licencia = (fecha_inicio, fecha_fin = null) => ({ asistente_id: ASISTENTE, fecha_inicio, fecha_fin });

describe('faltaElSustituto', () => {
  beforeEach(() => {
    ausencias = [];
    coberturas = [];
    pedidos = [];
  });

  after(() => baseFalsa.close());

  it('sin ninguna licencia registrada, la guardia arranca como siempre', async () => {
    assert.equal(await faltaElSustituto(GUARDIA), false);
  });

  it('con licencia que la tapa y sin cobertura, no arranca', async () => {
    ausencias = [licencia('2026-10-05', '2026-10-09')];
    assert.equal(await faltaElSustituto(GUARDIA), true);
  });

  it('con licencia que la tapa y con sustituto asignado, arranca', async () => {
    ausencias = [licencia('2026-10-05', '2026-10-09')];
    coberturas = [{ id: 'c-1' }];
    assert.equal(await faltaElSustituto(GUARDIA), false);
  });

  it('una licencia que terminó antes de la guardia no la tapa', async () => {
    ausencias = [licencia('2026-09-28', '2026-10-02')];
    assert.equal(await faltaElSustituto(GUARDIA), false);
  });

  it('una licencia sin fecha de vuelta sigue abierta y la tapa', async () => {
    ausencias = [licencia('2026-10-01')];
    assert.equal(await faltaElSustituto(GUARDIA), true);
  });

  it('la licencia que empieza al día siguiente parte al medio la guardia de noche', async () => {
    // Arranca el miércoles, y la de noche termina el miércoles a las 06:00. Mirar sólo el día en
    // que empieza la guardia dejaría pasar justo el turno más común del rubro.
    ausencias = [licencia('2026-10-07', '2026-10-10')];
    assert.equal(await faltaElSustituto(GUARDIA_DE_NOCHE), true);
    assert.equal(await faltaElSustituto(GUARDIA), false);
  });

  it('la consulta de ausencias no pide el tipo de licencia', async () => {
    ausencias = [licencia('2026-10-05', '2026-10-09')];
    await faltaElSustituto(GUARDIA);

    const consulta = pedidos.find((p) => p.ruta === '/rest/v1/ausencias');
    const columnas = consulta.parametros.get('select').split(',');
    assert.deepEqual(columnas.sort(), ['asistente_id', 'fecha_fin', 'fecha_inicio']);
  });

  it('las dos consultas van acotadas a la Prestadora de la guardia', async () => {
    ausencias = [licencia('2026-10-05', '2026-10-09')];
    await faltaElSustituto(GUARDIA);

    for (const ruta of ['/rest/v1/ausencias', '/rest/v1/guardias_cobertura']) {
      const consulta = pedidos.find((p) => p.ruta === ruta);
      assert.equal(consulta.parametros.get('prestadora_id'), `eq.${PRESTADORA}`, ruta);
    }
  });

  it('una guardia sin Asistente cargado no frena a nadie', async () => {
    assert.equal(await faltaElSustituto({ ...GUARDIA, asistente_id: null }), false);
    assert.equal(await faltaElSustituto(null), false);
  });
});
