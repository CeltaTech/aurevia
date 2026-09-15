/**
 * Tapar el dato de contacto adentro del chat del Marketplace.
 *
 *   npm test --prefix backend
 *
 * QUÉ SE PRUEBA ACÁ, Y POR QUÉ ESTO. Lo que el Marketplace vende es llegar a la persona por
 * afuera. El chat es libre, así que el chat es la puerta por la que ese dato se puede regalar:
 * alcanza con que alguien escriba su número. Estas pruebas son las del agujero, no las de la
 * expresión regular.
 *
 * QUÉ DARÍA CON EL SISTEMA ROTO. Si el tapado no se aplicara, el caso del teléfono escrito con
 * espacios devuelve el número entero y la prueba lo encuentra adentro del texto. Si tapara todo
 * lo que tiene un dígito, la prueba del mensaje con una hora y un precio lo reporta. Y si
 * `mensajeHaciaAfuera` decidiera por su cuenta en vez de mirar si el contacto está abierto, la
 * pareja que ya pagó seguiría viendo marcas donde pagó por ver el dato.
 *
 * LO QUE ESTAS PRUEBAS NO PUEDEN PROBAR. Que no se escape ninguna forma de escribir un teléfono.
 * Eso no lo prueba nadie, y por eso el producto avisa en la pantalla en vez de prometer que tapa
 * todo.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MARCA_TAPADO, taparContacto, mensajeHaciaAfuera } from '../contactoTapado.js';

/** Un teléfono inventado, como pide `celtatech/CLAUDE.md` §6: nunca datos de personas reales. */
const TELEFONO = '11 5555 4444';

describe('taparContacto', () => {
  it('tapa un teléfono escrito con espacios', () => {
    const { texto, tapado } = taparContacto(`Llamame al ${TELEFONO} cuando puedas`);
    assert.equal(tapado, true);
    assert.ok(!texto.includes('5555'), texto);
    assert.ok(texto.includes(MARCA_TAPADO), texto);
    // Lo que no es el dato sigue estando: el mensaje se entrega, no se cancela.
    assert.ok(texto.includes('Llamame al'));
    assert.ok(texto.includes('cuando puedas'));
  });

  it('tapa un teléfono escrito con guiones, con paréntesis y con prefijo de país', () => {
    for (const forma of ['+54 9 11 5555-4444', '(011) 5555-4444', '11.5555.4444', '1155554444']) {
      const { texto, tapado } = taparContacto(`mi numero es ${forma}`);
      assert.equal(tapado, true, forma);
      assert.ok(!/\d{4}/.test(texto), `${forma} -> ${texto}`);
    }
  });

  it('tapa un correo', () => {
    const { texto, tapado } = taparContacto('escribime a alguien.inventado@ejemplo.test');
    assert.equal(tapado, true);
    assert.ok(!texto.includes('@ejemplo'), texto);
  });

  it('tapa una dirección web y un nombre de usuario de una red', () => {
    const conWeb = taparContacto('mira https://ejemplo.test/mi-perfil');
    assert.equal(conWeb.tapado, true);
    assert.ok(!conWeb.texto.includes('ejemplo.test'), conWeb.texto);

    const conUsuario = taparContacto('buscame como @alguieninventado');
    assert.equal(conUsuario.tapado, true);
    assert.ok(!conUsuario.texto.includes('alguieninventado'), conUsuario.texto);
  });

  it('tapa varios datos en el mismo mensaje', () => {
    const { texto, tapado } = taparContacto(`${TELEFONO} o alguien@ejemplo.test`);
    assert.equal(tapado, true);
    assert.ok(!texto.includes('5555'), texto);
    assert.ok(!texto.includes('@ejemplo'), texto);
  });

  it('no tapa una hora, un precio ni una fecha', () => {
    const mensajes = [
      'puedo a las 14:30',
      'serian 2500 por turno',
      'empiezo el 15/09',
      'tengo 12 años de experiencia',
    ];
    for (const mensaje of mensajes) {
      const { texto, tapado } = taparContacto(mensaje);
      assert.equal(tapado, false, mensaje);
      assert.equal(texto, mensaje);
    }
  });

  it('no deja pegadas las palabras que rodeaban al dato', () => {
    const { texto } = taparContacto(`antes ${TELEFONO} despues`);
    assert.ok(texto.includes(`antes ${MARCA_TAPADO} despues`), texto);
  });

  it('con algo que no es un texto devuelve vacío y no lo deja pasar', () => {
    for (const entrada of [null, undefined, 42, {}]) {
      assert.deepEqual(taparContacto(entrada), { texto: '', tapado: false });
    }
  });
});

describe('mensajeHaciaAfuera', () => {
  const fila = {
    id: 'm-1',
    lado: 'asistente',
    automatico: false,
    created_at: '2026-09-15T10:00:00Z',
    leido_at: null,
    cuerpo: `Llamame al ${TELEFONO}`,
    // Lo que nunca tiene que salir de acá: quién escribió, de qué Prestadora es y en qué hilo.
    autor_usuario_id: 'u-1',
    prestadora_id: 'p-1',
    conversacion_id: 'c-1',
  };

  it('sin el contacto abierto sale tapado', () => {
    const afuera = mensajeHaciaAfuera(fila, false);
    assert.equal(afuera.tapado, true);
    assert.ok(!afuera.cuerpo.includes('5555'), afuera.cuerpo);
  });

  it('con el contacto abierto sale entero, porque es el dato que se pagó', () => {
    const afuera = mensajeHaciaAfuera(fila, true);
    assert.equal(afuera.tapado, false);
    assert.equal(afuera.cuerpo, fila.cuerpo);
  });

  it('falla cerrado ante cualquier cosa que no sea un sí', () => {
    for (const dudoso of [undefined, null, 'si', 1, {}]) {
      assert.equal(mensajeHaciaAfuera(fila, dudoso).tapado, true, String(dudoso));
    }
  });

  it('no deja salir quién escribió, de qué Prestadora es ni de qué hilo', () => {
    const afuera = mensajeHaciaAfuera(fila, true);
    assert.deepEqual(
      Object.keys(afuera).sort(),
      ['automatico', 'created_at', 'cuerpo', 'id', 'lado', 'leido_at', 'tapado']
    );
  });

  it('un mensaje automático no pasa por el tapado: su cuerpo es una clave', () => {
    const automatico = { ...fila, automatico: true, cuerpo: 'videollamada_empezo' };
    const afuera = mensajeHaciaAfuera(automatico, false);
    assert.equal(afuera.cuerpo, 'videollamada_empezo');
    assert.equal(afuera.tapado, false);
  });
});
