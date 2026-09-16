/**
 * Cómo se lee la cuenta de correo contra el límite del servicio que lo despacha.
 *
 *   npx vitest run   (desde panel/)
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El aviso de «se alcanzó el límite» es lo único que separa a quien
 * administra la plataforma de enterarse el día que un correo no sale. Se rompe de dos maneras
 * silenciosas: quedándose mirando un solo período —el mes se llena aunque el día tenga margen—, y
 * dando por alcanzado un límite que nadie cargó, que es avisar de algo que no se sabe.
 */
import { describe, it, expect } from 'vitest';
import { seAlcanzoElLimite, contraSuLimite } from '../cuentaDeCorreo';

const TEXTOS = {
  correos_de_tope: '{cantidad} de {tope}',
  correos_sin_tope: '{cantidad}, sin límite cargado',
};

describe('se alcanzó el límite', () => {
  it('con margen en los dos períodos, no avisa', () => {
    expect(seAlcanzoElLimite({ del_dia: 12, del_mes: 300, tope_diario: 100, tope_mensual: 3000 })).toBe(false);
  });

  it('avisa cuando se llenó el día', () => {
    expect(seAlcanzoElLimite({ del_dia: 100, del_mes: 300, tope_diario: 100, tope_mensual: 3000 })).toBe(true);
  });

  it('avisa cuando se llenó el mes, aunque el día tenga margen', () => {
    // Es el caso que se pasa por alto: quedan 98 del día y ninguno del mes, y los avisos no salen
    // igual.
    expect(seAlcanzoElLimite({ del_dia: 2, del_mes: 3000, tope_diario: 100, tope_mensual: 3000 })).toBe(true);
  });

  it('sin ningún límite cargado, no avisa de nada', () => {
    expect(seAlcanzoElLimite({ del_dia: 9000, del_mes: 9000, tope_diario: null, tope_mensual: null })).toBe(false);
  });

  it('sin cuenta todavía, no avisa', () => {
    expect(seAlcanzoElLimite(null)).toBe(false);
  });
});

describe('cómo se escribe cada número', () => {
  it('con límite cargado, el número va contra el límite', () => {
    expect(contraSuLimite(12, 100, TEXTOS)).toBe('12 de 100');
  });

  it('sin límite cargado, va el número solo y se dice que falta el límite', () => {
    expect(contraSuLimite(12, null, TEXTOS)).toBe('12, sin límite cargado');
  });
});
