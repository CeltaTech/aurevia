/**
 * Pruebas de los tramos de insistencia al Coordinador.
 *
 * Usan el banco de pruebas que ya trae Node adentro (`node --test`), sin instalar nada:
 * lo que se prueba acá son cuentas puras, no hace falta arrancar el servidor ni la base.
 *
 *   npm test --prefix backend
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { intervaloParaPremura, validarUmbralesPremura } from '../umbralesPremura.js';

const DE_FABRICA = [
  { maximo_minutos: 60, intervalo_minutos: 10 },
  { maximo_minutos: 240, intervalo_minutos: 30 },
  { maximo_minutos: null, intervalo_minutos: 60 },
];

describe('intervaloParaPremura', () => {
  it('recién detectado, insiste cada diez minutos', () => {
    assert.equal(intervaloParaPremura(DE_FABRICA, 5), 10);
  });

  it('justo en el borde del tramo, todavía es el tramo corto', () => {
    assert.equal(intervaloParaPremura(DE_FABRICA, 60), 10);
  });

  it('pasado el borde, cae al tramo siguiente', () => {
    assert.equal(intervaloParaPremura(DE_FABRICA, 61), 30);
  });

  it('de las cuatro horas en adelante, el último tramo', () => {
    assert.equal(intervaloParaPremura(DE_FABRICA, 5000), 60);
  });

  it('sin tramos cargados, se cae al respaldo de una hora', () => {
    assert.equal(intervaloParaPremura(null, 5), 60);
    assert.equal(intervaloParaPremura([], 5), 60);
  });
});

describe('validarUmbralesPremura', () => {
  it('los tramos de fábrica están bien', () => {
    assert.equal(validarUmbralesPremura(DE_FABRICA), null);
  });

  it('un solo tramo abierto también está bien', () => {
    assert.equal(validarUmbralesPremura([{ maximo_minutos: null, intervalo_minutos: 15 }]), null);
  });

  it('una lista vacía no sirve', () => {
    assert.ok(validarUmbralesPremura([]));
    assert.ok(validarUmbralesPremura(null));
  });

  it('el último tramo tiene que quedar abierto', () => {
    const cerrado = [{ maximo_minutos: 60, intervalo_minutos: 10 }];
    assert.match(validarUmbralesPremura(cerrado), /de ahí en adelante/);
  });

  it('los tramos van de menor a mayor', () => {
    const desordenados = [
      { maximo_minutos: 240, intervalo_minutos: 30 },
      { maximo_minutos: 60, intervalo_minutos: 10 },
      { maximo_minutos: null, intervalo_minutos: 60 },
    ];
    assert.match(validarUmbralesPremura(desordenados), /de menor a mayor/);
  });

  it('no se puede avisar cada cero minutos', () => {
    const sinIntervalo = [{ maximo_minutos: null, intervalo_minutos: 0 }];
    assert.ok(validarUmbralesPremura(sinIntervalo));
  });

  it('los minutos van enteros, no con coma', () => {
    const conComa = [{ maximo_minutos: null, intervalo_minutos: 10.5 }];
    assert.ok(validarUmbralesPremura(conComa));
  });

  it('un tramo que no es un tramo', () => {
    assert.ok(validarUmbralesPremura(['diez minutos']));
  });
});
