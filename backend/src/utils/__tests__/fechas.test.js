import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { esFechaISO, semanaQueContiene, sumarDias } from '../fechas.js';

describe('esFechaISO', () => {
  it('una fecha bien escrita', () => {
    assert.equal(esFechaISO('2026-08-20'), true);
  });

  it('un día que no existe se rechaza aunque tenga la forma correcta', () => {
    // Febrero no tiene 31. Si esto pasara, la consulta saldría con una fecha inventada
    // y la Familia vería una semana vacía sin entender por qué.
    assert.equal(esFechaISO('2026-02-31'), false);
  });

  it('el 29 de febrero de un año bisiesto sí existe', () => {
    assert.equal(esFechaISO('2028-02-29'), true);
  });

  it('lo que no es una fecha', () => {
    assert.equal(esFechaISO('20-08-2026'), false);
    assert.equal(esFechaISO('2026-8-20'), false);
    assert.equal(esFechaISO(''), false);
    assert.equal(esFechaISO(null), false);
    assert.equal(esFechaISO(20260820), false);
  });
});

describe('sumarDias', () => {
  it('suma dentro del mismo mes', () => {
    assert.equal(sumarDias('2026-08-20', 3), '2026-08-23');
  });

  it('resta y cambia de mes', () => {
    assert.equal(sumarDias('2026-08-02', -5), '2026-07-28');
  });

  it('cruza el fin de año', () => {
    assert.equal(sumarDias('2026-12-31', 1), '2027-01-01');
  });

  it('un año bisiesto', () => {
    assert.equal(sumarDias('2028-02-28', 1), '2028-02-29');
  });

  it('cero días devuelve el mismo día', () => {
    assert.equal(sumarDias('2026-08-20', 0), '2026-08-20');
  });
});

describe('semanaQueContiene', () => {
  it('un jueves cae en la semana que va de lunes a domingo', () => {
    // 2026-08-20 es jueves.
    const semana = semanaQueContiene('2026-08-20');
    assert.equal(semana.desde, '2026-08-17');
    assert.equal(semana.hasta, '2026-08-23');
  });

  it('el lunes es el primer día de su propia semana', () => {
    const semana = semanaQueContiene('2026-08-17');
    assert.equal(semana.desde, '2026-08-17');
  });

  it('el domingo cierra la semana que empezó el lunes anterior', () => {
    // Es el caso que se rompe cuando alguien cuenta la semana empezando en domingo:
    // el domingo se iría a la semana siguiente y la Familia perdería un día de guardias.
    const semana = semanaQueContiene('2026-08-23');
    assert.equal(semana.desde, '2026-08-17');
    assert.equal(semana.hasta, '2026-08-23');
  });

  it('devuelve los siete días escritos y en orden', () => {
    const semana = semanaQueContiene('2026-08-20');
    assert.deepEqual(semana.dias, [
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-22',
      '2026-08-23',
    ]);
  });

  it('los días para moverse a la semana de al lado', () => {
    const semana = semanaQueContiene('2026-08-20');
    assert.equal(semana.semanaAnterior, '2026-08-10');
    assert.equal(semana.semanaSiguiente, '2026-08-24');
  });

  it('moverse hacia atrás y volver deja la misma semana', () => {
    // Es lo que hace la Familia cuando toca un botón y después el otro.
    const semana = semanaQueContiene('2026-08-20');
    const anterior = semanaQueContiene(semana.semanaAnterior);
    const devuelta = semanaQueContiene(anterior.semanaSiguiente);
    assert.equal(devuelta.desde, semana.desde);
    assert.equal(devuelta.hasta, semana.hasta);
  });

  it('una semana que cruza el cambio de mes', () => {
    // 2026-09-01 es martes.
    const semana = semanaQueContiene('2026-09-01');
    assert.equal(semana.desde, '2026-08-31');
    assert.equal(semana.hasta, '2026-09-06');
  });
});
