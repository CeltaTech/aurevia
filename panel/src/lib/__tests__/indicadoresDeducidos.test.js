import { describe, expect, it } from 'vitest';
import { deducirIndicadores, indicadoresParaElPuntaje } from '../indicadoresDeducidos';
import { resolverEscalasVigentes } from '../escalasLegales';

const HOY = '2026-09-15';

const UMBRALES = [
  { tipo: 'umbral_riesgo_dependencia', categoria: 'antiguedad_vinculo', valor: 12, vigencia_desde: '2026-01-01', vigencia_hasta: null },
  { tipo: 'umbral_riesgo_dependencia', categoria: 'horas_semanales_promedio', valor: 30, vigencia_desde: '2026-01-01', vigencia_hasta: null },
];

const escalas = resolverEscalasVigentes(UMBRALES, HOY);
const sinUmbrales = resolverEscalasVigentes([], HOY);

// Datos inventados: una persona que entró hace justo dos años, hace jornada completa y trabaja
// en una sola zona. Los tres indicios, plenos.
const ASISTENTE = {
  fecha_alta: '2024-09-15',
  horas_semanales: '40',
  zonas: ['Zona Norte'],
};

describe('deducirIndicadores', () => {
  it('deduce los tres indicadores que salen de la ficha', () => {
    const { valores, sinDeducir } = deducirIndicadores(ASISTENTE, escalas, HOY);
    expect(Object.keys(valores).sort()).toEqual(['antiguedad_vinculo', 'exclusividad_zona', 'horas_semanales_promedio']);
    expect(sinDeducir).toEqual([]);
  });

  it('un vínculo más largo que el umbral no pasa de indicio pleno', () => {
    const { valores } = deducirIndicadores(ASISTENTE, escalas, HOY);
    expect(valores.antiguedad_vinculo.valor).toBe(1);
    expect(valores.antiguedad_vinculo.dato).toBe(24);
  });

  it('media antigüedad es medio indicio, no cero', () => {
    const { valores } = deducirIndicadores({ ...ASISTENTE, fecha_alta: '2026-03-15' }, escalas, HOY);
    expect(valores.antiguedad_vinculo.dato).toBe(6);
    expect(valores.antiguedad_vinculo.valor).toBeCloseTo(0.5);
  });

  it('el día del mes no adelanta un mes de antigüedad', () => {
    // Entró el 20: al 15 del mes siguiente todavía no cumplió el mes.
    const { valores } = deducirIndicadores({ ...ASISTENTE, fecha_alta: '2026-08-20' }, escalas, HOY);
    expect(valores.antiguedad_vinculo.dato).toBe(0);
  });

  it('las horas semanales se miden contra el umbral vigente', () => {
    const { valores } = deducirIndicadores({ ...ASISTENTE, horas_semanales: '15' }, escalas, HOY);
    expect(valores.horas_semanales_promedio.valor).toBeCloseTo(0.5);
    expect(valores.horas_semanales_promedio.umbral).toBe(30);
  });

  it('una sola zona asignada es el indicio; varias, no', () => {
    const una = deducirIndicadores(ASISTENTE, escalas, HOY);
    expect(una.valores.exclusividad_zona.valor).toBe(1);
    const varias = deducirIndicadores({ ...ASISTENTE, zonas: ['Norte', 'Sur'] }, escalas, HOY);
    expect(varias.valores.exclusividad_zona.valor).toBe(0);
  });

  it('sin el dato en la ficha el indicador no se deduce: se avisa', () => {
    const { valores, sinDeducir } = deducirIndicadores({ fecha_alta: null, horas_semanales: null, zonas: [] }, escalas, HOY);
    expect(valores).toEqual({});
    expect(sinDeducir.map((s) => s.motivo)).toEqual(['sin_dato', 'sin_dato', 'sin_dato']);
  });

  it('sin el umbral vigente el indicador no se deduce ni se inventa un valor', () => {
    const { valores, sinDeducir } = deducirIndicadores(ASISTENTE, sinUmbrales, HOY);
    expect(valores.antiguedad_vinculo).toBeUndefined();
    expect(valores.horas_semanales_promedio).toBeUndefined();
    expect(sinDeducir.map((s) => s.motivo)).toEqual(['sin_umbral', 'sin_umbral']);
    // La zona no lleva umbral, así que se sigue deduciendo igual.
    expect(valores.exclusividad_zona.valor).toBe(1);
  });
});

describe('indicadoresParaElPuntaje', () => {
  it('lo deducido pisa lo tildado a mano, porque la ficha es la verdad', () => {
    const { valores } = deducirIndicadores({ ...ASISTENTE, zonas: ['Norte', 'Sur'] }, escalas, HOY);
    const listos = indicadoresParaElPuntaje({ exclusividad_zona: 1, supervision_directa: 1 }, valores);
    expect(listos.exclusividad_zona).toBe(0);
  });

  it('lo que no se deduce queda como esté cargado a mano', () => {
    const { valores } = deducirIndicadores(ASISTENTE, escalas, HOY);
    const listos = indicadoresParaElPuntaje({ supervision_directa: 1, herramientas_provistas: 0 }, valores);
    expect(listos.supervision_directa).toBe(1);
    expect(listos.herramientas_provistas).toBe(0);
  });
});
