/**
 * Qué fotos verifican la identidad de un Asistente, y dónde vive cada una.
 *
 *   npm test --prefix backend
 *   node --test backend/src/utils/__tests__/fotosDeIdentidad.test.js
 *
 * POR QUÉ EXISTE ESTA PRUEBA. De estas dos decisiones cuelga el aislamiento del depósito
 * `fotos-identidad`, que no tiene ninguna política: que la lista de tipos sea cerrada —si no, el
 * nombre del archivo adentro del depósito lo elige quien manda el pedido— y que la ruta empiece
 * por la Prestadora y se pueda volver a armar igual cada vez, porque no hay ninguna columna que
 * diga dónde quedó guardada una foto.
 *
 * Con la lista abierta, la prueba del tipo inventado da al revés. Con una ruta que no empiece por
 * la Prestadora, la del orden también.
 *
 * Datos inventados, como manda CLAUDE.md §6.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import {
  FOTOS_DE_IDENTIDAD,
  FORMATOS_DE_FOTO,
  TAMANO_MAXIMO_DE_FOTO,
  TIPO_DOCUMENTO,
  TIPO_PERFIL,
  esFotoDeIdentidad,
  rutaEnElDeposito,
} from '../fotosDeIdentidad.js';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const ASISTENTE = '44444444-4444-4444-4444-444444444444';

describe('las dos fotos de la verificación de identidad', () => {
  it('son dos y se saben cuáles', () => {
    assert.deepEqual(FOTOS_DE_IDENTIDAD, [TIPO_DOCUMENTO, TIPO_PERFIL]);
  });

  it('cualquier otro tipo queda afuera', () => {
    for (const tipo of ['selfie', 'documento.pdf', '../otra', '', null, undefined, 'DOCUMENTO']) {
      assert.equal(esFotoDeIdentidad(tipo), false, `${tipo} tendría que quedar afuera`);
    }
  });

  it('las dos que sí valen pasan', () => {
    assert.equal(esFotoDeIdentidad(TIPO_DOCUMENTO), true);
    assert.equal(esFotoDeIdentidad(TIPO_PERFIL), true);
  });
});

describe('la ruta adentro del depósito', () => {
  it('empieza por la Prestadora, después el Asistente y después el tipo', () => {
    assert.equal(
      rutaEnElDeposito(PRESTADORA, ASISTENTE, TIPO_DOCUMENTO),
      `${PRESTADORA}/${ASISTENTE}/${TIPO_DOCUMENTO}`,
    );
  });

  it('da siempre lo mismo con los mismos datos, que es de lo que depende volver a encontrarla', () => {
    assert.equal(
      rutaEnElDeposito(PRESTADORA, ASISTENTE, TIPO_PERFIL),
      rutaEnElDeposito(PRESTADORA, ASISTENTE, TIPO_PERFIL),
    );
  });

  it('no lleva extensión: el formato viaja en el tipo de contenido', () => {
    assert.equal(/\.[a-z]+$/.test(rutaEnElDeposito(PRESTADORA, ASISTENTE, TIPO_DOCUMENTO)), false);
  });

  it('dos Asistentes de la misma Prestadora no comparten lugar', () => {
    const otro = '55555555-5555-5555-5555-555555555555';
    assert.notEqual(
      rutaEnElDeposito(PRESTADORA, ASISTENTE, TIPO_DOCUMENTO),
      rutaEnElDeposito(PRESTADORA, otro, TIPO_DOCUMENTO),
    );
  });
});

describe('lo que se admite subir', () => {
  it('son imágenes, y ningún formato que pueda traer algo ejecutable adentro', () => {
    assert.deepEqual(FORMATOS_DE_FOTO, ['image/jpeg', 'image/png']);
  });

  it('el tope está en megabytes enteros, que es lo que la pantalla muestra', () => {
    assert.equal(TAMANO_MAXIMO_DE_FOTO % (1024 * 1024), 0);
    assert.ok(TAMANO_MAXIMO_DE_FOTO > 0);
  });
});
