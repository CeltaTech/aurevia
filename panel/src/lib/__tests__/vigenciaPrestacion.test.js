import { describe, expect, it } from 'vitest';

import { correElDia, lasQueCorrenElDia, periodo, situacion } from '../vigenciaPrestacion';

const DIA = '2026-06-15';

const abierta = { estado: 'vigente', vigente_desde: '2026-01-01', vigente_hasta: null };
const cerrada = { estado: 'vigente', vigente_desde: '2026-01-01', vigente_hasta: '2026-12-31' };

describe('correElDia', () => {
  it('la que está en pie y arrancó, corre', () => {
    expect(correElDia(abierta, DIA)).toBe(true);
  });

  it('la que arranca más adelante todavía no corre', () => {
    expect(correElDia({ ...abierta, vigente_desde: '2026-09-01' }, DIA)).toBe(false);
  });

  it('el día en que arranca ya corre: la fecha de arranque entra', () => {
    expect(correElDia({ ...abierta, vigente_desde: DIA }, DIA)).toBe(true);
  });

  // La razón por la que esta prueba está: si `vigente_hasta` se leyera como «el día que dejó de
  // correr» en vez de «el último día que corrió», la prestación se cobraría un día de menos, y
  // sobre un servicio mensual eso es plata de todos los meses.
  it('el último día también corre: la fecha de fin entra', () => {
    expect(correElDia({ ...cerrada, vigente_hasta: DIA }, DIA)).toBe(true);
  });

  it('al día siguiente del fin ya no corre', () => {
    expect(correElDia({ ...cerrada, vigente_hasta: '2026-06-14' }, DIA)).toBe(false);
  });

  // La prueba que hace que el archivo sirva de algo. Con las fechas en regla y el estado en
  // `de_baja`, mirar sólo las fechas diría que sí. Es justo el caso que se quiso evitar: la baja
  // corta antes de tiempo y las fechas por sí solas no se enteran.
  it('la dada de baja no corre, aunque sus fechas digan que sí', () => {
    expect(correElDia({ ...abierta, estado: 'de_baja' }, DIA)).toBe(false);
  });

  it('sin fecha de arranque contesta que no, en vez de cobrar de más', () => {
    expect(correElDia({ estado: 'vigente', vigente_desde: null }, DIA)).toBe(false);
  });

  it('aguanta que no haya llegado la prestación, que es el estado «cargando»', () => {
    expect(correElDia(null, DIA)).toBe(false);
    expect(correElDia(undefined, DIA)).toBe(false);
  });
});

describe('lasQueCorrenElDia', () => {
  it('se queda con las que corren y descarta el resto', () => {
    const lista = [
      { id: 1, ...abierta },
      { id: 2, ...abierta, estado: 'de_baja', vigente_hasta: '2026-05-01' },
      { id: 3, ...abierta, vigente_desde: '2026-11-01' },
      { id: 4, ...cerrada, vigente_hasta: '2026-06-14' },
    ];
    expect(lasQueCorrenElDia(lista, DIA).map((p) => p.id)).toEqual([1]);
  });

  it('aguanta que la lista todavía no haya llegado', () => {
    expect(lasQueCorrenElDia(null, DIA)).toEqual([]);
    expect(lasQueCorrenElDia(undefined, DIA)).toEqual([]);
  });
});

describe('situacion', () => {
  it('distingue las cuatro', () => {
    expect(situacion(abierta, DIA)).toBe('corriendo');
    expect(situacion({ ...abierta, vigente_desde: '2026-11-01' }, DIA)).toBe('por_empezar');
    expect(situacion({ ...cerrada, vigente_hasta: '2026-05-31' }, DIA)).toBe('terminada');
    expect(situacion({ ...abierta, estado: 'de_baja' }, DIA)).toBe('de_baja');
  });

  // Cumplir lo pactado y que se lo corten no son lo mismo, y en la ficha se leen distinto.
  it('la que llegó a su fin en pie está terminada, no dada de baja', () => {
    expect(situacion({ ...cerrada, vigente_hasta: '2026-05-31' }, DIA)).not.toBe('de_baja');
  });
});

describe('periodo', () => {
  it('devuelve las dos fechas sin darles formato', () => {
    expect(periodo(cerrada)).toEqual({ desde: '2026-01-01', hasta: '2026-12-31' });
    expect(periodo(abierta)).toEqual({ desde: '2026-01-01', hasta: null });
    expect(periodo(null)).toEqual({ desde: null, hasta: null });
  });
});
