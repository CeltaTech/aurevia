import { describe, it, expect } from 'vitest';
import { avanceDeIncorporacion } from '../avanceDeIncorporacion';

// El catálogo de etapas lo arma cada Prestadora, así que el total sale de ahí y nunca de un
// número escrito. Con el sistema roto —contando las filas guardadas en vez del catálogo— las dos
// pruebas de la etapa sacada y la etapa agregada dan al revés.

const catalogo = [
  { clave: 'postulacion', nombre: 'Postulación' },
  { clave: 'identidad', nombre: 'Identidad' },
  { clave: 'antecedentes', nombre: 'Antecedentes' },
  { clave: 'entrevista', nombre: 'Entrevista' },
];

describe('cuánto le falta a un aspirante', () => {
  it('cuenta las aprobadas sobre el total del catálogo', () => {
    const avance = avanceDeIncorporacion(catalogo, [
      { etapa: 'postulacion', estado: 'aprobada' },
      { etapa: 'identidad', estado: 'aprobada' },
      { etapa: 'antecedentes', estado: 'pendiente' },
      { etapa: 'entrevista', estado: 'pendiente' },
    ]);
    expect(avance.total).toBe(4);
    expect(avance.aprobadas).toBe(2);
    expect(avance.pendientes).toBe(2);
    expect(avance.porcentaje).toBe(50);
    expect(avance.completo).toBe(false);
  });

  it('una etapa rechazada no suma avance, y se dice cuántas hay', () => {
    const avance = avanceDeIncorporacion(catalogo, [
      { etapa: 'postulacion', estado: 'aprobada' },
      { etapa: 'identidad', estado: 'rechazada' },
      { etapa: 'antecedentes', estado: 'pendiente' },
      { etapa: 'entrevista', estado: 'pendiente' },
    ]);
    expect(avance.aprobadas).toBe(1);
    expect(avance.rechazadas).toBe(1);
    expect(avance.pendientes).toBe(2);
    expect(avance.porcentaje).toBe(25);
  });

  it('con todas aprobadas, el proceso está completo', () => {
    const avance = avanceDeIncorporacion(
      catalogo,
      catalogo.map((etapa) => ({ etapa: etapa.clave, estado: 'aprobada' })),
    );
    expect(avance.porcentaje).toBe(100);
    expect(avance.completo).toBe(true);
    expect(avance.pendientes).toBe(0);
  });

  it('una etapa que la Prestadora sacó del catálogo deja de contar, aunque su fila siga ahí', () => {
    const avance = avanceDeIncorporacion(catalogo.slice(0, 2), [
      { etapa: 'postulacion', estado: 'aprobada' },
      { etapa: 'identidad', estado: 'aprobada' },
      { etapa: 'capacitacion_vieja', estado: 'aprobada' },
    ]);
    expect(avance.total).toBe(2);
    expect(avance.aprobadas).toBe(2);
    expect(avance.porcentaje).toBe(100);
  });

  it('una etapa agregada después cuenta como pendiente, aunque todavía no tenga fila', () => {
    const avance = avanceDeIncorporacion(catalogo, [
      { etapa: 'postulacion', estado: 'aprobada' },
    ]);
    expect(avance.total).toBe(4);
    expect(avance.aprobadas).toBe(1);
    expect(avance.pendientes).toBe(3);
    expect(avance.porcentaje).toBe(25);
  });

  it('el porcentaje se redondea, y no queda un número con coma en la pantalla', () => {
    const tres = catalogo.slice(0, 3);
    const avance = avanceDeIncorporacion(tres, [{ etapa: 'postulacion', estado: 'aprobada' }]);
    expect(avance.porcentaje).toBe(33);
  });

  it('sin etapas configuradas no hay proceso que contar', () => {
    const avance = avanceDeIncorporacion([], []);
    expect(avance.total).toBe(0);
    expect(avance.porcentaje).toBe(0);
    expect(avance.hayEtapas).toBe(false);
    expect(avance.completo).toBe(false);
  });

  it('con algo que no es una lista no se rompe ni supone', () => {
    for (const nada of [null, undefined, 'postulacion', 42, {}]) {
      const avance = avanceDeIncorporacion(nada, nada);
      expect(avance.total).toBe(0);
      expect(avance.porcentaje).toBe(0);
      expect(avance.hayEtapas).toBe(false);
    }
  });
});
