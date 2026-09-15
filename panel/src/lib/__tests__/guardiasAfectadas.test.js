import { describe, expect, it } from 'vitest';
import { guardiasAfectadas, guardiasSinCubrir } from '../guardiasAfectadas';

// Una licencia de una semana.
const AUSENCIA = { fecha_inicio: '2026-08-10', fecha_fin: '2026-08-16' };

const PROGRAMADA = { id: 'g', estado: 'programada', fecha: '2026-08-12' };

describe('guardiasAfectadas', () => {
  it('toma la guardia programada que cae adentro del rango', () => {
    expect(guardiasAfectadas([PROGRAMADA], AUSENCIA)).toEqual(['g']);
  });

  it('cuenta los dos días de las puntas, que son días de ausencia como cualquier otro', () => {
    const lista = [
      { ...PROGRAMADA, id: 'primer_dia', fecha: '2026-08-10' },
      { ...PROGRAMADA, id: 'ultimo_dia', fecha: '2026-08-16' },
    ];
    expect(guardiasAfectadas(lista, AUSENCIA)).toEqual(['primer_dia', 'ultimo_dia']);
  });

  it('deja afuera la del día anterior y la del día siguiente', () => {
    const lista = [
      { ...PROGRAMADA, id: 'antes', fecha: '2026-08-09' },
      { ...PROGRAMADA, id: 'despues', fecha: '2026-08-17' },
    ];
    expect(guardiasAfectadas(lista, AUSENCIA)).toEqual([]);
  });

  it('toma también la que está corriendo y la pausada: las dos se van a prestar', () => {
    const lista = [
      { ...PROGRAMADA, id: 'activa', estado: 'activa' },
      { ...PROGRAMADA, id: 'pausada', estado: 'pausada' },
    ];
    expect(guardiasAfectadas(lista, AUSENCIA)).toEqual(['activa', 'pausada']);
  });

  it('deja afuera la completada, la cancelada y la marcada como ausente: no hay nada que cubrir', () => {
    for (const estado of ['completada', 'cancelada', 'ausente']) {
      expect(guardiasAfectadas([{ ...PROGRAMADA, estado }], AUSENCIA)).toEqual([]);
    }
  });

  it('sin fecha de fin alcanza todo lo que venga después del inicio', () => {
    const abierta = { fecha_inicio: '2026-08-10', fecha_fin: null };
    const lista = [
      { ...PROGRAMADA, id: 'antes', fecha: '2026-08-09' },
      { ...PROGRAMADA, id: 'el_mismo_dia', fecha: '2026-08-10' },
      { ...PROGRAMADA, id: 'mucho_despues', fecha: '2027-01-30' },
    ];
    expect(guardiasAfectadas(lista, abierta)).toEqual(['el_mismo_dia', 'mucho_despues']);
  });

  it('sin fecha de inicio no afecta a nada: todavía no se sabe desde cuándo', () => {
    expect(guardiasAfectadas([PROGRAMADA], { fecha_inicio: '', fecha_fin: '2026-08-16' })).toEqual([]);
    expect(guardiasAfectadas([PROGRAMADA], {})).toEqual([]);
    expect(guardiasAfectadas([PROGRAMADA], null)).toEqual([]);
  });

  it('no se rompe sin lista ni con una guardia sin fecha', () => {
    expect(guardiasAfectadas(null, AUSENCIA)).toEqual([]);
    expect(guardiasAfectadas(undefined, AUSENCIA)).toEqual([]);
    expect(guardiasAfectadas([{ ...PROGRAMADA, fecha: null }], AUSENCIA)).toEqual([]);
    expect(guardiasAfectadas([null, undefined], AUSENCIA)).toEqual([]);
  });
});

describe('guardiasSinCubrir', () => {
  it('saca las que ya tienen sustituto y deja las demás en su orden', () => {
    const coberturas = [{ guardia_original_id: 'b' }];
    expect(guardiasSinCubrir(['a', 'b', 'c'], coberturas)).toEqual(['a', 'c']);
  });

  it('con todas cubiertas no queda ninguna', () => {
    const coberturas = [{ guardia_original_id: 'a' }, { guardia_original_id: 'b' }];
    expect(guardiasSinCubrir(['a', 'b'], coberturas)).toEqual([]);
  });

  it('sin ninguna cobertura quedan todas', () => {
    expect(guardiasSinCubrir(['a', 'b'], [])).toEqual(['a', 'b']);
    expect(guardiasSinCubrir(['a', 'b'], null)).toEqual(['a', 'b']);
  });

  it('una cobertura vieja, sin guardia, no tapa ninguna', () => {
    expect(guardiasSinCubrir(['a'], [{ guardia_original_id: null }])).toEqual(['a']);
    expect(guardiasSinCubrir(['a'], [{}])).toEqual(['a']);
  });

  it('sin guardias afectadas no hay nada que cubrir', () => {
    expect(guardiasSinCubrir([], [{ guardia_original_id: 'a' }])).toEqual([]);
    expect(guardiasSinCubrir(null, [])).toEqual([]);
  });
});
