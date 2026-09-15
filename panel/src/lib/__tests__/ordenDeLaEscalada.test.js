import { describe, expect, it } from 'vitest';
import { ordenDeLaEscalada } from '../ordenDeLaEscalada';

const claves = (config) => ordenDeLaEscalada(config).map((e) => e.clave);

const COMPLETA = {
  coordinadorBackupId: 'c-1',
  minutosAntesBackup: 15,
  faseAutomaticaActiva: true,
  minutosAntesFaseAutomatica: 120,
};

describe('ordenDeLaEscalada', () => {
  it('con todo encendido, el orden lo deciden los minutos', () => {
    expect(claves(COMPLETA)).toEqual(['insistencia', 'respaldo', 'fase_automatica']);
  });

  it('y se da vuelta si la Prestadora sale a buscar antes de pasar al respaldo', () => {
    expect(claves({ ...COMPLETA, minutosAntesFaseAutomatica: 10 }))
      .toEqual(['insistencia', 'fase_automatica', 'respaldo']);
  });

  it('sin respaldo elegido, ese escalón no existe', () => {
    expect(claves({ ...COMPLETA, coordinadorBackupId: null })).toEqual(['insistencia', 'fase_automatica']);
  });

  it('sin la fase automática activada, el sistema no sale a buscar nada', () => {
    expect(claves({ ...COMPLETA, faseAutomaticaActiva: false })).toEqual(['insistencia', 'respaldo']);
  });

  it('la insistencia siempre está, y siempre desde el minuto cero', () => {
    expect(ordenDeLaEscalada({})).toEqual([{ clave: 'insistencia', minuto: 0 }]);
  });

  it('dos escalones en el mismo minuto salen los dos, en el orden en que los corre el motor', () => {
    expect(claves({ ...COMPLETA, minutosAntesFaseAutomatica: 15 }))
      .toEqual(['insistencia', 'respaldo', 'fase_automatica']);
  });

  it('un minuto que todavía no es un número queda al final, porque no se sabe cuándo pasa', () => {
    // Pasa mientras alguien está borrando el campo para escribir otro valor.
    expect(claves({ ...COMPLETA, minutosAntesBackup: '' })).toEqual(['insistencia', 'fase_automatica', 'respaldo']);
  });

  it('el minuto que se muestra es el que se cargó', () => {
    expect(ordenDeLaEscalada(COMPLETA)).toEqual([
      { clave: 'insistencia', minuto: 0 },
      { clave: 'respaldo', minuto: 15 },
      { clave: 'fase_automatica', minuto: 120 },
    ]);
  });
});
