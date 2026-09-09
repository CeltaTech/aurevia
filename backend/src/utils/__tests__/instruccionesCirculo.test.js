/**
 * La firma de la instrucción del titular del círculo familiar, del lado del código de un solo uso
 * (pendiente #177).
 *
 *   npm test --prefix backend
 *
 * POR QUÉ ESTE CAMINO ES EL MÁS EXPUESTO DE LOS DOS. En el pase de guardia el código lo suelta
 * alguien de la Prestadora con sesión iniciada; acá, en cambio, quien pide el código y quien lo
 * prueba son exactamente la misma persona. Un contador que volvía a cero al pedir un código nuevo
 * dejaba entonces que el titular —o cualquiera que hubiera entrado a esa cuenta— pidiera, probara
 * cinco, pidiera de nuevo, y así hasta acertar los seis dígitos.
 *
 * Lo que se prueba acá: que pedir un código nuevo no toca la cuenta, que el intento lo suma la
 * base en un solo paso, que agotado el tope no se compara nada, y que un código vencido no gasta
 * intentos —que es lo que deja intacto el caso legítimo de quien pide otro porque se le venció—.
 */
import { strict as assert } from 'node:assert';
import { after, beforeEach, describe, it } from 'node:test';
import { createServer } from 'node:http';

import { huellaDelCodigo } from '../codigoDeUnSoloUso.js';

const INSTRUCCION = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const FAMILIA = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PRESTADORA = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

/** Qué contesta la base a cada `MÉTODO /ruta`. */
const respuestas = new Map();
/** Todo lo que se le pidió a la base, con el cuerpo: ahí se ve qué columnas se escribieron. */
let llamadas = [];
/** La instrucción tal como la tendría anotada la base. */
let instruccion;

