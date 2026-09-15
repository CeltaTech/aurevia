import { describe, expect, it } from 'vitest';
import { MESES_OBSERVADOS, costoMensualDeCobertura, ventanaDeCobertura } from '../costoDeCobertura';

const HOY = '2026-09-15';

describe('ventanaDeCobertura', () => {
  it('mira los últimos doce meses cuando el vínculo es más viejo que eso', () => {
    expect(ventanaDeCobertura(HOY, '2020-01-01')).toEqual({ desde: '2025-09-15', meses: MESES_OBSERVADOS });
  });

  it('no mira desde antes de que la persona entrara', () => {
    // Repartir entre doce meses lo que costó cubrir cuatro daría un tercio del costo real.
    expect(ventanaDeCobertura(HOY, '2026-05-01')).toEqual({ desde: '2026-05-01', meses: 4 });
  });

  it('un vínculo recién empezado cuenta como un mes, no como cero', () => {
    expect(ventanaDeCobertura(HOY, '2026-09-01').meses).toBe(1);
  });

  it('sin fecha de alta se mira la ventana entera', () => {
    expect(ventanaDeCobertura(HOY, null).meses).toBe(MESES_OBSERVADOS);
  });
});

describe('costoMensualDeCobertura', () => {
  // Datos inventados: tres coberturas de una misma persona a lo largo del año.
  const COBERTURAS = [
    { costo_adicional: '12000', moneda: 'ARS', fecha: '2026-02-10' },
    { costo_adicional: '12000', moneda: 'ARS', fecha: '2026-06-03' },
    { costo_adicional: '36000', moneda: 'ARS', fecha: '2026-08-21' },
  ];
  const VENTANA = { desde: '2025-09-15', meses: 12 };

  it('reparte por mes lo que ya costó cubrirla', () => {
    const r = costoMensualDeCobertura({ coberturas: COBERTURAS, moneda: 'ARS', ...VENTANA });
    expect(r.total).toBe(60000);
    expect(r.porMes).toBe(5000);
    expect(r.cubiertas).toBe(3);
  });

  it('quien nunca faltó cuesta cero de cobertura, y eso es un dato', () => {
    const r = costoMensualDeCobertura({ coberturas: [], moneda: 'ARS', ...VENTANA });
    expect(r.total).toBe(0);
    expect(r.porMes).toBe(0);
    expect(r.cubiertas).toBe(0);
  });

  it('lo anterior a la ventana no entra', () => {
    const viejas = [{ costo_adicional: '999999', moneda: 'ARS', fecha: '2024-03-01' }, ...COBERTURAS];
    const r = costoMensualDeCobertura({ coberturas: viejas, moneda: 'ARS', ...VENTANA });
    expect(r.total).toBe(60000);
  });

  it('un importe en otra moneda no se convierte: queda afuera y se cuenta aparte', () => {
    const mezcla = [...COBERTURAS, { costo_adicional: '500', moneda: 'USD', fecha: '2026-07-01' }];
    const r = costoMensualDeCobertura({ coberturas: mezcla, moneda: 'ARS', ...VENTANA });
    expect(r.total).toBe(60000);
    expect(r.enOtraMoneda).toBe(1);
  });

  it('una cobertura sin costo cargado cuenta como cero y no rompe la cuenta', () => {
    const sinCosto = [...COBERTURAS, { costo_adicional: null, moneda: 'ARS', fecha: '2026-09-01' }];
    const r = costoMensualDeCobertura({ coberturas: sinCosto, moneda: 'ARS', ...VENTANA });
    expect(r.total).toBe(60000);
    expect(r.cubiertas).toBe(4);
  });

  it('el mismo gasto en menos meses pesa más por mes', () => {
    const corta = costoMensualDeCobertura({ coberturas: COBERTURAS, moneda: 'ARS', desde: '2026-01-01', meses: 6 });
    expect(corta.porMes).toBe(10000);
  });
});
