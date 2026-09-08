/**
 * Pruebas de la hoja que firma el titular.
 *
 * Es el documento que queda como constancia el día que alguien diga «yo nunca autoricé eso», así
 * que lo que se cuida acá no es la estética: que cada persona del círculo aparezca con nombre, que
 * cada acceso caiga del lado correcto —lo que puede y lo que no—, que el texto no se contradiga con
 * lo que rige, y que la huella cambie ante cualquier retoque del texto.
 *
 *   npm test --prefix backend
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  IDIOMA_DEL_DOCUMENTO,
  textoDeLaInstruccion,
  huellaDelDocumento,
} from '../documentoInstruccionCirculo.js';
import { CATALOGO_CIRCULO_FAMILIAR, accesosDeFabrica } from '../catalogoCirculoFamiliar.js';

const PRESTADORA = { nombre: 'Cuidados del Sur' };
const TITULAR = { nombre: 'Ana Gómez' };
const CARGADA_POR = { nombre: 'Laura Coordinadora' };
const FECHA = new Date('2026-09-08T15:30:00Z');

function unaHoja(personas) {
  return textoDeLaInstruccion({
    prestadora: PRESTADORA,
    titular: TITULAR,
    personas,
    cargadaPor: CARGADA_POR,
    fecha: FECHA,
  });
}

// Devuelve los renglones que están entre un encabezado y el siguiente renglón vacío. Sirve para
// preguntar por lo que quedó del lado de «Puede» sin depender de dónde caiga en la hoja.
function bloque(texto, encabezado) {
  const renglones = texto.split('\n');
  const desde = renglones.indexOf(`  ${encabezado}`);
  assert.notEqual(desde, -1, `la hoja no tiene un bloque «${encabezado}»`);
  const resto = renglones.slice(desde + 1);
  const hasta = resto.indexOf('');
  return resto.slice(0, hasta === -1 ? resto.length : hasta);
}

describe('textoDeLaInstruccion', () => {
  it('el documento se guarda en castellano y así queda declarado', () => {
    assert.equal(IDIOMA_DEL_DOCUMENTO, 'es-AR');
  });

  it('nombra a la Prestadora, al titular, a quien lo cargó y la fecha', () => {
    // Sin esos cuatro datos la hoja no es constancia de nada: no se sabe quién instruyó, a quién,
    // ni cuándo.
    const texto = unaHoja([{ nombre: 'Marcela Gómez', email: 'marcela@ejemplo.local', accesos: accesosDeFabrica() }]);
    assert.match(texto, /Cuidados del Sur/);
    assert.match(texto, /Ana Gómez/);
    assert.match(texto, /Laura Coordinadora/);
    assert.match(texto, /08\/09\/2026/);
  });

  it('cada persona del círculo aparece con su nombre y su correo', () => {
    const texto = unaHoja([
      { nombre: 'Marcela Gómez', email: 'marcela@ejemplo.local', accesos: accesosDeFabrica() },
      { nombre: 'Jorge Gómez', email: 'jorge@ejemplo.local', accesos: accesosDeFabrica() },
    ]);
    assert.match(texto, /Marcela Gómez {2}\(marcela@ejemplo\.local\)/);
    assert.match(texto, /Jorge Gómez {2}\(jorge@ejemplo\.local\)/);
  });

  it('cada acceso cae de un lado o del otro, y ninguno se pierde por el camino', () => {
    const texto = unaHoja([{ nombre: 'Marcela Gómez', email: 'marcela@ejemplo.local', accesos: accesosDeFabrica() }]);
    const puede = bloque(texto, 'Puede:');
    const noPuede = bloque(texto, 'No puede:');
    assert.equal(puede.length + noPuede.length, CATALOGO_CIRCULO_FAMILIAR.length);
  });

  it('lo negado se lee en el bloque de lo que no puede, con la misma frase del catálogo', () => {
    const accesos = { ...accesosDeFabrica(), circulo_dinero: false };
    const texto = unaHoja([{ nombre: 'Marcela Gómez', email: 'marcela@ejemplo.local', accesos }]);
    const dinero = CATALOGO_CIRCULO_FAMILIAR.find((cosa) => cosa.clave === 'circulo_dinero').descripcion;

    assert.ok(bloque(texto, 'No puede:').some((renglon) => renglon.includes(dinero)));
    assert.ok(!bloque(texto, 'Puede:').some((renglon) => renglon.includes(dinero)));
  });

  it('el orden es siempre el del catálogo, para poder comparar dos hojas renglón por renglón', () => {
    const texto = unaHoja([{ nombre: 'Marcela Gómez', email: 'marcela@ejemplo.local', accesos: accesosDeFabrica() }]);
    const puede = bloque(texto, 'Puede:');
    const esperado = CATALOGO_CIRCULO_FAMILIAR
      .filter((cosa) => cosa.de_fabrica)
      .map((cosa) => `    - ${cosa.descripcion}`);
    assert.deepEqual(puede, esperado);
  });

  it('a quien no le dieron nada, la hoja se lo dice con todas las letras', () => {
    const accesos = Object.fromEntries(CATALOGO_CIRCULO_FAMILIAR.map((cosa) => [cosa.clave, false]));
    const texto = unaHoja([{ nombre: 'Marcela Gómez', email: 'marcela@ejemplo.local', accesos }]);
    assert.deepEqual(bloque(texto, 'Puede:'), ['    - Nada de lo que sigue.']);
    assert.equal(bloque(texto, 'No puede:').length, CATALOGO_CIRCULO_FAMILIAR.length);
  });

  it('y a quien le dieron todo, también', () => {
    const accesos = Object.fromEntries(CATALOGO_CIRCULO_FAMILIAR.map((cosa) => [cosa.clave, true]));
    const texto = unaHoja([{ nombre: 'Marcela Gómez', email: 'marcela@ejemplo.local', accesos }]);
    assert.deepEqual(bloque(texto, 'No puede:'), ['    - Nada: tiene todos los accesos.']);
  });

  it('un círculo vacío no produce una hoja en blanco', () => {
    const texto = unaHoja([]);
    assert.match(texto, /No hay ninguna persona anotada en el círculo familiar\./);
  });

  it('deja escrito que esto no le quita nada al titular', () => {
    // Es la frase que evita la lectura al revés: que alguien crea que firmó una hoja que le
    // recorta lo suyo.
    const texto = unaHoja([{ nombre: 'Marcela Gómez', email: 'marcela@ejemplo.local', accesos: accesosDeFabrica() }]);
    assert.match(texto, /El titular ve toda la información de su cuenta y esto no lo modifica\./);
  });

  it('y que la hoja nueva reemplaza a la anterior por completo', () => {
    const texto = unaHoja([{ nombre: 'Marcela Gómez', email: 'marcela@ejemplo.local', accesos: accesosDeFabrica() }]);
    assert.match(texto, /Esta instrucción rige desde que la Prestadora la registra\./);
    assert.match(texto, /ésta por completo\./);
  });

  it('un dato que falta no rompe la hoja ni escribe «undefined»', () => {
    const texto = textoDeLaInstruccion({ personas: [{ accesos: accesosDeFabrica() }] });
    assert.ok(!texto.includes('undefined'));
    assert.ok(!texto.includes('null'));
  });
});

describe('huellaDelDocumento', () => {
  it('el mismo texto da siempre la misma huella', () => {
    const texto = unaHoja([{ nombre: 'Marcela Gómez', email: 'marcela@ejemplo.local', accesos: accesosDeFabrica() }]);
    assert.equal(huellaDelDocumento(texto), huellaDelDocumento(texto));
  });

  it('mover una sola coma cambia la huella', () => {
    // Es todo lo que la huella promete: no es firma digital, es la constancia de que el texto
    // guardado es el que se firmó.
    const texto = unaHoja([{ nombre: 'Marcela Gómez', email: 'marcela@ejemplo.local', accesos: accesosDeFabrica() }]);
    assert.notEqual(huellaDelDocumento(texto), huellaDelDocumento(`${texto} `));
  });

  it('dos hojas que se diferencian en un solo acceso no comparten huella', () => {
    const conTodo = unaHoja([{ nombre: 'Marcela Gómez', email: 'marcela@ejemplo.local', accesos: accesosDeFabrica() }]);
    const sinDinero = unaHoja([{
      nombre: 'Marcela Gómez',
      email: 'marcela@ejemplo.local',
      accesos: { ...accesosDeFabrica(), circulo_dinero: false },
    }]);
    assert.notEqual(huellaDelDocumento(conTodo), huellaDelDocumento(sinDinero));
  });

  it('la huella es sha256 en hexadecimal', () => {
    assert.match(huellaDelDocumento('lo que sea'), /^[0-9a-f]{64}$/);
  });
});
