/**
 * El tope de pedidos por minuto (pendiente #177).
 *
 *   npm test --prefix backend
 *
 * QUÉ TIENE QUE GARANTIZAR ESTA PRUEBA. Que el tope existe de verdad y no es un comentario: que
 * el pedido que se pasa se frena, que el número sale de la configuración y no está escrito en el
 * código, que sin identidad resuelta se niega —falla cerrado—, y que el piso de la guardia nunca
 * se traba, porque un tope que deja a un Asistente parado en la puerta sería peor que el problema
 * que vino a resolver.
 *
 * SI EL TOPE DESAPARECIERA, la primera prueba de este archivo fallaría: el pedido número once
 * contestaría 200 en vez de 429.
 */
import { strict as assert } from 'node:assert';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

const { default: express } = await import('express');
await import('express-async-errors');
const { topeDePedidos, olvidarPedidos, topePedidosPorMinuto } = await import('../topeDePedidos.js');

const QUIEN = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const OTRO = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

/** Cuántas veces llegó a correr el trabajo de la ruta: lo que el tope tiene que impedir. */
let vecesQueCorrio = 0;

/**
 * Un motor mínimo con el tope puesto donde va: después de la sesión verificada, antes del trabajo.
 * `identidad` imita lo que deja el control de sesión; `null` es el caso de una ruta mal armada.
 */
function motorCon({ identidad = { id: QUIEN }, nombre = 'prueba', soloSi = null }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, siguiente) => {
    if (identidad) req.usuarioAsistente = identidad;
    siguiente();
  });
  app.post('/probar', topeDePedidos({ nombre, soloSi }), (req, res) => {
    vecesQueCorrio += 1;
    res.json({ ok: true });
  });
  return app;
}

/**
 * Los motores levantados en la prueba de turno. Se cierran todos al terminar cada una, incluso si
 * la prueba falló a mitad de camino: un servidor que queda abierto deja el proceso colgado y una
 * prueba que se cuelga en vez de fallar no informa nada.
 */
let motores = [];

async function levantar(app) {
  const servidor = createServer(app);
  motores.push(servidor);
  servidor.listen(0, '127.0.0.1');
  await new Promise((listo) => servidor.on('listening', listo));
  return { direccion: `http://127.0.0.1:${servidor.address().port}/probar` };
}

