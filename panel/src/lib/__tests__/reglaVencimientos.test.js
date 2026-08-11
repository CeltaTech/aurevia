import { describe, expect, it } from 'vitest';
import {
  DIAS_AVISO_POR_DEFECTO,
  ESTADO_VENCIMIENTO,
  URGENCIA,
  diasParaVencer,
  estadoDeVencimiento,
  fechaLimiteDeAviso,
  urgenciaDeVencimiento,
  ventanaDeAviso,
} from '../reglaVencimientos';

// Un día fijo, para que las pruebas no cambien de resultado según cuándo se corran.
const HOY = new Date('2026-08-09T10:30:00');

describe('diasParaVencer', () => {
  it('cuenta días de calendario, no horas', () => {
    // Faltan 5 días aunque hoy sean las 10:30 y el vencimiento sea a la medianoche.
    expect(diasParaVencer('2026-08-14', HOY)).toBe(5);
    expect(diasParaVencer('2026-08-09', HOY)).toBe(0);
    expect(diasParaVencer('2026-08-07', HOY)).toBe(-2);
  });

  it('sin fecha de vencimiento no hay cuenta que hacer', () => {
    // Hay títulos que no caducan: eso no es "vence hoy", es "no vence".
    expect(diasParaVencer(null, HOY)).toBe(null);
    expect(diasParaVencer('', HOY)).toBe(null);
    expect(diasParaVencer(undefined, HOY)).toBe(null);
  });
});

describe('ventanaDeAviso', () => {
  it('un plazo que no sirve vale lo mismo que no haber configurado nada', () => {
    // Cero querría decir "no avisar nunca", que no es lo que nadie configuró a propósito.
    expect(ventanaDeAviso(0)).toBe(DIAS_AVISO_POR_DEFECTO);
    expect(ventanaDeAviso(null)).toBe(DIAS_AVISO_POR_DEFECTO);
    expect(ventanaDeAviso(undefined)).toBe(DIAS_AVISO_POR_DEFECTO);
    expect(ventanaDeAviso(-5)).toBe(DIAS_AVISO_POR_DEFECTO);
    expect(ventanaDeAviso('no es un número')).toBe(DIAS_AVISO_POR_DEFECTO);
  });

  it('el número que sí sirve se respeta, aunque venga como texto', () => {
    expect(ventanaDeAviso(60)).toBe(60);
    expect(ventanaDeAviso('60')).toBe(60);
  });
});

describe('urgenciaDeVencimiento', () => {
  it('los cuatro escalones, con la ventana de 30 días', () => {
    expect(urgenciaDeVencimiento(-1)).toBe(URGENCIA.VENCIDA);
    expect(urgenciaDeVencimiento(0)).toBe(URGENCIA.URGENTE);
    expect(urgenciaDeVencimiento(10)).toBe(URGENCIA.URGENTE);
    expect(urgenciaDeVencimiento(11)).toBe(URGENCIA.AVISO);
    expect(urgenciaDeVencimiento(30)).toBe(URGENCIA.AVISO);
    expect(urgenciaDeVencimiento(31)).toBe(URGENCIA.NINGUNA);
  });

  it('el último tercio se calcula sobre la ventana que configuró la Prestadora', () => {
    // Con 60 días de ventana aprieta en los últimos 20, no en los últimos 10.
    expect(urgenciaDeVencimiento(20, 60)).toBe(URGENCIA.URGENTE);
    expect(urgenciaDeVencimiento(21, 60)).toBe(URGENCIA.AVISO);
    expect(urgenciaDeVencimiento(61, 60)).toBe(URGENCIA.NINGUNA);
  });

  it('lo que no vence nunca no urge nunca', () => {
    expect(urgenciaDeVencimiento(null)).toBe(URGENCIA.NINGUNA);
    expect(urgenciaDeVencimiento(undefined)).toBe(URGENCIA.NINGUNA);
  });
});

describe('estadoDeVencimiento', () => {
  it('dice lo mismo que la urgencia, en las tres palabras de las listas', () => {
    expect(estadoDeVencimiento(-1)).toBe(ESTADO_VENCIMIENTO.VENCIDO);
    expect(estadoDeVencimiento(5)).toBe(ESTADO_VENCIMIENTO.POR_VENCER);
    expect(estadoDeVencimiento(25)).toBe(ESTADO_VENCIMIENTO.POR_VENCER);
    expect(estadoDeVencimiento(31)).toBe(ESTADO_VENCIMIENTO.VIGENTE);
    expect(estadoDeVencimiento(null)).toBe(ESTADO_VENCIMIENTO.VIGENTE);
  });

  it('nunca contesta algo que las pantallas no sepan pintar', () => {
    const palabras = Object.values(ESTADO_VENCIMIENTO);
    for (const dias of [-100, -1, 0, 1, 15, 30, 31, 999, null, undefined]) {
      expect(palabras).toContain(estadoDeVencimiento(dias));
    }
  });
});

describe('fechaLimiteDeAviso', () => {
  it('devuelve el día hasta el que hay que mirar, en el formato de la base', () => {
    expect(fechaLimiteDeAviso(30, HOY)).toBe('2026-09-08');
    expect(fechaLimiteDeAviso(60, HOY)).toBe('2026-10-08');
  });

  it('un plazo que no sirve usa la ventana de arranque, no rompe la consulta', () => {
    expect(fechaLimiteDeAviso(0, HOY)).toBe('2026-09-08');
    expect(fechaLimiteDeAviso(null, HOY)).toBe('2026-09-08');
  });

  it('lo que trae la consulta y lo que clasifica la regla no se contradicen', () => {
    // El límite es el último día que la consulta trae. Ese día tiene que quedar clasificado
    // como "por vencer" y el siguiente como "vigente": si no, la lista mostraría un papel en
    // verde que solo está ahí porque estaba por vencer.
    const limite = fechaLimiteDeAviso(30, HOY);
    expect(estadoDeVencimiento(diasParaVencer(limite, HOY), 30)).toBe(ESTADO_VENCIMIENTO.POR_VENCER);
    expect(estadoDeVencimiento(diasParaVencer('2026-09-09', HOY), 30)).toBe(ESTADO_VENCIMIENTO.VIGENTE);
  });
});