const baseFalsa = createServer((req, res) => {
  let crudo = '';
  req.on('data', (parte) => {
    crudo += parte;
  });
  req.on('end', () => {
    const ruta = new URL(req.url, 'http://interno').pathname;
    const clave = `${req.method} ${ruta}`;
    const cuerpo = crudo ? JSON.parse(crudo) : null;
    llamadas.push({ clave, cuerpo });

    const preparada = respuestas.get(clave);
    const valor = typeof preparada === 'function' ? preparada({ cuerpo }) : preparada;
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

// El import va después de las variables de entorno: este archivo sí arma la conexión al cargarse.
const { confirmarConCodigo, pedirCodigo } = await import('../instruccionesCirculo.js');

after(() => baseFalsa.close());

function actualizaciones() {
  return llamadas.filter((l) => l.clave === 'PATCH /rest/v1/instrucciones_acceso_circulo').map((l) => l.cuerpo);
}

function intentosSumados() {
  return llamadas.filter((l) => l.clave === 'POST /rest/v1/rpc/sumar_intento_de_codigo').map((l) => l.cuerpo);
}

function enUnRato(minutos) {
  return new Date(Date.now() + minutos * 60 * 1000).toISOString();
}
function haceUnRato(minutos) {
  return new Date(Date.now() - minutos * 60 * 1000).toISOString();
}

beforeEach(() => {
  llamadas = [];
  respuestas.clear();
  instruccion = {
    id: INSTRUCCION,
    prestadora_id: PRESTADORA,
    estado: 'pendiente_firma',
    codigo_huella: huellaDelCodigo('123456'),
    codigo_expira_en: enUnRato(10),
    codigo_intentos: 0,
  };

  respuestas.set('GET /rest/v1/instrucciones_acceso_circulo', () => [instruccion]);
  respuestas.set('PATCH /rest/v1/instrucciones_acceso_circulo', ({ cuerpo }) => {
    Object.assign(instruccion, cuerpo);
    return [instruccion];
  });
  // La base suma el intento en una sola sentencia y devuelve el número nuevo. Se imita de verdad:
  // una base falsa que devolviera siempre 1 dejaría pasar cualquier cantidad de intentos.
  respuestas.set('POST /rest/v1/rpc/sumar_intento_de_codigo', ({ cuerpo }) => {
    if (cuerpo?.p_tabla !== 'instrucciones_acceso_circulo' || cuerpo.p_id !== INSTRUCCION) return undefined;
    instruccion.codigo_intentos = (instruccion.codigo_intentos ?? 0) + 1;
    return instruccion.codigo_intentos;
  });
});

describe('confirmar la instrucción con el código', () => {
  it('el código correcto la cierra, y la huella no queda viva', async () => {
    const resultado = await confirmarConCodigo({ instruccionId: INSTRUCCION, familiaId: FAMILIA, codigo: '123456' });
    assert.equal(resultado.ok, true);

    const [cierre] = actualizaciones();
    assert.equal(cierre.estado, 'cerrada');
    assert.equal(cierre.cerrada_como, 'confirmada_en_la_app');
    assert.equal(cierre.codigo_huella, null);
    assert.equal(cierre.codigo_expira_en, null);
  });

  it('el intento lo suma la base en un solo paso, no el motor leyendo y escribiendo', async () => {
    const resultado = await confirmarConCodigo({ instruccionId: INSTRUCCION, familiaId: FAMILIA, codigo: '000000' });
    assert.equal(resultado.motivo, 'codigo_incorrecto');

    const [sumado] = intentosSumados();
    assert.deepEqual(sumado, { p_tabla: 'instrucciones_acceso_circulo', p_id: INSTRUCCION });
    assert.equal(instruccion.codigo_intentos, 1);
    // Y el motor no escribió la cuenta por su lado: si lo hiciera, dos intentos a la vez contarían
    // como uno.
    assert.equal(actualizaciones().some((a) => 'codigo_intentos' in a), false);
  });

  it('agotado el tope no se compara nada, ni siquiera el código correcto', async () => {
    instruccion.codigo_intentos = 5;
    const resultado = await confirmarConCodigo({ instruccionId: INSTRUCCION, familiaId: FAMILIA, codigo: '123456' });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, 'demasiados_intentos');
    assert.equal(actualizaciones().length, 0, 'no se puede cerrar nada con el tope agotado');
  });

  it('un código vencido no gasta ningún intento', async () => {
    instruccion.codigo_expira_en = haceUnRato(1);
    const resultado = await confirmarConCodigo({ instruccionId: INSTRUCCION, familiaId: FAMILIA, codigo: '123456' });
    assert.equal(resultado.motivo, 'vencido');
    assert.equal(intentosSumados().length, 0);
    assert.equal(instruccion.codigo_intentos, 0);
  });

  it('si la base no puede contar el intento, se niega: falla cerrado', async () => {
    respuestas.set('POST /rest/v1/rpc/sumar_intento_de_codigo', () => undefined);
    const resultado = await confirmarConCodigo({ instruccionId: INSTRUCCION, familiaId: FAMILIA, codigo: '123456' });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.motivo, 'demasiados_intentos');
    assert.equal(actualizaciones().length, 0);
  });

  it('sobre una instrucción que ya no está pendiente no se cuenta ni se compara', async () => {
    instruccion.estado = 'cerrada';
    const resultado = await confirmarConCodigo({ instruccionId: INSTRUCCION, familiaId: FAMILIA, codigo: '123456' });
    assert.equal(resultado.motivo, 'ya_cerrada');
    assert.equal(intentosSumados().length, 0);
  });
});

describe('pedir un código nuevo', () => {
  beforeEach(() => {
    respuestas.set('GET /rest/v1/prestadoras', () => [{ nombre_fantasia: 'Prestadora de prueba' }]);
    // Sin teléfono no se sale hacia WhatsApp, y sin cuenta de correo la función corta con
    // «sin_canal» antes de mandar nada: la prueba nunca llama a un servicio de afuera.
    respuestas.set('GET /rest/v1/usuarios', () => [{ telefono: null }]);
  });

  it('escribe la huella y el vencimiento, y NO vuelve a cero la cuenta de intentos', async () => {
    instruccion.codigo_intentos = 4;

    await pedirCodigo({ instruccionId: INSTRUCCION, familiaId: FAMILIA }).catch(() => {});

    const [emision] = actualizaciones();
    assert.ok(emision, 'tiene que haberse escrito el código nuevo');
    assert.match(emision.codigo_huella, /^[0-9a-f]{64}$/);
    assert.ok(new Date(emision.codigo_expira_en) > new Date());
    // Ésta es la prueba del defecto: con `codigo_intentos: 0` acá, pedir otro código devolvía
    // cinco intentos más y el tope dejaba de ser un tope.
    assert.equal(
      Object.prototype.hasOwnProperty.call(emision, 'codigo_intentos'),
      false,
      'pedir un código nuevo no puede devolver intentos',
    );
    assert.equal(instruccion.codigo_intentos, 4, 'la cuenta tiene que quedar donde estaba');
  });

  it('se escriben esas dos columnas y ninguna más: ni el código en claro ni la cuenta', async () => {
    await pedirCodigo({ instruccionId: INSTRUCCION, familiaId: FAMILIA }).catch(() => {});
    const [emision] = actualizaciones();
    assert.deepEqual(Object.keys(emision).sort(), ['codigo_expira_en', 'codigo_huella']);
  });

  it('sobre una instrucción que ya no está pendiente no se emite ningún código', async () => {
    instruccion.estado = 'cerrada';
    await assert.rejects(
      () => pedirCodigo({ instruccionId: INSTRUCCION, familiaId: FAMILIA }),
      (error) => error.motivo === 'ya_cerrada',
    );
    assert.equal(actualizaciones().length, 0);
  });

  it('agotados los intentos, pedir otro código sigue sin devolverlos: la salida es otra', async () => {
    // Cinco intentos gastados y el tope alcanzado.
    instruccion.codigo_intentos = 5;
    const antes = await confirmarConCodigo({ instruccionId: INSTRUCCION, familiaId: FAMILIA, codigo: '123456' });
    assert.equal(antes.motivo, 'demasiados_intentos');

    // Se pide un código nuevo, que es lo que antes reiniciaba la cuenta.
    await pedirCodigo({ instruccionId: INSTRUCCION, familiaId: FAMILIA }).catch(() => {});

    // Y el código nuevo tampoco sirve: la salida es que la Prestadora cargue otra instrucción o
    // que se cierre con la hoja firmada en papel, no probar cinco veces más.
    const despues = await confirmarConCodigo({ instruccionId: INSTRUCCION, familiaId: FAMILIA, codigo: '123456' });
    assert.equal(despues.ok, false);
    assert.equal(despues.motivo, 'demasiados_intentos');
  });
});
