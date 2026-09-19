// La hora del hecho, que la pone el teléfono, contra la hora en que el dato llegó a la base.
// Se prueba rompiéndola a propósito: un reloj adelantado, un texto que no es una fecha y un
// valor ausente no pueden escribir nada en la columna del hecho.

import test from 'node:test';
import assert from 'node:assert/strict';
import { horaDelHecho } from '../horaDelHecho.js';

const AHORA = Date.parse('2026-09-19T12:00:00.000Z');

test('la hora del teléfono se respeta cuando está hacia atrás', () => {
  // El caso que esta función existe para no perder: el aviso que estuvo media hora esperando
  // señal. Lo que se guarda es cuándo pasó, no cuándo llegó.
  const haceMediaHora = '2026-09-19T11:30:00.000Z';
  assert.equal(horaDelHecho(haceMediaHora, AHORA), haceMediaHora);
});

test('un reloj adelantado no escribe nada: queda la hora del motor', () => {
  const dentroDeUnaHora = '2026-09-19T13:00:00.000Z';
  assert.equal(horaDelHecho(dentroDeUnaHora, AHORA), new Date(AHORA).toISOString());
});

test('lo que no es una fecha tampoco decide nada', () => {
  for (const basura of ['el martes', '', '   ', 'null', '2026-13-45T99:99:99Z']) {
    assert.equal(horaDelHecho(basura, AHORA), new Date(AHORA).toISOString(), `con ${JSON.stringify(basura)}`);
  }
});

test('sin hora del teléfono queda la del motor', () => {
  assert.equal(horaDelHecho(undefined, AHORA), new Date(AHORA).toISOString());
  assert.equal(horaDelHecho(null, AHORA), new Date(AHORA).toISOString());
});

test('la hora exacta del motor se acepta: no está adelantada', () => {
  assert.equal(horaDelHecho(new Date(AHORA).toISOString(), AHORA), new Date(AHORA).toISOString());
});

test('lo que devuelve es siempre un momento leíble por la base', () => {
  const resultado = horaDelHecho('2026-01-01T00:00:00.000Z', AHORA);
  assert.equal(Number.isNaN(Date.parse(resultado)), false);
  assert.equal(resultado, new Date(resultado).toISOString());
});
