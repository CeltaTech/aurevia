/**
 * Que lo que se registra cuando no va nadie quede bien registrado, y que un consentimiento que no
 * se puede leer no pase por bueno.
 *
 *   npx vitest run src/lib/__tests__/pacienteSolo.test.js
 *
 * POR QUÉ EXISTE. Estas dos comprobaciones son las que sostienen el registro de los dos peores
 * finales que puede tener un turno. Si dejan pasar un consentimiento sin fin, queda escrito que la
 * Familia aceptó algo que nunca aceptó. Si dan por alcanzado un momento que el consentimiento no
 * alcanza, el producto afirma que hubo permiso donde no lo hubo.
 */
import { describe, expect, it } from 'vitest';
import {
  LARGOS,
  MEDIOS,
  MEDIOS_POSIBLES,
  ORIGENES,
  ORIGENES_POSIBLES,
  consentimientoQueAlcanza,
  elConsentimientoAlcanza,
  elFamiliarSigueEnLaCasa,
  esDefectoGraveQueSeQuedaraUnFamiliar,
  revisarConsentimiento,
  revisarFamiliarQueSeQuedo,
} from '../pacienteSolo';

/** Un consentimiento completo y bien cargado, del que cada prueba corre una sola cosa. */
function consentimiento(resto = {}) {
  return {
    quien_consintio: 'Hija del Paciente',
    medio: MEDIOS.TELEFONO,
    desde_at: '2026-03-10T20:00:00',
    hasta_at: '2026-03-11T08:00:00',
    ...resto,
  };
}

/** Un familiar que se quedó, bien cargado. */
function familiar(resto = {}) {
  return {
    familiar_nombre: 'Sobrino del Paciente',
    origen: ORIGENES.TURNO_SIN_CUBRIR,
    desde_at: '2026-03-10T20:00:00',
    ...resto,
  };
}

describe('lo que se guarda no se escribe dos veces', () => {
  it('los medios y los orígenes son los que la base acepta', () => {
    expect(MEDIOS_POSIBLES).toEqual(['telefono', 'en_persona', 'mensaje', 'correo']);
    expect(ORIGENES_POSIBLES).toEqual(['relevo', 'turno_sin_cubrir', 'extension']);
  });
});

describe('revisarConsentimiento', () => {
  it('acepta uno completo', () => {
    expect(revisarConsentimiento(consentimiento())).toEqual({ ok: true });
  });

  it('exige saber con quién se habló', () => {
    expect(revisarConsentimiento(consentimiento({ quien_consintio: '   ' })))
      .toEqual({ ok: false, campo: 'quien_consintio' });
    expect(revisarConsentimiento(consentimiento({ quien_consintio: undefined })))
      .toEqual({ ok: false, campo: 'quien_consintio' });
  });

  it('no acepta un nombre más largo que lo que entra', () => {
    const largo = 'a'.repeat(LARGOS.quien_consintio + 1);
    expect(revisarConsentimiento(consentimiento({ quien_consintio: largo })))
      .toEqual({ ok: false, campo: 'quien_consintio' });
  });

  it('no acepta un medio que no está en la lista', () => {
    expect(revisarConsentimiento(consentimiento({ medio: 'paloma mensajera' })))
      .toEqual({ ok: false, campo: 'medio' });
  });

  // Ésta es la prueba que sostiene la decisión entera: sin fin no es un consentimiento.
  it('no acepta un consentimiento sin fecha de fin', () => {
    expect(revisarConsentimiento(consentimiento({ hasta_at: null })))
      .toEqual({ ok: false, campo: 'hasta_at' });
    expect(revisarConsentimiento(consentimiento({ hasta_at: '' })))
      .toEqual({ ok: false, campo: 'hasta_at' });
  });

  it('no acepta que termine antes de empezar ni en el mismo instante', () => {
    expect(revisarConsentimiento(consentimiento({ hasta_at: '2026-03-10T19:00:00' })))
      .toEqual({ ok: false, campo: 'hasta_at' });
    expect(revisarConsentimiento(consentimiento({ hasta_at: '2026-03-10T20:00:00' })))
      .toEqual({ ok: false, campo: 'hasta_at' });
  });

  it('no acepta fechas que no se pueden leer', () => {
    expect(revisarConsentimiento(consentimiento({ desde_at: 'anoche' })))
      .toEqual({ ok: false, campo: 'desde_at' });
  });

  it('la nota es optativa, pero si viene tiene que entrar', () => {
    expect(revisarConsentimiento(consentimiento({ nota: null }))).toEqual({ ok: true });
    expect(revisarConsentimiento(consentimiento({ nota: '' }))).toEqual({ ok: true });
    expect(revisarConsentimiento(consentimiento({ nota: 'a'.repeat(LARGOS.nota + 1) })))
      .toEqual({ ok: false, campo: 'nota' });
  });
});

