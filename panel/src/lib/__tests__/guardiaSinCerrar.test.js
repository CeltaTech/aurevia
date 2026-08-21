import { describe, expect, it } from 'vitest';
import { guardiasSinCerrar, quedoSinCerrar } from '../guardiaSinCerrar';

const HOY = '2026-08-21';

// Una guardia de ayer que el Asistente dejó abierta: el caso que la pantalla tiene que encontrar.
const OLVIDADA = { id: 'a', estado: 'activa', checkout_at: null, fecha: '2026-08-20', hora_inicio: '08:00' };

describe('quedoSinCerrar', () => {
  it('encuentra la guardia de un día anterior que sigue en curso y sin salida marcada', () => {
    expect(quedoSinCerrar(OLVIDADA, HOY)).toBe(true);
  });

  it('no toca la guardia de hoy, aunque su horario ya haya terminado', () => {
    expect(quedoSinCerrar({ ...OLVIDADA, fecha: HOY }, HOY)).toBe(false);
  });

  it('no toca la guardia de mañana', () => {
    expect(quedoSinCerrar({ ...OLVIDADA, fecha: '2026-08-22' }, HOY)).toBe(false);
  });

  it('deja afuera la que ya tiene marcada la hora de salida', () => {
    expect(quedoSinCerrar({ ...OLVIDADA, checkout_at: '2026-08-20T20:00:00Z' }, HOY)).toBe(false);
  });

  it('deja afuera la que ya está cerrada, cancelada, ausente o todavía no empezó', () => {
    for (const estado of ['completada', 'cancelada', 'ausente', 'programada', 'pausada']) {
      expect(quedoSinCerrar({ ...OLVIDADA, estado }, HOY)).toBe(false);
    }
  });

  it('no se rompe con una guardia vacía ni con una sin fecha', () => {
    expect(quedoSinCerrar(null, HOY)).toBe(false);
    expect(quedoSinCerrar(undefined, HOY)).toBe(false);
    expect(quedoSinCerrar({ ...OLVIDADA, fecha: null }, HOY)).toBe(false);
  });
});

describe('guardiasSinCerrar', () => {
  it('devuelve solo las olvidadas, de la más vieja a la más nueva', () => {
    const lista = [
      { ...OLVIDADA, id: 'reciente', fecha: '2026-08-20' },
      { ...OLVIDADA, id: 'cerrada', checkout_at: '2026-08-01T20:00:00Z' },
      { ...OLVIDADA, id: 'vieja', fecha: '2026-07-02' },
      { ...OLVIDADA, id: 'de_hoy', fecha: HOY },
      { ...OLVIDADA, id: 'del_medio', fecha: '2026-08-01' },
    ];
    expect(guardiasSinCerrar(lista, HOY).map((g) => g.id)).toEqual(['vieja', 'del_medio', 'reciente']);
  });

  it('ante el mismo día, primero la que empezaba más temprano', () => {
    const lista = [
      { ...OLVIDADA, id: 'tarde', hora_inicio: '20:00' },
      { ...OLVIDADA, id: 'temprano', hora_inicio: '06:00' },
    ];
    expect(guardiasSinCerrar(lista, HOY).map((g) => g.id)).toEqual(['temprano', 'tarde']);
  });

  it('no se rompe sin lista y no modifica la que recibe', () => {
    expect(guardiasSinCerrar(null, HOY)).toEqual([]);
    expect(guardiasSinCerrar(undefined, HOY)).toEqual([]);

    const lista = [
      { ...OLVIDADA, id: 'segunda', fecha: '2026-08-20' },
      { ...OLVIDADA, id: 'primera', fecha: '2026-07-02' },
    ];
    guardiasSinCerrar(lista, HOY);
    expect(lista.map((g) => g.id)).toEqual(['segunda', 'primera']);
  });
});
