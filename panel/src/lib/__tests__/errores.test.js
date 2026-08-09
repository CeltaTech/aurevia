import { describe, expect, it, vi } from 'vitest';
import { situacionDelError, mensajeDeError, SITUACIONES } from '../errores';
import { T } from '../../i18n/translations';

const t = T['es-AR'];

describe('situacionDelError', () => {
  it('reconoce los códigos de la base de datos', () => {
    expect(situacionDelError({ code: '23505' })).toBe('duplicado');
    expect(situacionDelError({ code: '23503' })).toBe('en_uso');
    expect(situacionDelError({ code: '42501' })).toBe('sin_permiso');
    expect(situacionDelError({ code: '22P02' })).toBe('dato_invalido');
  });

  it('reconoce los códigos de la puerta de entrada a la base', () => {
    expect(situacionDelError({ code: 'PGRST116' })).toBe('no_encontrado');
    expect(situacionDelError({ code: 'PGRST301' })).toBe('sesion_vencida');
    expect(situacionDelError({ code: 'PGRST205' })).toBe('falla_del_sistema');
  });

  it('reconoce los números que manda el servidor', () => {
    expect(situacionDelError({ status: 401 })).toBe('sesion_vencida');
    expect(situacionDelError({ status: 403 })).toBe('sin_permiso');
    expect(situacionDelError({ status: 404 })).toBe('no_encontrado');
    expect(situacionDelError({ status: 503 })).toBe('falla_del_sistema');
  });

  it('reconoce la falta de internet por el texto del navegador', () => {
    expect(situacionDelError(new TypeError('Failed to fetch'))).toBe('sin_conexion');
    expect(situacionDelError({ message: 'NetworkError when attempting to fetch' })).toBe('sin_conexion');
  });

  it('reconoce la sesión vencida por el texto', () => {
    expect(situacionDelError({ message: 'JWT expired' })).toBe('sesion_vencida');
    expect(situacionDelError('Invalid Refresh Token: Already Used')).toBe('sesion_vencida');
  });

  it('el código manda sobre el texto', () => {
    // Postgres manda el 23505 con un texto que además dice "duplicate key"; si algún día
    // el texto cambia de idioma, el código sigue estando.
    expect(situacionDelError({ code: '23505', message: 'texto cualquiera' })).toBe('duplicado');
  });

  it('cuando no reconoce nada, la culpa es nuestra', () => {
    expect(situacionDelError(null)).toBe('falla_del_sistema');
    expect(situacionDelError(undefined)).toBe('falla_del_sistema');
    expect(situacionDelError({})).toBe('falla_del_sistema');
    expect(situacionDelError('cualquier cosa rara')).toBe('falla_del_sistema');
  });

  it('siempre devuelve una de las ocho situaciones', () => {
    const casos = [null, {}, 'x', { code: '23505' }, { status: 404 }, new Error('Failed to fetch')];
    for (const caso of casos) {
      expect(SITUACIONES).toContain(situacionDelError(caso));
    }
  });
});

describe('mensajeDeError', () => {
  it('devuelve el texto del idioma, nunca el error crudo', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const texto = mensajeDeError({ code: '23505', message: 'duplicate key value violates…' }, t);
    expect(texto).toBe(t.errores.duplicado);
    expect(texto).not.toMatch(/duplicate|violates/i);
  });

  it('las ocho situaciones tienen texto en los tres idiomas', () => {
    for (const idioma of Object.keys(T)) {
      for (const situacion of SITUACIONES) {
        expect(T[idioma].errores?.[situacion], `${idioma}.errores.${situacion}`).toBeTruthy();
      }
    }
  });

  it('si faltara el idioma, cae al texto genérico y no rompe', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(mensajeDeError(new Error('x'), { comun: { error_generico: 'ups' } })).toBe('ups');
    expect(mensajeDeError(new Error('x'), undefined)).toBe('');
  });
});
