import { describe, expect, it } from 'vitest';
import {
  ALCANCES,
  ORIGENES,
  SIGNOS,
  UNIDADES,
  camposDelConcepto,
  conceptoParaGuardar,
  loQueFaltaDelConcepto,
} from '../conceptosLiquidacion';
import { T } from '../../i18n/translations';

const IDIOMAS = ['es-AR', 'en', 'pt-BR'];

// Un concepto completo y válido, del que parten las pruebas cambiando de a un dato.
const IMPORTE_PROPIO = {
  nombre: 'Adicional por zona',
  signo: 'suma',
  unidad: 'monto_fijo_mensual',
  origen_valor: 'propio',
  aplica_a: 'todos',
  valor: '15000',
  moneda: 'ARS',
  orden: 10,
};

describe('camposDelConcepto', () => {
  it('un importe propio lleva valor y moneda, y ningún tipo de escala', () => {
    expect(camposDelConcepto(IMPORTE_PROPIO)).toEqual({ valor: true, escala_tipo: false, moneda: true });
  });

  it('un porcentaje no lleva moneda, porque un porcentaje no es plata', () => {
    expect(camposDelConcepto({ unidad: 'porcentaje', origen_valor: 'propio' })).toEqual({
      valor: true,
      escala_tipo: false,
      moneda: false,
    });
  });

  it('un concepto de escala legal no lleva valor propio ni moneda: los dos vienen con la escala', () => {
    expect(camposDelConcepto({ unidad: 'monto_fijo_mensual', origen_valor: 'escala_legal' })).toEqual({
      valor: false,
      escala_tipo: true,
      moneda: false,
    });
  });

  it('sin nada elegido todavía, no se pide un tipo de escala', () => {
    expect(camposDelConcepto()).toEqual({ valor: true, escala_tipo: false, moneda: true });
  });
});

describe('loQueFaltaDelConcepto', () => {
  it('un concepto completo no tiene nada pendiente', () => {
    expect(loQueFaltaDelConcepto(IMPORTE_PROPIO)).toEqual([]);
  });

  it('un valor en cero es un dato cargado, no un dato que falta', () => {
    expect(loQueFaltaDelConcepto({ ...IMPORTE_PROPIO, valor: 0 })).toEqual([]);
    expect(loQueFaltaDelConcepto({ ...IMPORTE_PROPIO, valor: '0' })).toEqual([]);
  });

  it('un nombre en blanco no alcanza', () => {
    expect(loQueFaltaDelConcepto({ ...IMPORTE_PROPIO, nombre: '   ' })).toEqual(['nombre']);
  });

  it('un importe propio sin valor no se puede guardar', () => {
    expect(loQueFaltaDelConcepto({ ...IMPORTE_PROPIO, valor: '' })).toEqual(['valor']);
  });

  it('un concepto de escala legal necesita saber a qué escala mirar', () => {
    const deEscala = { ...IMPORTE_PROPIO, origen_valor: 'escala_legal', valor: '', moneda: null };
    expect(loQueFaltaDelConcepto(deEscala)).toEqual(['escala_tipo']);
    expect(loQueFaltaDelConcepto({ ...deEscala, escala_tipo: 'aporte_jubilatorio' })).toEqual([]);
  });

  it('un importe propio sin moneda no se puede guardar, un porcentaje sí', () => {
    expect(loQueFaltaDelConcepto({ ...IMPORTE_PROPIO, moneda: null })).toEqual(['moneda']);
    expect(loQueFaltaDelConcepto({ ...IMPORTE_PROPIO, unidad: 'porcentaje', moneda: null })).toEqual([]);
  });

  it('los valores que la base no acepta se marcan como faltantes', () => {
    const inventado = { ...IMPORTE_PROPIO, signo: 'multiplica', unidad: 'por_guardia', aplica_a: 'jubilados' };
    expect(loQueFaltaDelConcepto(inventado)).toEqual(['signo', 'unidad', 'aplica_a']);
  });
});

describe('conceptoParaGuardar', () => {
  it('manda los números como números y el nombre sin espacios de más', () => {
    const guardado = conceptoParaGuardar({ ...IMPORTE_PROPIO, nombre: '  Adicional por zona  ' });
    expect(guardado).toEqual({
      nombre: 'Adicional por zona',
      signo: 'suma',
      unidad: 'monto_fijo_mensual',
      origen_valor: 'propio',
      aplica_a: 'todos',
      valor: 15000,
      escala_tipo: null,
      moneda: 'ARS',
      orden: 10,
    });
  });

  it('al pasar a escala legal, el valor viejo se borra en vez de quedar colgado', () => {
    // Es el caso que la base rechaza: valor propio y tipo de escala al mismo tiempo.
    const guardado = conceptoParaGuardar({
      ...IMPORTE_PROPIO,
      origen_valor: 'escala_legal',
      escala_tipo: 'aporte_jubilatorio',
    });
    expect(guardado.valor).toBeNull();
    expect(guardado.moneda).toBeNull();
    expect(guardado.escala_tipo).toBe('aporte_jubilatorio');
  });

  it('al pasar a porcentaje, la moneda se borra', () => {
    expect(conceptoParaGuardar({ ...IMPORTE_PROPIO, unidad: 'porcentaje', valor: '11' })).toMatchObject({
      valor: 11,
      moneda: null,
      escala_tipo: null,
    });
  });

  it('sin orden escrito, el concepto va al final de la lista igual que en la base', () => {
    expect(conceptoParaGuardar({ ...IMPORTE_PROPIO, orden: '' }).orden).toBe(100);
  });
});

describe('los valores tienen su texto en los tres idiomas', () => {
  // Una lista sin traducir no rompe nada: muestra un hueco a quien mira la pantalla en su
  // idioma. Por eso se comprueba acá y no leyendo el archivo de textos (regla 2 del §7).
  const listas = [
    ['signo_', SIGNOS],
    ['unidad_', UNIDADES],
    ['origen_', ORIGENES],
    // El alcance no reusa los nombres de vínculo del plantel: ahí "monotributo" nombra un
    // vínculo y acá nombra a quiénes les toca el concepto, que es una frase distinta.
    ['alcance_', ALCANCES],
  ];

  for (const idioma of IDIOMAS) {
    it(`${idioma} nombra cada signo, unidad, origen y alcance`, () => {
      for (const [prefijo, valores] of listas) {
        for (const valor of valores) {
          expect(T[idioma].pagos_asistentes[`${prefijo}${valor}`]).toBeTruthy();
        }
      }
    });
  }
});
