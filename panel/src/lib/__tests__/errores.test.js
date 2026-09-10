import { describe, expect, it, vi } from 'vitest';
import { situacionDelError, mensajeDeError, errorDeLaRespuesta, SITUACIONES } from '../errores';
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

/* El camino entero, del motor a la pantalla.
   ==========================================================================

   Las pruebas de arriba comprueban las dos piezas por separado. Ésta comprueba que están
   enganchadas, que es justo lo que estuvo roto: el motor mandaba el motivo, la pantalla armaba
   el error a mano con `new Error(resultado.error)` y el motivo se perdía en ese renglón. El
   mecanismo estaba entero y no funcionaba, porque nadie recorría el camino de punta a punta.

   Lo que se simula es la respuesta del motor tal como llega: un número, un texto crudo para el
   registro del servidor y un motivo. La frase no viaja nunca desde el motor —no sabe en qué
   idioma está mirando la persona—, así que se busca acá, en las traducciones. */
describe('del motor a la pantalla', () => {
  // Lo mínimo que `errorDeLaRespuesta` mira de la respuesta de `fetch`.
  const respuestaConNumero = (status) => ({ ok: false, status });

  it('el motivo que manda el motor llega hasta la frase traducida', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = errorDeLaRespuesta(respuestaConNumero(409), {
      error: 'A user with this email address has already been registered',
      motivo: 'correo_de_otra_cuenta',
    });

    const texto = mensajeDeError(error, t);

    expect(texto).toBe(t.errores.motivos.correo_de_otra_cuenta);
    // Y no la frase genérica del 409, que es exactamente lo que se veía cuando el motivo se
    // perdía al armar el error a mano: la persona leía "ya existe un registro con esos datos"
    // en vez de enterarse de que ese correo ya está en uso.
    expect(texto).not.toBe(t.errores.duplicado);
    // Ni el texto crudo del motor, que está escrito para quien programa.
    expect(texto).not.toMatch(/registered|email/i);
  });

  it('el mismo motivo se explica en los tres idiomas', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = errorDeLaRespuesta(respuestaConNumero(409), { motivo: 'modalidad_con_asistentes' });

    for (const idioma of Object.keys(T)) {
      const textos = T[idioma];
      const texto = mensajeDeError(error, textos);
      expect(texto, `${idioma}.errores.motivos.modalidad_con_asistentes`).toBe(
        textos.errores.motivos.modalidad_con_asistentes,
      );
      expect(texto).not.toBe(textos.errores.duplicado);
    }
  });

  it('sin motivo, la explicación sale del número de la respuesta', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(mensajeDeError(errorDeLaRespuesta(respuestaConNumero(403), { error: 'permission denied' }), t)).toBe(
      t.errores.sin_permiso,
    );
    expect(mensajeDeError(errorDeLaRespuesta(respuestaConNumero(404), {}), t)).toBe(t.errores.no_encontrado);
  });

  it('un cuerpo vacío no deja a la pantalla sin explicación', () => {
    // Una baja puede contestar sin cuerpo, y una caída del servidor puede contestar una página
    // que no es JSON. En los dos casos la pantalla lee `{}` y lo único que queda es el número.
    // Ése era el agujero que las pantallas tapaban con un `|| 'Error de red'` escrito a mano.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const texto = mensajeDeError(errorDeLaRespuesta(respuestaConNumero(503), {}), t);
    expect(texto).toBe(t.errores.falla_del_sistema);
    expect(texto).not.toMatch(/HTTP|503/);
  });

  it('un motivo sin traducción no le muestra un código a nadie', () => {
    // El motor puede adelantarse a las traducciones. Si eso pasa, se cae a la situación del
    // número y quien mira ve una frase, nunca `motivo_que_nadie_tradujo`.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const texto = mensajeDeError(errorDeLaRespuesta(respuestaConNumero(409), { motivo: 'motivo_que_nadie_tradujo' }), t);
    expect(texto).toBe(t.errores.duplicado);
    expect(texto).not.toMatch(/motivo_que_nadie_tradujo/);
  });
});
