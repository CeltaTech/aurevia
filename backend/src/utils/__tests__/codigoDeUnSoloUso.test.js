/**
 * El código de un solo uso: que el tope de intentos sea de verdad un tope (pendiente #177).
 *
 *   npm test --prefix backend
 *
 * LAS TRES COSAS QUE SE PRUEBAN ACÁ, y qué pasaría si alguna se rompiera:
 *
 *   1. EMITIR UN CÓDIGO NUEVO NO DEVUELVE INTENTOS. Si volviera a escribirse `codigo_intentos: 0`
 *      junto con la huella nueva, la prueba «lo que se guarda al emitir» fallaría: alcanzaría con
 *      pedir otro código para tener cinco intentos más, y así hasta acertar los seis dígitos.
 *   2. EL INTENTO LO SUMA LA BASE, EN UN SOLO PASO. Si el motor volviera a leer y escribir por
 *      separado, la prueba «no lee para escribir» fallaría, porque aparecería una consulta de
 *      lectura antes de la suma. Dos intentos a la vez contarían como uno.
 *   3. SE FALLA CERRADO. Ante una base que no contesta, o que contesta cualquier cosa, la
 *      respuesta es «se agotaron». Un tope que se saltea cuando algo sale mal no es un tope.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

// Se importa de arriba, y se puede: este archivo no arma ninguna conexión al cargarse. La pide
// `sumarIntento` recién cuando corre, que es después de que acá abajo queden puestas las
// variables de entorno.
import {
  INTENTOS_MAXIMOS,
  codigoCoincide,
  codigoNuevo,
  codigoNuevoParaGuardar,
  estaVencido,
  huellaDelCodigo,
  seAgotaronLosIntentos,
  sumarIntento,
} from '../codigoDeUnSoloUso.js';

const INSTRUCCION = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** Todo lo que se le pidió a la base, para poder afirmar que la suma fue una sola sentencia. */
let llamadas = [];
/** Qué contesta la base falsa a la función que suma el intento. */
let respuestaDeLaSuma;

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    llamadas.push({ clave: `${req.method} ${ruta}`, cuerpo: crudo ? JSON.parse(crudo) : null });

    if (ruta === '/rest/v1/rpc/sumar_intento_de_codigo') {
      const { estado = 200, valor = 1 } = respuestaDeLaSuma;
      res.writeHead(estado, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(estado === 200 ? valor : { message: 'la base dijo que no' }));
      return;
    }

    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: `ruta sin preparar: ${ruta}` }));
  });
});

await new Promise((listo) => baseFalsa.listen(0, '127.0.0.1', listo));
process.env.SUPABASE_URL = `http://127.0.0.1:${baseFalsa.address().port}`;
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';

after(() => baseFalsa.close());

beforeEach(() => {
  llamadas = [];
  respuestaDeLaSuma = { estado: 200, valor: 1 };
});

describe('lo que se guarda al emitir un código nuevo', () => {
  it('son la huella y el vencimiento, y nunca la cuenta de intentos', () => {
    const vence = new Date(Date.now() + 60_000).toISOString();
    const { codigo, campos } = codigoNuevoParaGuardar(vence);

    assert.match(codigo, /^\d{6}$/);
    assert.equal(campos.codigo_huella, huellaDelCodigo(codigo));
    assert.equal(campos.codigo_expira_en, vence);

    // Ésta es la prueba del defecto: si alguien vuelve a poner `codigo_intentos: 0` acá, el tope
    // deja de ser un tope y esta línea lo dice.
    assert.equal(
      Object.prototype.hasOwnProperty.call(campos, 'codigo_intentos'),
      false,
      'emitir un código nuevo no puede devolver intentos',
    );
    assert.deepEqual(Object.keys(campos).sort(), ['codigo_expira_en', 'codigo_huella']);
  });

  it('el código en claro sale una sola vez y no queda adentro de lo que se guarda', () => {
    const { codigo, campos } = codigoNuevoParaGuardar(new Date().toISOString());
    assert.equal(JSON.stringify(campos).includes(codigo), false);
  });

  it('cada código es nuevo: emitir dos veces no devuelve el mismo', () => {
    const distintos = new Set();
    for (let vuelta = 0; vuelta < 50; vuelta += 1) distintos.add(codigoNuevo());
    assert.ok(distintos.size > 40, 'seis dígitos al azar no pueden repetirse casi siempre');
  });
});