async function pedir(direccion, cuerpo = {}) {
  const respuesta = await fetch(direccion, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  return { estado: respuesta.status, cuerpo: await respuesta.json() };
}

const TOPE_ORIGINAL = process.env.TOPE_PEDIDOS_POR_MINUTO;

beforeEach(() => {
  olvidarPedidos();
  vecesQueCorrio = 0;
  delete process.env.TOPE_PEDIDOS_POR_MINUTO;
});

afterEach(() => {
  for (const servidor of motores) servidor.close();
  motores = [];
  if (TOPE_ORIGINAL === undefined) delete process.env.TOPE_PEDIDOS_POR_MINUTO;
  else process.env.TOPE_PEDIDOS_POR_MINUTO = TOPE_ORIGINAL;
});

describe('el tope de pedidos por minuto', () => {
  it('deja pasar los primeros y frena el que se pasa: sin esto, seis dígitos se prueban de a uno', async () => {
    process.env.TOPE_PEDIDOS_POR_MINUTO = '3';
    const { direccion } = await levantar(motorCon({}));

    for (let vuelta = 1; vuelta <= 3; vuelta += 1) {
      const { estado } = await pedir(direccion);
      assert.equal(estado, 200, `el pedido ${vuelta} tenía que pasar`);
    }

    const pasado = await pedir(direccion);
    assert.equal(pasado.estado, 429);
    assert.equal(pasado.cuerpo.motivo, 'demasiados_pedidos');
    // Y lo importante: el trabajo de la ruta no llegó a correr. Frenar después de haber probado
    // el código no frenaría nada.
    assert.equal(vecesQueCorrio, 3);
  });

  it('el número sale de la configuración, no está escrito en el código', async () => {
    process.env.TOPE_PEDIDOS_POR_MINUTO = '1';
    const { direccion } = await levantar(motorCon({}));

    assert.equal(topePedidosPorMinuto(), 1);
    assert.equal((await pedir(direccion)).estado, 200);
    assert.equal((await pedir(direccion)).estado, 429);
  });

  it('un valor sin completar, con letras o menor que uno no apaga el tope', async () => {
    for (const valor of ['', '   ', 'muchos', '0', '-3', '2.5']) {
      process.env.TOPE_PEDIDOS_POR_MINUTO = valor;
      assert.equal(topePedidosPorMinuto(), 10, `«${valor}» no puede dejar el tope abierto`);
    }
    delete process.env.TOPE_PEDIDOS_POR_MINUTO;
    assert.equal(topePedidosPorMinuto(), 10);
  });

  it('cada tope lleva su cuenta: gastar los de una ruta no deja sin pedidos a la otra', async () => {
    process.env.TOPE_PEDIDOS_POR_MINUTO = '1';
    const firma = await levantar(motorCon({ nombre: 'firma' }));
    const guardia = await levantar(motorCon({ nombre: 'guardia' }));

    assert.equal((await pedir(firma.direccion)).estado, 200);
    assert.equal((await pedir(firma.direccion)).estado, 429);
    assert.equal((await pedir(guardia.direccion)).estado, 200);
  });

  it('la cuenta es de cada persona: quien no probó nada entra igual', async () => {
    process.env.TOPE_PEDIDOS_POR_MINUTO = '1';
    const uno = await levantar(motorCon({ identidad: { id: QUIEN } }));
    const otro = await levantar(motorCon({ identidad: { id: OTRO } }));

    assert.equal((await pedir(uno.direccion)).estado, 200);
    assert.equal((await pedir(uno.direccion)).estado, 429);
    assert.equal((await pedir(otro.direccion)).estado, 200);
  });

  it('sin identidad resuelta se niega: todo control de acceso falla cerrado', async () => {
    const { direccion } = await levantar(motorCon({ identidad: null }));

    const { estado, cuerpo } = await pedir(direccion);
    assert.equal(estado, 429);
    assert.equal(cuerpo.motivo, 'demasiados_pedidos');
    assert.equal(vecesQueCorrio, 0);
  });

  it('lo que el tope no mira no se cuenta: el piso de la guardia nunca se traba', async () => {
    process.env.TOPE_PEDIDOS_POR_MINUTO = '1';
    const trajoUnCodigo = (req) => Boolean(req.body?.codigo);
    const { direccion } = await levantar(motorCon({ soloSi: trajoUnCodigo }));

    assert.equal((await pedir(direccion, { codigo: '111111' })).estado, 200);
    assert.equal((await pedir(direccion, { codigo: '222222' })).estado, 429);

    // Y el que entra eligiendo un motivo pasa siempre, aunque el tope ya esté alcanzado.
    for (let vuelta = 0; vuelta < 5; vuelta += 1) {
      assert.equal((await pedir(direccion, { motivoSinComprobar: 'nadie_para_mostrar' })).estado, 200);
    }
  });

  it('el pedido frenado contesta lo mismo exista o no lo que se estaba probando', async () => {
    // El tope corre ANTES del trabajo de la ruta, así que no puede contestar distinto según si el
    // código existía: si contestara distinto, sería una forma de averiguar qué existe.
    process.env.TOPE_PEDIDOS_POR_MINUTO = '1';
    const { direccion } = await levantar(motorCon({}));

    await pedir(direccion, { codigo: '111111' });
    const conCodigo = await pedir(direccion, { codigo: '111111' });
    const sinNada = await pedir(direccion, {});

    assert.deepEqual(conCodigo.cuerpo, sinNada.cuerpo);
    assert.equal(conCodigo.estado, sinNada.estado);
  });

  it('el nombre del tope es obligatorio: un tope sin nombre compartiría la cuenta con otro', () => {
    assert.throws(() => topeDePedidos({}), /falta el nombre/);
  });
});
