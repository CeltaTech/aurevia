/**
 * Cubrir una guardia con un sustituto: el turno pasa a nombre de quien lo hace.
 *
 *   npm test --prefix backend
 *   node --test backend/src/utils/__tests__/cubrirGuardia.test.js
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Acá se cruzan dos cosas que el producto no puede perder: que quien
 * va a la casa del Paciente vea su guardia y la pueda fichar —la aplicación del Asistente lista
 * por `guardias.asistente_id`—, y que quede escrito a quién le tocaba ese turno antes. Lo segundo
 * no se puede reconstruir después: si la guardia cambia de nombre sin que nadie haya anotado al
 * titular, el dato no está en ningún lado.
 *
 * La base es de mentira y contesta por HTTP como la de verdad, así que además del resultado se
 * mira **qué se le pidió y en qué orden**.
 *
 * QUÉ PASARÍA CON EL SISTEMA ROTO. Si volviera el diseño de dos guardias, la prueba de «no nace
 * ninguna guardia nueva» falla. Si alguien invirtiera el orden, falla la del orden. Si la guardia
 * dejara de reasignarse, falla la primera. Y si el fallo de la constancia no frenara el cambio de
 * nombre, falla la última.
 *
 * Datos inventados, como manda CLAUDE.md §6.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const TITULAR = '22222222-2222-2222-2222-222222222222';
const SUSTITUTO = '33333333-3333-3333-3333-333333333333';
const AUSENCIA = '44444444-4444-4444-4444-444444444444';

/** Lo que se le pidió a la base, en orden, y qué tabla contesta con error. */
let pedidos = [];
let tablaQueFalla = null;

const baseFalsa = createServer((req, res) => {
  let cuerpo = '';
  req.on('data', (parte) => { cuerpo += parte; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://interno');
    const tabla = url.pathname.replace('/rest/v1/', '');
    pedidos.push({
      tabla,
      metodo: req.method,
      parametros: url.searchParams,
      cuerpo: cuerpo ? JSON.parse(cuerpo) : null,
    });

    if (tabla === tablaQueFalla) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'la base dijo que no' }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('[]');
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

// El import va después de las variables de entorno: la conexión se arma al importar.
const { cubrirGuardiaConSustituto } = await import('../cubrirGuardia.js');

/** El turno que el titular no va a poder hacer. */
const GUARDIA = {
  id: 'g-1',
  prestadora_id: PRESTADORA,
  asistente_id: TITULAR,
  estado: 'programada',
};

const cubrir = (extra = {}) => cubrirGuardiaConSustituto({
  guardia: GUARDIA,
  asistenteSustitutoId: SUSTITUTO,
  ausenciaId: AUSENCIA,
  motivo: 'emergencia',
  ...extra,
});

const pedidoA = (tabla, metodo) => pedidos.find((p) => p.tabla === tabla && p.metodo === metodo);

describe('cubrir una guardia con un sustituto', () => {
  beforeEach(() => {
    pedidos = [];
    tablaQueFalla = null;
  });

  after(() => baseFalsa.close());

  it('deja la guardia a nombre de quien la va a hacer', async () => {
    const resultado = await cubrir();

    assert.equal(resultado.ok, true);
    const cambio = pedidoA('guardias', 'PATCH');
    assert.ok(cambio, 'la guardia tiene que cambiar de nombre, o el sustituto no la ve');
    assert.deepEqual(cambio.cuerpo, { asistente_id: SUSTITUTO });
    assert.equal(cambio.parametros.get('id'), 'eq.g-1');
  });

  it('deja escrito a quién le tocaba y por qué lo hace otro', async () => {
    await cubrir({ motivoDetalle: 'se quedó sin transporte', costoAdicional: '1500' });

    const constancia = pedidoA('guardias_cobertura', 'POST');
    assert.ok(constancia, 'sin constancia, quién era el titular se pierde para siempre');
    assert.deepEqual(constancia.cuerpo, {
      prestadora_id: PRESTADORA,
      ausencia_id: AUSENCIA,
      guardia_original_id: 'g-1',
      asistente_titular_id: TITULAR,
      asistente_sustituto_id: SUSTITUTO,
      motivo: 'emergencia',
      motivo_detalle: 'se quedó sin transporte',
      costo_adicional: '1500',
    });
  });

  it('el turno sigue siendo uno solo: no nace ninguna guardia nueva', async () => {
    await cubrir();

    assert.equal(pedidoA('guardias', 'POST'), undefined);
    assert.equal(pedidoA('guardia_pacientes', 'POST'), undefined);
  });

  it('escribe la constancia antes de mover la guardia', async () => {
    await cubrir();

    const orden = pedidos.map((p) => p.tabla);
    assert.deepEqual(orden, ['guardias_cobertura', 'guardias']);
  });

  it('si la constancia no se pudo escribir, la guardia no se mueve', async () => {
    tablaQueFalla = 'guardias_cobertura';

    const resultado = await cubrir();

    assert.equal(resultado.ok, false);
    assert.equal(pedidoA('guardias', 'PATCH'), undefined,
      'el turno tiene que quedar como estaba: moverlo sin constancia pierde al titular');
  });
});
