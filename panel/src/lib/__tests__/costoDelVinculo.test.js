import { describe, expect, it } from 'vitest';
import {
  SEMANAS_POR_MES,
  asistenteBajoVinculo,
  costoMensualDelVinculo,
  escalasPorTipoALaFecha,
} from '../costoDelVinculo';

// Datos inventados, nunca de una persona real (CLAUDE.md §6).
const ASISTENTE = {
  id: 'a1111111-1111-4111-8111-111111111111',
  tipo_vinculo: 'monotributo',
  valor_hora: '2000',
  horas_semanales: '30',
  sueldo_basico: null,
};

const COMUN = {
  escalasPorTipo: new Map(),
  moneda: 'ARS',
  jurisdiccion: 'AR',
  periodo: '2026-09',
};

// 30 h × 52/12 = 130 h por mes, a 2000 la hora.
const HORAS_MES = 30 * SEMANAS_POR_MES;
const BRUTO_MONOTRIBUTO = HORAS_MES * 2000;

describe('asistenteBajoVinculo', () => {
  it('bajo dependencia deriva el sueldo del valor hora y apaga el valor hora', () => {
    const r = asistenteBajoVinculo(ASISTENTE, 'dependencia');
    expect(r.tipo_vinculo).toBe('dependencia');
    expect(r.valor_hora).toBeNull();
    expect(r.sueldo_basico).toBeCloseTo(BRUTO_MONOTRIBUTO, 2);
  });

  it('bajo monotributo apaga el sueldo aunque la ficha lo tenga cargado', () => {
    const r = asistenteBajoVinculo({ ...ASISTENTE, sueldo_basico: '900000' }, 'monotributo');
    expect(r.sueldo_basico).toBeNull();
    expect(r.valor_hora).toBe(2000);
  });

  it('sin ningún dato de base no inventa ninguno', () => {
    const r = asistenteBajoVinculo({ ...ASISTENTE, valor_hora: null, horas_semanales: null }, 'dependencia');
    expect(r.sueldo_basico).toBeNull();
  });
});

describe('escalasPorTipoALaFecha', () => {
  it('deja las escalas por tipo y descarta las de categoría de convenio', () => {
    const resueltas = new Map([
      ['a', { tipo: 'aporte_monotributo', categoria: null, unidad: 'monto_fijo_mensual', valor: 30000 }],
      ['b', { tipo: 'sueldo_convenio', categoria: 'asistente_primera', unidad: 'monto_fijo_mensual', valor: 700000 }],
    ]);
    const porTipo = escalasPorTipoALaFecha(resueltas);
    expect([...porTipo.keys()]).toEqual(['aporte_monotributo']);
  });
});

