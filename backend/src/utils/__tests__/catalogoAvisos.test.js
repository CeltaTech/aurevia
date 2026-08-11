/**
 * Pruebas del catálogo de avisos.
 *
 * Lo que se cuida acá es lo que salió mal antes: que un aviso desaparezca de la pantalla
 * porque nadie le sembró la fila. La mezcla tiene que devolver siempre los ocho.
 *
 *   npm test --prefix backend
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { CATALOGO_AVISOS, avisoDelCatalogo, mezclarAvisosConCatalogo } from '../catalogoAvisos.js';

describe('catálogo de avisos', () => {
  it('no hay dos avisos con la misma clave', () => {
    const claves = CATALOGO_AVISOS.map((aviso) => aviso.evento);
    assert.equal(new Set(claves).size, claves.length);
  });

  it('todos los avisos tienen sus cuatro datos', () => {
    for (const aviso of CATALOGO_AVISOS) {
      assert.equal(typeof aviso.evento, 'string');
      assert.ok(aviso.descripcion.length > 0, `${aviso.evento} sin descripción`);
      assert.equal(typeof aviso.admite_whatsapp, 'boolean');
      assert.equal(typeof aviso.admite_familia, 'boolean');
    }
  });

  it('busca un aviso por su clave y devuelve null si no existe', () => {
    assert.equal(avisoDelCatalogo('guardia_sin_cubrir').evento, 'guardia_sin_cubrir');
    assert.equal(avisoDelCatalogo('un_aviso_que_no_existe'), null);
  });
});

describe('mezclarAvisosConCatalogo', () => {
  it('sin ninguna fila guardada, igual devuelve todos los avisos', () => {
    const mezclados = mezclarAvisosConCatalogo([]);
    assert.equal(mezclados.length, CATALOGO_AVISOS.length);
    assert.ok(mezclados.every((aviso) => aviso.configurado === false));
  });

  it('sin fila, el aviso se manda igual: arranca encendido y sin correos', () => {
    const [primero] = mezclarAvisosConCatalogo(null);
    assert.equal(primero.activo, true);
    assert.deepEqual(primero.emails, []);
    assert.equal(primero.whatsapp_activo, false);
    assert.equal(primero.notificar_familia, false);
  });

  it('lo que la Prestadora guardó le gana a lo de fábrica', () => {
    const mezclados = mezclarAvisosConCatalogo([
      {
        evento: 'guardia_sin_cubrir',
        emails: ['coordinacion@ejemplo.com'],
        activo: false,
        whatsapp_activo: true,
        notificar_familia: false,
      },
    ]);
    const guardia = mezclados.find((aviso) => aviso.evento === 'guardia_sin_cubrir');
    assert.equal(guardia.configurado, true);
    assert.equal(guardia.activo, false);
    assert.deepEqual(guardia.emails, ['coordinacion@ejemplo.com']);
    assert.equal(guardia.whatsapp_activo, true);
  });

  it('una fila vieja de un aviso que ya no existe no reaparece', () => {
    const mezclados = mezclarAvisosConCatalogo([
      { evento: 'vencimiento_monotributo', emails: [], activo: true },
    ]);
    assert.equal(mezclados.length, CATALOGO_AVISOS.length);
    assert.ok(!mezclados.some((aviso) => aviso.evento === 'vencimiento_monotributo'));
  });
});
