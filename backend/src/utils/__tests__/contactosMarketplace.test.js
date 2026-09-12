/**
 * El saldo de contactos de un paquete del Marketplace.
 *
 *   npm test --prefix backend
 *
 * QUÉ SE PRUEBA ACÁ Y QUÉ NO. Las cuentas —sumar al saldo, restarle uno, anotar a quién se abrió—
 * viven en la base y están probadas contra la base de verdad, incluidas dos sesiones descontando el
 * mismo saldo al mismo tiempo. Lo de acá es lo otro: que este archivo llame bien, que no invente un
 * saldo cuando la base no contestó nada, y que ante cualquier cosa rara falle cerrado. Abrir un
 * contacto es plata, así que contestar que sí ante una respuesta que no se entendió es regalarlo.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const ACCESO = '33333333-3333-3333-3333-333333333333';
const ASISTENTE = '88888888-8888-8888-8888-888888888888';

const respuestas = new Map();
let llamadas = [];

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    llamadas.push({ clave, cuerpo: crudo ? JSON.parse(crudo) : null });

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
const { cargarContactosEnElSaldo, abrirElContacto, MOTIVO_CONTACTO } = await import(
  '../contactosMarketplace.js'
);

after(() => baseFalsa.close());

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
});

const sumas = () => llamadas.filter((l) => l.clave === 'POST /rest/v1/rpc/sumar_contactos_al_saldo');

describe('cargarle contactos al saldo', () => {
  it('le pide a la base que sume, y contesta el total que quedó', async () => {
    respuestas.set('POST /rest/v1/rpc/sumar_contactos_al_saldo', () => 8);
    const resultado = await cargarContactosEnElSaldo({ accesoId: ACCESO, cuantos: 3 });

    assert.deepEqual(resultado, { ok: true, saldo_contactos: 8 });
    assert.deepEqual(sumas()[0].cuerpo, { p_acceso_id: ACCESO, p_cuantos: 3 });
  });

  it('un acceso que no está no es un saldo en cero', async () => {
    // La base contesta vacío cuando no hay fila que cargar. Devolver «quedó en cero» taparía que
    // la plata entró contra un acceso que no existe.
    respuestas.set('POST /rest/v1/rpc/sumar_contactos_al_saldo', () => null);
    const resultado = await cargarContactosEnElSaldo({ accesoId: ACCESO, cuantos: 3 });

    assert.deepEqual(resultado, { ok: false, motivo: MOTIVO_CONTACTO.ACCESO_INEXISTENTE });
  });

  it('cargar cero, o medio contacto, no llega a la base', async () => {
    // Un paquete sin contactos no es un paquete, y medio contacto no existe. Se corta acá para que
    // no quede una llamada de plata con un número que nadie entiende.
    for (const cuantos of [0, -2, 1.5, null, undefined, '3']) {
      const resultado = await cargarContactosEnElSaldo({ accesoId: ACCESO, cuantos });
      assert.equal(resultado.ok, false, `cuantos: ${cuantos}`);
      assert.equal(resultado.motivo, MOTIVO_CONTACTO.NO_SE_PUDO_GUARDAR);
    }
    assert.deepEqual(sumas(), [], 'no se tocó la base');
  });

  it('si la base falla, no se da por cargado', async () => {
    const resultado = await cargarContactosEnElSaldo({ accesoId: ACCESO, cuantos: 3 });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, MOTIVO_CONTACTO.NO_SE_PUDO_GUARDAR);
  });
});

describe('abrir el contacto de un Asistente', () => {
  it('descuenta uno y dice cuánto quedó', async () => {
    respuestas.set('POST /rest/v1/rpc/consumir_contacto_marketplace', () => ({
      ok: true,
      ya_estaba: false,
      saldo_contactos: 4,
    }));
    const resultado = await abrirElContacto({ accesoId: ACCESO, asistenteId: ASISTENTE });

    assert.deepEqual(resultado, { ok: true, ya_estaba: false, saldo_contactos: 4 });
    assert.deepEqual(llamadas[0].cuerpo, { p_acceso_id: ACCESO, p_asistente_id: ASISTENTE });
  });

  it('el que ya estaba abierto se abre otra vez sin descontar', async () => {
    // El contacto de cada persona se paga una sola vez: volver a mirarlo no puede costar otro.
    // `ya_estaba` es lo que después permite avisar que se gastó un contacto sólo cuando se gastó.
    respuestas.set('POST /rest/v1/rpc/consumir_contacto_marketplace', () => ({
      ok: true,
      ya_estaba: true,
      saldo_contactos: 4,
    }));
    const resultado = await abrirElContacto({ accesoId: ACCESO, asistenteId: ASISTENTE });
    assert.deepEqual(resultado, { ok: true, ya_estaba: true, saldo_contactos: 4 });
  });

  it('sin saldo no se abre, y el motivo dice cuál de los dos casos es', async () => {
    // «Se acabó» y «este acceso no se sostiene por saldo» se arreglan de maneras distintas: uno
    // comprando otro paquete y el otro no.
    respuestas.set('POST /rest/v1/rpc/consumir_contacto_marketplace', () => ({
      ok: false,
      motivo: 'saldo_agotado',
      saldo_contactos: 0,
    }));
    assert.deepEqual(await abrirElContacto({ accesoId: ACCESO, asistenteId: ASISTENTE }), {
      ok: false,
      motivo: MOTIVO_CONTACTO.SALDO_AGOTADO,
      saldo_contactos: 0,
    });

    respuestas.set('POST /rest/v1/rpc/consumir_contacto_marketplace', () => ({
      ok: false,
      motivo: 'acceso_sin_saldo',
    }));
    const otro = await abrirElContacto({ accesoId: ACCESO, asistenteId: ASISTENTE });
    assert.equal(otro.motivo, MOTIVO_CONTACTO.ACCESO_SIN_SALDO);
  });

  it('ante una respuesta que no se entiende, no se abre nada', async () => {
    // Falla cerrado. Contestar que sí acá sería entregar el dato de contacto sin haberlo
    // descontado, y sin que quede anotado a quién se abrió.
    for (const respuesta of [null, '', 'listo', 0]) {
      respuestas.set('POST /rest/v1/rpc/consumir_contacto_marketplace', () => respuesta);
      const resultado = await abrirElContacto({ accesoId: ACCESO, asistenteId: ASISTENTE });
      assert.equal(resultado.ok, false, `respuesta: ${JSON.stringify(respuesta)}`);
      assert.equal(resultado.motivo, MOTIVO_CONTACTO.NO_SE_PUDO_GUARDAR);
    }
  });

  it('si la base falla, tampoco', async () => {
    const resultado = await abrirElContacto({ accesoId: ACCESO, asistenteId: ASISTENTE });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, MOTIVO_CONTACTO.NO_SE_PUDO_GUARDAR);
  });
});