describe('costoMensualDelVinculo', () => {
  it('sin conceptos, el costo es la remuneración del mes', () => {
    const r = costoMensualDelVinculo({
      asistenteBase: ASISTENTE, tipoVinculo: 'monotributo', conceptos: [], ...COMUN,
    });
    expect(r.faltaDato).toBe(false);
    expect(r.costo).toBeCloseTo(BRUTO_MONOTRIBUTO, 2);
    expect(r.horas).toBeCloseTo(HORAS_MES, 2);
  });

  it('suma lo que suma y no descuenta lo que resta, porque la Prestadora lo paga igual', () => {
    const conceptos = [
      { id: 'c1', nombre: 'Adicional', signo: 'suma', unidad: 'monto_fijo_mensual', origen_valor: 'propio', aplica_a: 'todos', valor: '50000' },
      { id: 'c2', nombre: 'Retención', signo: 'resta', unidad: 'monto_fijo_mensual', origen_valor: 'propio', aplica_a: 'todos', valor: '20000' },
    ];
    const r = costoMensualDelVinculo({
      asistenteBase: ASISTENTE, tipoVinculo: 'monotributo', conceptos, ...COMUN,
    });
    expect(r.sumas).toBeCloseTo(50000, 2);
    expect(r.restas).toBeCloseTo(20000, 2);
    expect(r.costo).toBeCloseTo(BRUTO_MONOTRIBUTO + 50000, 2);
  });

  it('un concepto de dependencia no entra en la columna de monotributo', () => {
    const conceptos = [
      { id: 'c1', nombre: 'Cargas sociales', signo: 'suma', unidad: 'porcentaje', origen_valor: 'propio', aplica_a: 'dependencia', valor: '25' },
    ];
    const comun = { conceptos, ...COMUN };
    const mono = costoMensualDelVinculo({ asistenteBase: ASISTENTE, tipoVinculo: 'monotributo', ...comun });
    const dep = costoMensualDelVinculo({ asistenteBase: ASISTENTE, tipoVinculo: 'dependencia', ...comun });

    expect(mono.sumas).toBe(0);
    expect(dep.sumas).toBeCloseTo(BRUTO_MONOTRIBUTO * 0.25, 2);
    expect(dep.costo).toBeGreaterThan(mono.costo);
  });

  it('un concepto de escala legal sin escala vigente sale nombrado y no se estima', () => {
    const conceptos = [
      { id: 'c1', nombre: 'Aporte de monotributo', signo: 'suma', unidad: 'monto_fijo_mensual', origen_valor: 'escala_legal', escala_tipo: 'aporte_monotributo', aplica_a: 'monotributo' },
    ];
    const r = costoMensualDelVinculo({
      asistenteBase: ASISTENTE, tipoVinculo: 'monotributo', conceptos, ...COMUN,
    });
    expect(r.sinEscala).toHaveLength(1);
    expect(r.sinEscala[0]).toContain('Aporte de monotributo');
    expect(r.sumas).toBe(0);
    expect(r.costo).toBeCloseTo(BRUTO_MONOTRIBUTO, 2);
  });

  it('con la escala vigente, el mismo concepto sí entra', () => {
    const conceptos = [
      { id: 'c1', nombre: 'Aporte de monotributo', signo: 'suma', unidad: 'monto_fijo_mensual', origen_valor: 'escala_legal', escala_tipo: 'aporte_monotributo', aplica_a: 'monotributo' },
    ];
    const escalasPorTipo = escalasPorTipoALaFecha(new Map([
      ['a', { tipo: 'aporte_monotributo', categoria: null, unidad: 'monto_fijo_mensual', valor: 35000, moneda: 'ARS' }],
    ]));
    const r = costoMensualDelVinculo({
      asistenteBase: ASISTENTE, tipoVinculo: 'monotributo', conceptos, ...COMUN, escalasPorTipo,
    });
    expect(r.sinEscala).toEqual([]);
    expect(r.costo).toBeCloseTo(BRUTO_MONOTRIBUTO + 35000, 2);
  });

  it('sin horas semanales el monotributo no se puede calcular, aunque tenga valor hora', () => {
    const r = costoMensualDelVinculo({
      asistenteBase: { ...ASISTENTE, horas_semanales: null },
      tipoVinculo: 'monotributo',
      conceptos: [],
      ...COMUN,
    });
    expect(r).toEqual({ faltaDato: true, dato: 'horas_semanales' });
  });

  it('sin valor hora ni sueldo, falta el dato de base y no da cero', () => {
    const asistenteBase = { ...ASISTENTE, valor_hora: null, sueldo_basico: null };
    const mono = costoMensualDelVinculo({ asistenteBase, tipoVinculo: 'monotributo', conceptos: [], ...COMUN });
    const dep = costoMensualDelVinculo({ asistenteBase, tipoVinculo: 'dependencia', conceptos: [], ...COMUN });

    expect(mono).toEqual({ faltaDato: true, dato: 'valor_hora' });
    expect(dep).toEqual({ faltaDato: true, dato: 'sueldo_basico' });
    expect(mono.costo).toBeUndefined();
  });

  it('el sueldo de dependencia no se mueve con las horas; el del monotributo sí', () => {
    const conMasHoras = { ...ASISTENTE, horas_semanales: '45' };
    const comun = { conceptos: [], ...COMUN };
    const monoBase = costoMensualDelVinculo({ asistenteBase: ASISTENTE, tipoVinculo: 'monotributo', ...comun });
    const monoMas = costoMensualDelVinculo({ asistenteBase: conMasHoras, tipoVinculo: 'monotributo', ...comun });
    expect(monoMas.costo).toBeGreaterThan(monoBase.costo);

    const depCargado = { ...ASISTENTE, sueldo_basico: '800000' };
    const dep = costoMensualDelVinculo({ asistenteBase: depCargado, tipoVinculo: 'dependencia', ...comun });
    const depMasHoras = costoMensualDelVinculo({
      asistenteBase: { ...depCargado, horas_semanales: '45' }, tipoVinculo: 'dependencia', ...comun,
    });
    expect(dep.costo).toBe(800000);
    expect(depMasHoras.costo).toBe(dep.costo);
    expect(dep.horas).toBe(0);
  });
});