describe('revisarFamiliarQueSeQuedo', () => {
  it('acepta uno completo', () => {
    expect(revisarFamiliarQueSeQuedo(familiar())).toEqual({ ok: true });
  });

  it('acepta que todavía no haya fin: el familiar sigue en la casa', () => {
    expect(revisarFamiliarQueSeQuedo(familiar({ hasta_at: null }))).toEqual({ ok: true });
    expect(revisarFamiliarQueSeQuedo(familiar({ hasta_at: '' }))).toEqual({ ok: true });
  });

  it('no acepta que haya terminado antes de empezar', () => {
    expect(revisarFamiliarQueSeQuedo(familiar({ hasta_at: '2026-03-10T19:00:00' })))
      .toEqual({ ok: false, campo: 'hasta_at' });
  });

  // No se le pide justificación a quien nos está contratando.
  it('no pide motivo', () => {
    expect(revisarFamiliarQueSeQuedo(familiar({ motivo: undefined }))).toEqual({ ok: true });
    expect(revisarFamiliarQueSeQuedo(familiar({ motivo: '' }))).toEqual({ ok: true });
  });

  it('exige saber por cuál de los tres caminos pasó', () => {
    expect(revisarFamiliarQueSeQuedo(familiar({ origen: 'porque sí' })))
      .toEqual({ ok: false, campo: 'origen' });
  });

  it('exige el nombre de quien se quedó', () => {
    expect(revisarFamiliarQueSeQuedo(familiar({ familiar_nombre: '  ' })))
      .toEqual({ ok: false, campo: 'familiar_nombre' });
  });
});

describe('elConsentimientoAlcanza', () => {
  const dado = consentimiento();

  it('alcanza a un momento de adentro', () => {
    expect(elConsentimientoAlcanza(dado, new Date('2026-03-11T02:00:00'))).toBe(true);
  });

  it('alcanza a los dos bordes', () => {
    expect(elConsentimientoAlcanza(dado, new Date('2026-03-10T20:00:00'))).toBe(true);
    expect(elConsentimientoAlcanza(dado, new Date('2026-03-11T08:00:00'))).toBe(true);
  });

  it('no alcanza a un momento anterior ni a uno posterior', () => {
    expect(elConsentimientoAlcanza(dado, new Date('2026-03-10T19:59:00'))).toBe(false);
    expect(elConsentimientoAlcanza(dado, new Date('2026-03-11T08:01:00'))).toBe(false);
  });

  // Falla cerrado: lo que no se puede leer no autoriza nada.
  it('no alcanza si le falta una fecha o no se entiende', () => {
    expect(elConsentimientoAlcanza(null, new Date('2026-03-11T02:00:00'))).toBe(false);
    expect(elConsentimientoAlcanza(consentimiento({ hasta_at: null }), new Date('2026-03-11T02:00:00'))).toBe(false);
    expect(elConsentimientoAlcanza(consentimiento({ desde_at: 'anoche' }), new Date('2026-03-11T02:00:00'))).toBe(false);
  });
});

describe('consentimientoQueAlcanza', () => {
  it('devuelve el que alcanza y no el primero de la lista', () => {
    const viejo = consentimiento({ desde_at: '2026-03-01T20:00:00', hasta_at: '2026-03-02T08:00:00' });
    const elBueno = consentimiento();
    expect(consentimientoQueAlcanza([viejo, elBueno], new Date('2026-03-11T02:00:00'))).toBe(elBueno);
  });

  it('devuelve null cuando ninguno alcanza, y con una lista vacía', () => {
    expect(consentimientoQueAlcanza([consentimiento()], new Date('2026-04-01T02:00:00'))).toBeNull();
    expect(consentimientoQueAlcanza([], new Date('2026-03-11T02:00:00'))).toBeNull();
    expect(consentimientoQueAlcanza(undefined, new Date('2026-03-11T02:00:00'))).toBeNull();
  });
});

describe('el familiar que se quedó', () => {
  it('sigue en la casa mientras no haya fin', () => {
    expect(elFamiliarSigueEnLaCasa({ hasta_at: null })).toBe(true);
    expect(elFamiliarSigueEnLaCasa({ hasta_at: '2026-03-11T08:00:00' })).toBe(false);
    expect(elFamiliarSigueEnLaCasa(null)).toBe(false);
  });

  it('es siempre un defecto grave, venga por donde venga', () => {
    expect(esDefectoGraveQueSeQuedaraUnFamiliar()).toBe(true);
  });
});
