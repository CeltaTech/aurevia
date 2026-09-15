import { describe, it, expect } from 'vitest';
import { totalesDePostulaciones } from '../totalesDePostulaciones';

// Con el sistema roto —contando sobre las filas que quedaron después de los filtros— la prueba de
// que el total no depende del filtro daría otro número.

const ESTADOS = ['pendiente', 'en_revision', 'aprobado', 'rechazado'];

describe('cuántas postulaciones hay y en qué situación', () => {
  it('cuenta el total y cada situación por separado', () => {
    const { total, porEstado } = totalesDePostulaciones(
      [
        { estado: 'pendiente' },
        { estado: 'pendiente' },
        { estado: 'en_revision' },
        { estado: 'aprobado' },
        { estado: 'rechazado' },
        { estado: 'rechazado' },
      ],
      ESTADOS,
    );
    expect(total).toBe(6);
    expect(porEstado).toEqual({ pendiente: 2, en_revision: 1, aprobado: 1, rechazado: 2 });
  });

  it('una situación sin ninguna postulación aparece en cero, y no ausente', () => {
    const { porEstado } = totalesDePostulaciones([{ estado: 'pendiente' }], ESTADOS);
    expect(porEstado.aprobado).toBe(0);
    expect(Object.keys(porEstado)).toEqual(ESTADOS);
  });

  it('una situación que no se pidió se cuenta en el total y en ninguna otra parte', () => {
    const { total, porEstado } = totalesDePostulaciones(
      [{ estado: 'pendiente' }, { estado: 'archivada' }, { estado: null }, {}],
      ESTADOS,
    );
    expect(total).toBe(4);
    expect(porEstado.pendiente).toBe(1);
    expect(Object.values(porEstado).reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('un estado que se llama como algo del prototipo no suma en ningún casillero', () => {
    const { total, porEstado } = totalesDePostulaciones(
      [{ estado: 'constructor' }, { estado: 'toString' }],
      ESTADOS,
    );
    expect(total).toBe(2);
    expect(Object.values(porEstado).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('sin postulaciones da todo en cero', () => {
    const { total, porEstado } = totalesDePostulaciones([], ESTADOS);
    expect(total).toBe(0);
    expect(porEstado).toEqual({ pendiente: 0, en_revision: 0, aprobado: 0, rechazado: 0 });
  });

  it('con algo que no es una lista no se rompe ni supone', () => {
    for (const nada of [null, undefined, 'pendiente', 42, {}]) {
      const { total, porEstado } = totalesDePostulaciones(nada, ESTADOS);
      expect(total).toBe(0);
      expect(porEstado.pendiente).toBe(0);
    }
    expect(totalesDePostulaciones([{ estado: 'pendiente' }], null)).toEqual({
      total: 1,
      porEstado: {},
    });
  });
});
