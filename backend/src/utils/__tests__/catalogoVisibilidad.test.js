/**
 * Pruebas del catálogo de qué muestra cada aplicación.
 *
 * Lo que se cuida acá es lo que rompe un interruptor de configuración: que una clave se
 * duplique o se renombre (y con eso se pierda la decisión que la Prestadora ya había
 * tomado), que un interruptor nuevo arranque apagada sin querer, y que la lista de columnas de
 * una consulta deje pasar un dato que estaba apagado.
 *
 *   npm test --prefix backend
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  APLICACIONES,
  CATALOGO_VISIBILIDAD,
  cosaDelCatalogo,
  visibilidadDeFabrica,
  visibilidadEfectiva,
  mezclarVisibilidadConCatalogo,
  columnasSegunVisibilidad,
} from '../catalogoVisibilidad.js';

describe('catálogo de visibilidad', () => {
  it('no hay dos interruptores con la misma clave', () => {
    const claves = CATALOGO_VISIBILIDAD.map((cosa) => cosa.clave);
    assert.equal(new Set(claves).size, claves.length);
  });

  it('cada interruptor tiene sus cinco datos y pertenece a una de las dos aplicaciones', () => {
    for (const cosa of CATALOGO_VISIBILIDAD) {
      assert.equal(typeof cosa.clave, 'string');
      assert.ok(APLICACIONES.includes(cosa.app), `${cosa.clave} no pertenece a ninguna aplicación`);
      assert.ok(cosa.descripcion.length > 0, `${cosa.clave} sin descripción`);
      assert.ok(cosa.ayuda.length > 0, `${cosa.clave} sin explicación de qué se pierde al apagarla`);
      assert.equal(typeof cosa.de_fabrica, 'boolean');
    }
  });

  it('la clave empieza con el nombre de su aplicación', () => {
    // No es capricho: la pantalla del Panel agrupa por aplicación y el motor lee las claves
    // sueltas. Que se lean solas evita mirar el catálogo para saber a quién le pega apagarla.
    for (const cosa of CATALOGO_VISIBILIDAD) {
      const prefijo = cosa.app === 'familias' ? 'familia_' : 'asistente_';
      assert.ok(cosa.clave.startsWith(prefijo), `${cosa.clave} debería empezar con ${prefijo}`);
    }
  });

  it('todas arrancan encendidas: hoy las aplicaciones muestran todo', () => {
    // CLAUDE.md §3: ningún interruptor arranca apagado por decisión del sistema. Y el valor de
    // fábrica tiene que ser lo que el producto ya hacía, para que quien no entre a la
    // pantalla no vea cambiar nada.
    assert.ok(CATALOGO_VISIBILIDAD.every((cosa) => cosa.de_fabrica === true));
  });

  it('busca un interruptor por su clave y devuelve null si no existe', () => {
    assert.equal(cosaDelCatalogo('familia_signos_vitales').app, 'familias');
    assert.equal(cosaDelCatalogo('una_interruptor_que_no_existe'), null);
  });
});

describe('visibilidadEfectiva', () => {
  it('sin ninguna fila guardada, rige lo de fábrica', () => {
    assert.deepEqual(visibilidadEfectiva([]), visibilidadDeFabrica());
    assert.deepEqual(visibilidadEfectiva(null), visibilidadDeFabrica());
    assert.deepEqual(visibilidadEfectiva(undefined), visibilidadDeFabrica());
  });

  it('lo que la Prestadora guardó le gana a lo de fábrica', () => {
    const efectiva = visibilidadEfectiva([{ clave: 'familia_ubicacion_en_vivo', visible: false }]);
    assert.equal(efectiva.familia_ubicacion_en_vivo, false);
    assert.equal(efectiva.familia_signos_vitales, true);
  });

  it('una fila vieja de un interruptor retirado se ignora', () => {
    const efectiva = visibilidadEfectiva([{ clave: 'familia_algo_que_ya_no_existe', visible: false }]);
    assert.deepEqual(efectiva, visibilidadDeFabrica());
  });

  it('devuelve siempre verdadero o falso, nunca lo que vino de la base', () => {
    // Si acá se colara un null, `if (visibilidad[clave])` lo leería como apagado en un lado y
    // el maquetado lo leería como "no sé" en el otro.
    const efectiva = visibilidadEfectiva([{ clave: 'asistente_foto_en_el_reporte', visible: null }]);
    assert.equal(efectiva.asistente_foto_en_el_reporte, false);
    assert.ok(Object.values(efectiva).every((valor) => typeof valor === 'boolean'));
  });
});

describe('mezclarVisibilidadConCatalogo', () => {
  it('sin ninguna fila guardada, igual devuelve todas los interruptores', () => {
    const mezcladas = mezclarVisibilidadConCatalogo([]);
    assert.equal(mezcladas.length, CATALOGO_VISIBILIDAD.length);
    assert.ok(mezcladas.every((cosa) => cosa.configurado === false));
    assert.ok(mezcladas.every((cosa) => cosa.visible === true));
  });

  it('distingue lo que la Prestadora eligió de lo que rige mientras tanto', () => {
    const mezcladas = mezclarVisibilidadConCatalogo([
      { clave: 'asistente_relato_con_ia', visible: false },
    ]);
    const relato = mezcladas.find((cosa) => cosa.clave === 'asistente_relato_con_ia');
    assert.equal(relato.configurado, true);
    assert.equal(relato.visible, false);
    assert.equal(relato.de_fabrica, true);

    const otra = mezcladas.find((cosa) => cosa.clave === 'asistente_foto_en_el_reporte');
    assert.equal(otra.configurado, false);
    assert.equal(otra.visible, true);
  });

  it('una fila vieja de un interruptor retirado no reaparece en la pantalla', () => {
    const mezcladas = mezclarVisibilidadConCatalogo([
      { clave: 'familia_algo_que_ya_no_existe', visible: true },
    ]);
    assert.equal(mezcladas.length, CATALOGO_VISIBILIDAD.length);
    assert.ok(!mezcladas.some((cosa) => cosa.clave === 'familia_algo_que_ya_no_existe'));
  });
});

describe('columnasSegunVisibilidad', () => {
  // Acá está el sentido de toda la tarea: lo apagado no se pide, así que tampoco viaja.
  it('deja afuera las columnas cuya interruptor está apagada', () => {
    const columnas = columnasSegunVisibilidad(
      ['id', 'nombre', ['domicilio', 'asistente_domicilio_del_paciente'], ['patologias', 'asistente_patologias_del_paciente']],
      { asistente_domicilio_del_paciente: false, asistente_patologias_del_paciente: true },
    );
    assert.equal(columnas, 'id, nombre, patologias');
  });

  it('las columnas sin condición van siempre', () => {
    assert.equal(columnasSegunVisibilidad(['id', 'nombre'], {}), 'id, nombre');
  });

  it('un interruptor que no está en la lista se toma como encendida', () => {
    // Pasa mientras una versión vieja del motor y una nueva del catálogo conviven un rato: es
    // preferible seguir mostrando lo que ya se mostraba a romper la pantalla.
    assert.equal(columnasSegunVisibilidad([['patologias', 'clave_desconocida']], {}), 'patologias');
  });
});
