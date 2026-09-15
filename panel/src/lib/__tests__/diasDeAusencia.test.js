import { describe, expect, it } from 'vitest';
import { diasComputados } from '../diasDeAusencia';

describe('diasComputados', () => {
  it('cuenta las dos puntas: una semana del 10 al 16 son siete días', () => {
    expect(diasComputados({ fecha_inicio: '2026-08-10', fecha_fin: '2026-08-16' })).toBe(7);
  });

  it('quien falta un solo día falta un día, no cero', () => {
    expect(diasComputados({ fecha_inicio: '2026-08-10', fecha_fin: '2026-08-10' })).toBe(1);
  });

  it('cruza el fin de mes y el cambio de año sin perder ni sumar días', () => {
    expect(diasComputados({ fecha_inicio: '2026-01-30', fecha_fin: '2026-02-02' })).toBe(4);
    expect(diasComputados({ fecha_inicio: '2026-12-30', fecha_fin: '2027-01-02' })).toBe(4);
  });

  it('cuenta el 29 de febrero de un año bisiesto', () => {
    expect(diasComputados({ fecha_inicio: '2028-02-28', fecha_fin: '2028-03-01' })).toBe(3);
  });

  it('no se mueve con el cambio de horario de verano, que acorta un día a 23 horas', () => {
    expect(diasComputados({ fecha_inicio: '2026-03-07', fecha_fin: '2026-03-10' })).toBe(4);
    expect(diasComputados({ fecha_inicio: '2026-10-31', fecha_fin: '2026-11-03' })).toBe(4);
  });

  it('la ausencia que todavía corre no da cero: da que no se sabe', () => {
    expect(diasComputados({ fecha_inicio: '2026-08-10', fecha_fin: null })).toBeNull();
    expect(diasComputados({ fecha_inicio: '2026-08-10' })).toBeNull();
  });

  it('sin fechas, o con un fin anterior al inicio, no contesta ningún número', () => {
    expect(diasComputados({ fecha_fin: '2026-08-16' })).toBeNull();
    expect(diasComputados({})).toBeNull();
    expect(diasComputados(null)).toBeNull();
    expect(diasComputados({ fecha_inicio: '2026-08-16', fecha_fin: '2026-08-10' })).toBeNull();
    expect(diasComputados({ fecha_inicio: 'cualquier cosa', fecha_fin: '2026-08-10' })).toBeNull();
  });
});
