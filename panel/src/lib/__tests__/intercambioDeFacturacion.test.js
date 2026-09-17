import { describe, expect, it } from 'vitest';
import {
  COLUMNAS_QUE_SALEN,
  TOPE_DE_FILAS,
  armarArchivo,
  fechaDeArchivo,
  esIdentificador,
  leerArchivo,
  loFacturadoDeLaFila,
  numeroDeArchivo,
  queHacerConLaFilaFacturada,
} from '../intercambioDeFacturacion';

const FACTURA = '60000000-0000-4000-8000-000000000001';
const BIEN = {
  factura_id: FACTURA,
  comprobante_tipo: 'Factura B',
  comprobante_numero: '0001-00000123',
  monto_facturado: 1500,
};

describe('armarArchivo', () => {
  it('pone los títulos de las columnas y una fila por factura', () => {
    const texto = armarArchivo([
      { factura_id: 'f1', familia: 'Pérez', monto_a_facturar: 1500 },
    ]);
    const renglones = texto.replace(/^﻿/, '').trim().split('\r\n');
    expect(renglones[0]).toBe(COLUMNAS_QUE_SALEN.join(';'));
    expect(renglones[1].startsWith('f1;Pérez;')).toBe(true);
  });

  it('protege los valores que traen el separador adentro', () => {
    const texto = armarArchivo([{ familia: 'Pérez; González' }], ['familia']);
    expect(texto).toContain('"Pérez; González"');
  });

  it('empieza con la marca que hace que la planilla abra bien los acentos', () => {
    expect(armarArchivo([], ['familia']).startsWith('﻿')).toBe(true);
  });
});

describe('leerArchivo', () => {
  it('lee un archivo separado por punto y coma', () => {
    const { columnas, filas } = leerArchivo('factura_id;monto_facturado\r\nf1;1500\r\n');
    expect(columnas).toEqual(['factura_id', 'monto_facturado']);
    expect(filas).toEqual([{ factura_id: 'f1', monto_facturado: '1500' }]);
  });

  it('lee también los separados por coma y por tabulación', () => {
    expect(leerArchivo('factura_id,monto\nf1,10').filas[0]).toEqual({ factura_id: 'f1', monto: '10' });
    expect(leerArchivo('factura_id\tmonto\nf1\t10').filas[0]).toEqual({ factura_id: 'f1', monto: '10' });
  });

  it('compara los títulos sin importar la caja ni los espacios de sobra', () => {
    expect(leerArchivo(' Factura_ID ;MONTO_FACTURADO\nf1;10').columnas).toEqual([
      'factura_id',
      'monto_facturado',
    ]);
  });

  it('respeta los separadores que están adentro de comillas', () => {
    const { filas } = leerArchivo('factura_id;familia\nf1;"Pérez; González"');
    expect(filas[0].familia).toBe('Pérez; González');
  });

  it('no lee más filas que el tope', () => {
    const muchas = ['factura_id', ...Array.from({ length: TOPE_DE_FILAS + 20 }, (_, i) => `f${i}`)];
    expect(leerArchivo(muchas.join('\n')).filas).toHaveLength(TOPE_DE_FILAS);
  });

  it('devuelve vacío cuando el archivo no trae nada', () => {
    expect(leerArchivo('')).toEqual({ columnas: [], filas: [] });
  });
});

describe('numeroDeArchivo', () => {
  it('entiende el importe escrito en castellano y el escrito en inglés', () => {
    expect(numeroDeArchivo('1.234,56')).toBe(1234.56);
    expect(numeroDeArchivo('1,234.56')).toBe(1234.56);
  });

  it('entiende un número sin separadores', () => {
    expect(numeroDeArchivo('1500')).toBe(1500);
  });

  it('no confunde el separador de miles con centavos', () => {
    expect(numeroDeArchivo('1.500')).toBe(1500);
    expect(numeroDeArchivo('1,500')).toBe(1500);
  });

  it('devuelve algo que no es número cuando la celda está vacía', () => {
    expect(Number.isNaN(numeroDeArchivo(''))).toBe(true);
  });
});

describe('fechaDeArchivo', () => {
  it('entiende la fecha con el año adelante', () => {
    expect(fechaDeArchivo('2026-09-30')).toBe('2026-09-30');
  });

  it('entiende la fecha con día, mes y año separados por barra', () => {
    expect(fechaDeArchivo('5/9/2026')).toBe('2026-09-05');
  });

  it('devuelve vacío cuando la fecha no se entiende, para que se rechace el renglón', () => {
    expect(fechaDeArchivo('septiembre')).toBe('');
  });

  it('devuelve nada cuando la celda está vacía', () => {
    expect(fechaDeArchivo('')).toBe(null);
  });
});

