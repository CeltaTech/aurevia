/**
 * Qué sale hacia el navegador cuando algo falla.
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El motor entra a la base con la llave maestra, así que el texto
 * crudo de un error de Postgres describe la base entera: nombra tablas, columnas y
 * restricciones. Ese texto no puede llegar nunca al navegador (`celtatech/CLAUDE.md` §6) —
 * quien mire la pantalla con las herramientas del navegador abiertas se lleva el mapa del
 * esquema sin haber atacado nada.
 *
 * Y era exactamente lo que pasaba: 208 lugares del motor contestaban
 * `res.status(500).json({ error: error.message })`. `responderError` existía como punto único
 * para esto y también lo mandaba, contradiciendo el comentario escrito tres renglones más
 * arriba en su propio archivo.
 *
 * QUÉ CUIDA CADA PRUEBA, Y QUÉ PASARÍA SIN ELLA. La primera es la que importa: le da a
 * `responderError` un error de Postgres de verdad, con el nombre de una tabla y de una
 * restricción adentro, y exige que ninguna de esas palabras aparezca en el cuerpo de la
 * respuesta. Con el código viejo esta prueba falla en el primer `assert`. Las otras cuidan que
 * al taparlo no se haya perdido lo que la pantalla sí necesita: el motivo, para poder explicar,
 * y el código de respuesta que le corresponde a ese motivo.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { ErrorConMotivo, responderError } from '../errorConMotivo.js';

/** Un `res` de Express con lo justo: guarda el estado y el cuerpo en vez de mandarlos. */
function respuestaFalsa() {
  const capturado = { estado: 0, cuerpo: null };
  const res = {
    req: { method: 'POST', originalUrl: '/api/panel/facturas' },
    status(codigo) {
      capturado.estado = codigo;
      return res;
    },
    json(cuerpo) {
      capturado.cuerpo = cuerpo;
      return res;
    },
  };
  return { res, capturado };
}

/** Silencia el registro del servidor mientras corre `fn`, y devuelve lo que se registró. */
function sinRuido(fn) {
  const original = console.error;
  const registrado = [];
  console.error = (...partes) => registrado.push(partes.map(String).join(' '));
  try {
    fn();
  } finally {
    console.error = original;
  }
  return registrado;
}

describe('responderError', () => {
  it('no deja salir el texto crudo de un error de la base', () => {
    // Textual de lo que contesta Postgres cuando salta la clave compuesta que impide que una
    // factura le cobre a una Familia un Servicio de otra Prestadora.
    const errorDeLaBase = new Error(
      'insert or update on table "facturas_familia_items" violates foreign key constraint ' +
        '"facturas_familia_items_servicio_de_la_misma_prestadora"',
    );
    errorDeLaBase.code = '23503';
    errorDeLaBase.details =
      'Key (servicio_id, prestadora_id)=(70000000-0000-4000-8000-000000000001, ' +
      '11111111-1111-4111-8111-111111111111) is not present in table "servicios".';

    const { res, capturado } = respuestaFalsa();
    sinRuido(() => responderError(res, errorDeLaBase));

    const cuerpo = JSON.stringify(capturado.cuerpo);
    for (const palabra of [
      'facturas_familia_items',
      'facturas_familia_items_servicio_de_la_misma_prestadora',
      'foreign key',
      'servicio_id',
      'prestadora_id',
      'servicios',
      '23503',
    ]) {
      assert.equal(
        cuerpo.includes(palabra),
        false,
        `el cuerpo de la respuesta filtra «${palabra}»: ${cuerpo}`,
      );
    }
    assert.equal(capturado.estado, 500);
  });

  it('el detalle queda en el registro del servidor, con la ruta que falló', () => {
    const { res } = respuestaFalsa();
    const registrado = sinRuido(() =>
      responderError(res, new Error('column "matricula_vencimiento" does not exist')),
    );

    assert.equal(registrado.length, 1);
    assert.match(registrado[0], /matricula_vencimiento/);
    assert.match(registrado[0], /POST \/api\/panel\/facturas/);
  });

  it('el motivo sí viaja, porque es lo que le permite explicar a la pantalla', () => {
    const { res, capturado } = respuestaFalsa();
    sinRuido(() =>
      responderError(
        res,
        new ErrorConMotivo('correo_de_otra_cuenta', 'auth.users ya tiene ese correo'),
      ),
    );

    assert.equal(capturado.cuerpo.motivo, 'correo_de_otra_cuenta');
    assert.equal(capturado.estado, 409);
    assert.equal(JSON.stringify(capturado.cuerpo).includes('auth.users'), false);
  });

  it('sin motivo contesta un código y nunca una frase', () => {
    const { res, capturado } = respuestaFalsa();
    sinRuido(() => responderError(res, new Error('cualquier cosa'), 400));

    assert.equal(capturado.estado, 400);
    assert.equal(capturado.cuerpo.error, 'falla_del_sistema');
    assert.equal(capturado.cuerpo.motivo, undefined);
  });

  it('aguanta que no le llegue ningún error', () => {
    const { res, capturado } = respuestaFalsa();
    sinRuido(() => responderError(res, null));

    assert.equal(capturado.estado, 500);
    assert.equal(capturado.cuerpo.error, 'falla_del_sistema');
  });
});
