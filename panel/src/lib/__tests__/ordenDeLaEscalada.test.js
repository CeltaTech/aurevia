import { describe, expect, it } from 'vitest';
import { ESCALONES, escalonesQueCorresponden, esEscalon, ordenDeLaEscalada } from '../ordenDeLaEscalada';

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

  it('los dos escalones de arriba se muestran donde les toca por su minuto', () => {
    expect(claves({
      ...COMPLETA,
      minutosAntesTodosLosCoordinadores: 45,
      minutosAntesAdministracion: 90,
    })).toEqual(['insistencia', 'respaldo', 'todos_los_coordinadores', 'administracion', 'fase_automatica']);
  });

  it('el campo vacío apaga ese escalón, y no lo manda al final', () => {
    expect(claves({ ...COMPLETA, minutosAntesTodosLosCoordinadores: '', minutosAntesAdministracion: null }))
      .toEqual(['insistencia', 'respaldo', 'fase_automatica']);
  });
});

const CONFIG = {
  minutos_antes_todos_los_coordinadores: 45,
  minutos_antes_administracion: 90,
};

describe('escalonesQueCorresponden', () => {
  it('antes del primer minuto no corresponde ninguno', () => {
    expect(escalonesQueCorresponden(CONFIG, 44)).toEqual([]);
  });

  it('cumplido el minuto exacto, ese escalón ya corresponde', () => {
    expect(escalonesQueCorresponden(CONFIG, 45)).toEqual([ESCALONES.TODOS_LOS_COORDINADORES]);
  });

  it('una alarma vieja alcanza los dos de una vez, primero el equipo', () => {
    // Pasa cuando el proceso de fondo estuvo caído: no se sube de a un escalón por vuelta.
    expect(escalonesQueCorresponden(CONFIG, 600))
      .toEqual([ESCALONES.TODOS_LOS_COORDINADORES, ESCALONES.ADMINISTRACION]);
  });

  it('con la administración configurada antes, sale primero la administración', () => {
    expect(escalonesQueCorresponden({ ...CONFIG, minutos_antes_administracion: 10 }, 600))
      .toEqual([ESCALONES.ADMINISTRACION, ESCALONES.TODOS_LOS_COORDINADORES]);
  });

  it('un escalón sin minuto está apagado y no aparece nunca', () => {
    expect(escalonesQueCorresponden({ minutos_antes_administracion: 90 }, 10000))
      .toEqual([ESCALONES.ADMINISTRACION]);
  });

  it('sin configuración no corresponde nada', () => {
    expect(escalonesQueCorresponden(undefined, 10000)).toEqual([]);
    expect(escalonesQueCorresponden({}, 10000)).toEqual([]);
  });

  it('una premura que no es un número no hace subir nada', () => {
    expect(escalonesQueCorresponden(CONFIG, NaN)).toEqual([]);
    expect(escalonesQueCorresponden(CONFIG, undefined)).toEqual([]);
  });
});

describe('esEscalon', () => {
  it('reconoce los tres que el producto guarda', () => {
    expect(esEscalon('coordinador_respaldo')).toBe(true);
    expect(esEscalon('todos_los_coordinadores')).toBe(true);
    expect(esEscalon('administracion')).toBe(true);
  });

  it('y nada más', () => {
    expect(esEscalon('insistencia')).toBe(false);
    expect(esEscalon(undefined)).toBe(false);
  });
});
