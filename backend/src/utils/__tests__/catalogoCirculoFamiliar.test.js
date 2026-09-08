/**
 * Pruebas del catálogo de accesos del círculo familiar.
 *
 * Lo que se cuida acá es lo que convierte una instrucción firmada en una decoración: que una clave
 * se renombre —y con eso se pierda lo que el titular ya pidió—, que un acceso nuevo arranque
 * apagado sin que nadie lo haya decidido, que el tope de la Prestadora se pueda levantar desde una
 * Familia, y que un formulario incompleto termine negando lo que nadie negó.
 *
 *   npm test --prefix backend
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  CATALOGO_CIRCULO_FAMILIAR,
  CLAVES_DEL_CIRCULO,
  cosaDelCatalogo,
  accesosDeFabrica,
  accesosDelTitular,
  accesosEfectivos,
  mezclarAccesosConCatalogo,
  accesosParaGuardar,
} from '../catalogoCirculoFamiliar.js';
import { visibilidadDeFabrica } from '../catalogoVisibilidad.js';

// Las dos acciones de escritura que tiene la Familia. Están escritas acá y no leídas del catálogo
// a propósito: si alguien cambia el valor de fábrica de una de ellas, la prueba tiene que fallar.
const LAS_DOS_DE_ESCRITURA = ['circulo_califica_al_asistente', 'circulo_pide_medicacion'];

describe('catálogo del círculo familiar', () => {
  it('no hay dos accesos con la misma clave', () => {
    assert.equal(new Set(CLAVES_DEL_CIRCULO).size, CLAVES_DEL_CIRCULO.length);
  });

  it('cada acceso tiene sus cinco datos', () => {
    for (const cosa of CATALOGO_CIRCULO_FAMILIAR) {
      assert.equal(typeof cosa.clave, 'string');
      assert.ok(cosa.descripcion.length > 0, `${cosa.clave} sin descripción`);
      assert.ok(cosa.ayuda.length > 0, `${cosa.clave} sin explicación de qué se pierde al negarlo`);
      assert.equal(typeof cosa.de_fabrica, 'boolean');
      assert.ok(cosa.interruptor === null || typeof cosa.interruptor === 'string');
    }
  });

  it('la clave empieza con circulo_', () => {
    // La misma clave viaja adentro del texto que el titular firmó y adentro de las políticas de la
    // base. Que se lea sola evita confundirla con un interruptor de la Prestadora.
    for (const cosa of CATALOGO_CIRCULO_FAMILIAR) {
      assert.ok(cosa.clave.startsWith('circulo_'), `${cosa.clave} debería empezar con circulo_`);
    }
  });

  it('todo interruptor nombrado existe de verdad en el catálogo de la Prestadora', () => {
    // Es la prueba que atrapa el error más silencioso de los dos catálogos: un interruptor mal
    // escrito no rompe nada, simplemente deja de topar. La Prestadora apagaría el mapa y la
    // Familia lo seguiría viendo, sin ningún error en ningún lado.
    const deLaPrestadora = visibilidadDeFabrica();
    for (const cosa of CATALOGO_CIRCULO_FAMILIAR) {
      if (!cosa.interruptor) continue;
      assert.ok(
        Object.hasOwn(deLaPrestadora, cosa.interruptor),
        `${cosa.clave} apunta al interruptor ${cosa.interruptor}, que no existe`,
      );
    }
  });

  it('de fábrica el círculo ve todo, y las dos acciones de escritura vienen negadas', () => {
    // Es exactamente lo que el producto hacía antes de esta función: quien no pida ningún cambio
    // no tiene que notar ninguno.
    for (const cosa of CATALOGO_CIRCULO_FAMILIAR) {
      assert.equal(cosa.de_fabrica, !LAS_DOS_DE_ESCRITURA.includes(cosa.clave), cosa.clave);
    }
  });

  it('busca un acceso por su clave y devuelve null si no existe', () => {
    assert.equal(cosaDelCatalogo('circulo_dinero').interruptor, 'familia_pagos_y_suscripcion');
    assert.equal(cosaDelCatalogo('circulo_que_no_existe'), null);
  });
});

describe('accesosEfectivos', () => {
  it('el titular tiene todo, sin consultar ninguna fila', () => {
    const suyos = accesosEfectivos({ esTitular: true });
    assert.deepEqual(suyos, accesosDelTitular());
    assert.ok(Object.values(suyos).every((valor) => valor === true));
  });

  it('sin ninguna fila guardada, rige lo de fábrica', () => {
    assert.deepEqual(accesosEfectivos({ esTitular: false, filasGuardadas: [] }), accesosDeFabrica());
    assert.deepEqual(accesosEfectivos({ esTitular: false, filasGuardadas: null }), accesosDeFabrica());
    assert.deepEqual(accesosEfectivos({ esTitular: false }), accesosDeFabrica());
  });

  it('lo que el titular pidió le gana a lo de fábrica, en los dos sentidos', () => {
    const efectivos = accesosEfectivos({
      esTitular: false,
      filasGuardadas: [
        { clave: 'circulo_dinero', permitido: false },
        { clave: 'circulo_califica_al_asistente', permitido: true },
      ],
    });
    assert.equal(efectivos.circulo_dinero, false);
    assert.equal(efectivos.circulo_califica_al_asistente, true);
    assert.equal(efectivos.circulo_reportes, true);
  });

  it('una fila vieja de un acceso retirado del producto no reaparece', () => {
    const efectivos = accesosEfectivos({
      esTitular: false,
      filasGuardadas: [{ clave: 'circulo_algo_que_ya_no_existe', permitido: true }],
    });
    assert.deepEqual(efectivos, accesosDeFabrica());
  });

  it('devuelve siempre verdadero o falso, nunca lo que vino de la base', () => {
    const efectivos = accesosEfectivos({
      esTitular: false,
      filasGuardadas: [{ clave: 'circulo_reportes', permitido: null }],
    });
    assert.equal(efectivos.circulo_reportes, false);
    assert.ok(Object.values(efectivos).every((valor) => typeof valor === 'boolean'));
  });

  it('el tope de la Prestadora manda: ninguna Familia puede encender lo que ella apagó', () => {
    const visibilidad = { ...visibilidadDeFabrica(), familia_ubicacion_en_vivo: false };
    const efectivos = accesosEfectivos({
      esTitular: false,
      filasGuardadas: [{ clave: 'circulo_ubicacion_en_vivo', permitido: true }],
      visibilidad,
    });
    assert.equal(efectivos.circulo_ubicacion_en_vivo, false);
  });

  it('y el tope alcanza también al titular', () => {
    // El titular ve todo lo de su cuenta, pero lo que la Prestadora no ofrece no existe para
    // nadie. Sin esto, la aplicación le dibujaría al titular un mapa que la Prestadora apagó.
    const visibilidad = { ...visibilidadDeFabrica(), familia_pagos_y_suscripcion: false };
    const suyos = accesosEfectivos({ esTitular: true, visibilidad });
    assert.equal(suyos.circulo_dinero, false);
    assert.equal(suyos.circulo_reportes, true);
  });
});

describe('mezclarAccesosConCatalogo', () => {
  it('sin ninguna fila guardada, igual devuelve los once accesos', () => {
    const mezclados = mezclarAccesosConCatalogo({ filasGuardadas: [] });
    assert.equal(mezclados.length, CATALOGO_CIRCULO_FAMILIAR.length);
    assert.ok(mezclados.every((cosa) => cosa.configurado === false));
    assert.ok(mezclados.every((cosa) => cosa.permitido === cosa.de_fabrica));
  });

  it('distingue lo que ya se instruyó de lo que rige mientras tanto', () => {
    const mezclados = mezclarAccesosConCatalogo({
      filasGuardadas: [{ clave: 'circulo_dinero', permitido: false }],
    });
    const dinero = mezclados.find((cosa) => cosa.clave === 'circulo_dinero');
    assert.equal(dinero.configurado, true);
    assert.equal(dinero.permitido, false);
    assert.equal(dinero.de_fabrica, true);

    const reportes = mezclados.find((cosa) => cosa.clave === 'circulo_reportes');
    assert.equal(reportes.configurado, false);
    assert.equal(reportes.permitido, true);
  });

  it('avisa cuál casilla la apagó la Prestadora, para que la pantalla lo pueda explicar', () => {
    const visibilidad = { ...visibilidadDeFabrica(), familia_alertas_de_la_revision: false };
    const mezclados = mezclarAccesosConCatalogo({
      filasGuardadas: [{ clave: 'circulo_alertas', permitido: true }],
      visibilidad,
    });
    const alertas = mezclados.find((cosa) => cosa.clave === 'circulo_alertas');
    assert.equal(alertas.topado, true);
    assert.equal(alertas.permitido, false);

    const reportes = mezclados.find((cosa) => cosa.clave === 'circulo_reportes');
    assert.equal(reportes.topado, false);
  });

  it('una fila vieja de un acceso retirado no reaparece en la pantalla', () => {
    const mezclados = mezclarAccesosConCatalogo({
      filasGuardadas: [{ clave: 'circulo_algo_que_ya_no_existe', permitido: true }],
    });
    assert.equal(mezclados.length, CATALOGO_CIRCULO_FAMILIAR.length);
    assert.ok(!mezclados.some((cosa) => cosa.clave === 'circulo_algo_que_ya_no_existe'));
  });
});

describe('accesosParaGuardar', () => {
  it('siempre devuelve los once, aunque el formulario haya mandado tres', () => {
    // Una fila ausente para la base significa "no" —la función falla cerrado—, así que guardar
    // solamente lo que vino negaría accesos que nadie negó.
    const paraGuardar = accesosParaGuardar({ pedido: { circulo_dinero: false } });
    assert.equal(paraGuardar.length, CATALOGO_CIRCULO_FAMILIAR.length);
    assert.deepEqual(paraGuardar.map((fila) => fila.clave), CLAVES_DEL_CIRCULO);
  });

  it('lo que no vino en el pedido se guarda con su valor de fábrica', () => {
    const paraGuardar = accesosParaGuardar({ pedido: { circulo_dinero: false } });
    const porClave = Object.fromEntries(paraGuardar.map((fila) => [fila.clave, fila.permitido]));
    assert.equal(porClave.circulo_dinero, false);
    assert.equal(porClave.circulo_reportes, true);
    assert.equal(porClave.circulo_pide_medicacion, false);
  });

  it('una clave desconocida se descarta sin ruido', () => {
    const paraGuardar = accesosParaGuardar({ pedido: { circulo_inventado: true } });
    assert.equal(paraGuardar.length, CATALOGO_CIRCULO_FAMILIAR.length);
    assert.ok(!paraGuardar.some((fila) => fila.clave === 'circulo_inventado'));
  });

  it('lo topado por la Prestadora se guarda en falso', () => {
    // El documento que va a firmar el titular tiene que decir lo mismo que rige. Si acá se
    // guardara el "sí" que pidió, la hoja diría una cosa y el sistema haría otra.
    const visibilidad = { ...visibilidadDeFabrica(), familia_medicacion_del_paciente: false };
    const paraGuardar = accesosParaGuardar({
      pedido: { circulo_medicacion: true },
      visibilidad,
    });
    const medicacion = paraGuardar.find((fila) => fila.clave === 'circulo_medicacion');
    assert.equal(medicacion.permitido, false);
  });

  it('un pedido vacío deja exactamente lo de fábrica', () => {
    const deFabrica = accesosDeFabrica();
    for (const pedido of [{}, null, undefined]) {
      const paraGuardar = accesosParaGuardar({ pedido });
      for (const fila of paraGuardar) {
        assert.equal(fila.permitido, deFabrica[fila.clave], fila.clave);
      }
    }
  });
});
