/**
 * Pruebas de las horas de una guardia.
 *
 * Usan el banco de pruebas que ya trae Node adentro (`node --test`), sin instalar nada:
 * lo que se prueba acá son cuentas puras, no hace falta arrancar el servidor ni la base.
 *
 *   npm test --prefix backend
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { horasEntre, horasImputadasAlPaciente } from '../horasDeGuardia.js';

describe('horasEntre', () => {
  it('un turno de la mañana', () => {
    assert.equal(horasEntre('08:00', '16:00'), 8);
  });

  it('cuenta los minutos, no solo las horas enteras', () => {
    assert.equal(horasEntre('08:00', '10:30'), 2.5);
  });

  it('un turno que cruza la medianoche no da negativo', () => {
    assert.equal(horasEntre('22:00', '06:00'), 8);
  });

  it('acepta el formato con segundos que devuelve la base', () => {
    assert.equal(horasEntre('08:00:00', '16:00:00'), 8);
  });

  // Ésta es la cuenta que decide cuánto se le paga a la Asistente. Las guardias de 24, 48 y 72
  // horas que cubre una sola persona son parte del rubro, y comparar dos horas de reloj no puede
  // pasar de un día: sin la duración escrita, una guardia de tres días se liquidaba como una de
  // uno y a la Asistente se le pagaba un tercio de lo que trabajó.
  it('una guardia de 24 horas dura 24', () => {
    assert.equal(horasEntre('08:00', '08:00', 1), 24);
  });

  it('una de 48 dura 48', () => {
    assert.equal(horasEntre('08:00', '08:00', 2), 48);
  });

  it('una de 72 dura 72', () => {
    assert.equal(horasEntre('08:00', '08:00', 3), 72);
  });

  // Un turno largo no tiene por qué empezar y terminar a la misma hora.
  it('cuenta bien un turno largo que no cierra en redondo', () => {
    assert.equal(horasEntre('08:00', '20:00', 2), 60);
  });

  // Los turnos cargados antes de que la duración existiera no cambian de valor.
  it('sin duración escrita, la cuenta de siempre no cambia', () => {
    assert.equal(horasEntre('22:00', '06:00'), 8);
    assert.equal(horasEntre('08:00', '16:00'), 8);
  });

  it('la guardia de veinticuatro horas vale veinticuatro, no cero', () => {
    // Misma hora de entrada y de salida es el turno de un día entero, que en este rubro
    // es de los más comunes. Antes daba cero, y una guardia de cero horas se pagaba sola.
    assert.equal(horasEntre('08:00', '08:00'), 24);
    assert.equal(horasEntre('00:00:00', '00:00:00'), 24);
  });
});

describe('horasImputadasAlPaciente', () => {
  it('un turno para una sola persona se le imputa entero', () => {
    assert.equal(horasImputadasAlPaciente(8, 1), 8);
  });

  it('el caso del domicilio compartido: ocho horas y dos Pacientes son cuatro y cuatro', () => {
    assert.equal(horasImputadasAlPaciente(8, 2), 4);
  });

  it('lo que se imputa a todos junto nunca supera lo que se trabajó', () => {
    // Esta es la regla de fondo: si esto fallara, la obra social estaría pagando horas
    // que nadie trabajó.
    const trabajadas = 8;
    for (const cuantos of [1, 2, 3, 5, 20]) {
      const sumaImputada = horasImputadasAlPaciente(trabajadas, cuantos) * cuantos;
      assert.equal(sumaImputada, trabajadas);
    }
  });

  it('un número de Pacientes que no tiene sentido no infla las horas de nadie', () => {
    // Quedarse corto en la cantidad es el error peligroso: repartir entre menos gente le
    // suma horas a cada uno. Ante un dato roto se imputa el turno entero a uno solo, que es
    // lo mismo que hacía el sistema antes de que existieran los turnos compartidos.
    assert.equal(horasImputadasAlPaciente(8, 0), 8);
    assert.equal(horasImputadasAlPaciente(8, undefined), 8);
    assert.equal(horasImputadasAlPaciente(8, NaN), 8);
  });
});