describe('el intento lo suma la base, en un solo paso', () => {
  it('se pide con el nombre de la tabla y la fila, y devuelve cuántos van', async () => {
    respuestaDeLaSuma = { estado: 200, valor: 3 };

    const intentos = await sumarIntento({ tabla: 'instrucciones_acceso_circulo', id: INSTRUCCION });
    assert.equal(intentos, 3);

    const [llamada] = llamadas;
    assert.equal(llamada.clave, 'POST /rest/v1/rpc/sumar_intento_de_codigo');
    assert.deepEqual(llamada.cuerpo, { p_tabla: 'instrucciones_acceso_circulo', p_id: INSTRUCCION });
  });

  it('no lee para escribir: es una sola ida a la base', async () => {
    await sumarIntento({ tabla: 'guardia_comprobaciones', id: INSTRUCCION });
    // Si volviera el «leer, sumar uno y escribir», acá habría un GET antes del POST, y entre esos
    // dos pasos entra cualquier otro intento.
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas.filter((l) => l.clave.startsWith('GET')).length, 0);
  });

  it('una tabla que no está en la lista no llega a la base', async () => {
    const intentos = await sumarIntento({ tabla: 'usuarios', id: INSTRUCCION });
    assert.equal(intentos, null);
    assert.equal(llamadas.length, 0, 'un nombre de tabla no puede viajar desde afuera');
    assert.equal(seAgotaronLosIntentos(intentos), true);
  });

  it('sin fila que contar tampoco se llama a la base', async () => {
    assert.equal(await sumarIntento({ tabla: 'guardia_comprobaciones', id: null }), null);
    assert.equal(llamadas.length, 0);
  });

  it('si la base no contesta, se cuenta como agotado', async () => {
    respuestaDeLaSuma = { estado: 400 };
    const intentos = await sumarIntento({ tabla: 'guardia_comprobaciones', id: INSTRUCCION });
    assert.equal(intentos, null);
    assert.equal(seAgotaronLosIntentos(intentos), true);
  });

  it('si la base contesta vacío, también: cero no es una respuesta válida', async () => {
    respuestaDeLaSuma = { estado: 200, valor: null };
    const intentos = await sumarIntento({ tabla: 'guardia_comprobaciones', id: INSTRUCCION });
    assert.equal(intentos, null);
    assert.equal(seAgotaronLosIntentos(intentos), true);
  });
});

describe('cuándo se considera agotado el tope', () => {
  it('el último intento permitido entra, y el siguiente no', () => {
    assert.equal(seAgotaronLosIntentos(INTENTOS_MAXIMOS), false);
    assert.equal(seAgotaronLosIntentos(INTENTOS_MAXIMOS + 1), true);
    assert.equal(seAgotaronLosIntentos(1), false);
  });

  it('ante cualquier cosa que no sea un número, se niega', () => {
    for (const raro of [null, undefined, NaN, Infinity, '3', {}, [], true]) {
      assert.equal(seAgotaronLosIntentos(raro), true, `«${String(raro)}» no puede dejar pasar`);
    }
  });
});

describe('lo que ya hacía el código de un solo uso y no se tocó', () => {
  it('la huella no es el código, y comparar huella con huella funciona', () => {
    const codigo = codigoNuevo();
    assert.notEqual(huellaDelCodigo(codigo), codigo);
    assert.equal(codigoCoincide(codigo, huellaDelCodigo(codigo)), true);
    assert.equal(codigoCoincide('000000', huellaDelCodigo(codigo)), false);
  });

  it('sin huella guardada o con el código vacío, no coincide nada', () => {
    assert.equal(codigoCoincide('123456', null), false);
    assert.equal(codigoCoincide('', huellaDelCodigo('123456')), false);
    assert.equal(codigoCoincide('   ', huellaDelCodigo('123456')), false);
  });

  it('sin vencimiento guardado se trata como vencido', () => {
    assert.equal(estaVencido(null), true);
    assert.equal(estaVencido(new Date(Date.now() - 1000).toISOString()), true);
    assert.equal(estaVencido(new Date(Date.now() + 60_000).toISOString()), false);
  });
});