describe('loFacturadoDeLaFila', () => {
  it('traduce la fila a lo que guarda la base', () => {
    expect(
      loFacturadoDeLaFila({
        factura_id: ' f1 ',
        comprobante_tipo: 'Factura B',
        comprobante_numero: '0001-00000123',
        monto_facturado: '1.234,56',
      })
    ).toEqual({
      factura_id: 'f1',
      comprobante_tipo: 'Factura B',
      comprobante_numero: '0001-00000123',
      monto_facturado: 1234.56,
    });
  });

  it('no informa el vencimiento cuando el archivo no lo trae, para no pisar el acordado', () => {
    expect(loFacturadoDeLaFila({ factura_id: 'f1' }).fecha_vencimiento).toBe(undefined);
    expect(loFacturadoDeLaFila({ factura_id: 'f1', fecha_vencimiento: '  ' }).fecha_vencimiento).toBe(
      undefined
    );
  });

  it('informa el vencimiento cuando el archivo lo trae', () => {
    expect(loFacturadoDeLaFila({ factura_id: 'f1', fecha_vencimiento: '30/09/2026' })).toMatchObject({
      fecha_vencimiento: '2026-09-30',
    });
  });

  it('deja el número del comprobante sin informar cuando viene vacío', () => {
    expect(loFacturadoDeLaFila({ factura_id: 'f1' }).comprobante_numero).toBe(null);
  });
});

describe('esIdentificador', () => {
  it('reconoce un identificador de los que usa la base', () => {
    expect(esIdentificador(FACTURA)).toBe(true);
  });

  it('no toma por identificador un número de comprobante puesto en la columna equivocada', () => {
    expect(esIdentificador('0001-00000123')).toBe(false);
    expect(esIdentificador('')).toBe(false);
    expect(esIdentificador(undefined)).toBe(false);
  });
});

describe('queHacerConLaFilaFacturada', () => {
  const sinFacturar = { id: FACTURA, facturado_at: null };

  it('anota el renglón que está bien y apunta a una factura sin facturar', () => {
    expect(queHacerConLaFilaFacturada(BIEN, { factura: sinFacturar })).toEqual({ resultado: 'anotado' });
  });

  it('rechaza el renglón que no dice de qué factura se trata', () => {
    expect(queHacerConLaFilaFacturada({ ...BIEN, factura_id: '' }, { factura: sinFacturar })).toEqual({
      resultado: 'rechazado',
      motivo: 'factura_id',
    });
  });

  it('rechaza el renglón que trae un identificador que no tiene forma de tal', () => {
    expect(queHacerConLaFilaFacturada({ ...BIEN, factura_id: '0001-00000123' })).toEqual({
      resultado: 'rechazado',
      motivo: 'factura_id',
    });
  });

  it('rechaza el renglón al que le falta cómo se llama el comprobante', () => {
    expect(
      queHacerConLaFilaFacturada({ ...BIEN, comprobante_tipo: '' }, { factura: sinFacturar })
    ).toEqual({ resultado: 'rechazado', motivo: 'comprobante_tipo' });
  });

  it('rechaza el renglón cuyo monto no es un número', () => {
    expect(
      queHacerConLaFilaFacturada({ ...BIEN, monto_facturado: NaN }, { factura: sinFacturar })
    ).toEqual({ resultado: 'rechazado', motivo: 'monto_facturado' });
  });

  it('rechaza el renglón cuya fecha de vencimiento no se entendió', () => {
    expect(
      queHacerConLaFilaFacturada({ ...BIEN, fecha_vencimiento: '' }, { factura: sinFacturar })
    ).toEqual({ resultado: 'rechazado', motivo: 'fecha_vencimiento' });
  });

  it('rechaza el renglón cuya factura no aparece, que es también la de otra Prestadora', () => {
    expect(queHacerConLaFilaFacturada(BIEN, { factura: null })).toEqual({
      resultado: 'rechazado',
      motivo: 'no_encontrada',
    });
  });

  it('no pisa una factura que ya tiene comprobante anotado', () => {
    expect(
      queHacerConLaFilaFacturada(BIEN, { factura: { id: FACTURA, facturado_at: '2026-09-10T10:00:00Z' } })
    ).toEqual({ resultado: 'ya_facturada' });
  });

  it('no anota dos veces la misma factura repetida adentro del mismo archivo', () => {
    expect(queHacerConLaFilaFacturada(BIEN, { yaVista: true, factura: sinFacturar })).toEqual({
      resultado: 'ya_facturada',
    });
  });
});
