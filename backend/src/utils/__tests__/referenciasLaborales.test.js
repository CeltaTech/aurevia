import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  RESULTADOS_DE_REFERENCIA,
  RESULTADO_PENDIENTE,
  RESULTADO_VERIFICADA,
  RESULTADO_NO_RESPONDE,
  RESULTADO_RECHAZADA,
  TOPE_DE_REFERENCIAS,
  esResultadoDeReferencia,
  contarVerificadas,
  estadoDeLasReferencias,
} from '../referenciasLaborales.js';

// El módulo que comparten la pantalla y el motor. Lo que acá se acepte, la base lo acepta: el
// CHECK de `referencias_laborales_asistente` lleva exactamente estos cuatro nombres.

describe('los cuatro resultados de una referencia', () => {
  it('son cuatro, y se sabe cuáles', () => {
    assert.deepEqual(RESULTADOS_DE_REFERENCIA, ['pendiente', 'verificada', 'no_responde', 'rechazada']);
  });

  it('acepta cada uno de los cuatro', () => {
    for (const resultado of [RESULTADO_PENDIENTE, RESULTADO_VERIFICADA, RESULTADO_NO_RESPONDE, RESULTADO_RECHAZADA]) {
      assert.equal(esResultadoDeReferencia(resultado), true);
    }
  });

  it('rechaza cualquier otra cosa, incluida la que sólo cambia de mayúsculas', () => {
    for (const nada of ['VERIFICADA', 'ok', 'aprobada', '', null, undefined, 0, {}]) {
      assert.equal(esResultadoDeReferencia(nada), false);
    }
  });

  it('el tope es el mismo que admite el formulario de postulación', () => {
    assert.equal(TOPE_DE_REFERENCIAS, 5);
  });
});

describe('cuántas quedaron verificadas', () => {
  it('cuenta sólo las verificadas, no las que se llamaron sin suerte', () => {
    const referencias = [
      { resultado: 'verificada' },
      { resultado: 'no_responde' },
      { resultado: 'rechazada' },
      { resultado: 'verificada' },
      { resultado: 'pendiente' },
    ];
    assert.equal(contarVerificadas(referencias), 2);
  });

  it('sin referencias, ninguna', () => {
    assert.equal(contarVerificadas([]), 0);
  });

  it('con algo que no es una lista, ninguna: no se rompe ni supone', () => {
    for (const nada of [null, undefined, 'verificada', 42, {}]) {
      assert.equal(contarVerificadas(nada), 0);
    }
  });
});

describe('cómo está la persona respecto de lo que su Prestadora espera', () => {
  const dos = [{ resultado: 'verificada' }, { resultado: 'verificada' }];

  it('con el mínimo alcanzado, alcanza y no falta ninguna', () => {
    const estado = estadoDeLasReferencias(dos, 2);
    assert.equal(estado.verificadas, 2);
    assert.equal(estado.exigidas, 2);
    assert.equal(estado.faltan, 0);
    assert.equal(estado.alcanza, true);
    assert.equal(estado.seExigenReferencias, true);
  });

  it('con una sola verificada de dos exigidas, falta una', () => {
    const estado = estadoDeLasReferencias([{ resultado: 'verificada' }, { resultado: 'no_responde' }], 2);
    assert.equal(estado.faltan, 1);
    assert.equal(estado.alcanza, false);
  });

  it('con más verificadas que las exigidas, no faltan negativas', () => {
    const estado = estadoDeLasReferencias(dos, 1);
    assert.equal(estado.faltan, 0);
    assert.equal(estado.alcanza, true);
  });

  it('sin mínimo configurado no se exige ninguna, y entonces no hay nada que avisar', () => {
    const estado = estadoDeLasReferencias([], 0);
    assert.equal(estado.exigidas, 0);
    assert.equal(estado.seExigenReferencias, false);
    assert.equal(estado.alcanza, true);
    assert.equal(estado.faltan, 0);
  });

  it('un mínimo que no se pudo resolver se trata como ninguno, no como uno inventado', () => {
    for (const nada of [null, undefined, NaN, '2', -3, 2.5]) {
      const estado = estadoDeLasReferencias([], nada);
      assert.equal(estado.exigidas, 0);
      assert.equal(estado.seExigenReferencias, false);
    }
  });

  it('con el mínimo puesto y ninguna verificada, falta el mínimo entero', () => {
    const estado = estadoDeLasReferencias([{ resultado: 'pendiente' }], 3);
    assert.equal(estado.verificadas, 0);
    assert.equal(estado.faltan, 3);
    assert.equal(estado.alcanza, false);
  });
});
