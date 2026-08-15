import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ROLES_CON_SEGUNDO_FACTOR,
  elRolUsaSegundoFactor,
  elSegundoFactorEsObligatorio,
} from '../reglaMfaObligatorio';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('elRolUsaSegundoFactor', () => {
  it('el rol técnico de CeltaTech sí, los roles de una Prestadora no', () => {
    expect(elRolUsaSegundoFactor('superadmin')).toBe(true);
    expect(elRolUsaSegundoFactor('admin_prestadora')).toBe(false);
    expect(elRolUsaSegundoFactor('coordinador')).toBe(false);
    expect(elRolUsaSegundoFactor(undefined)).toBe(false);
  });

  it('la lista de roles vive en un solo lado', () => {
    expect(ROLES_CON_SEGUNDO_FACTOR).toEqual(['superadmin']);
  });
});

describe('elSegundoFactorEsObligatorio', () => {
  it('cuando la fila se lee, manda lo que diga la fila', () => {
    expect(elSegundoFactorEsObligatorio({ data: { mfa_admin_obligatorio: true }, error: null })).toBe(true);
    expect(elSegundoFactorEsObligatorio({ data: { mfa_admin_obligatorio: false }, error: null })).toBe(false);
  });

  it('sin fila, se exige igual y queda registrado', () => {
    // Es el caso que rompía antes: una base armada desde cero se quedaba sin la fila única y
    // la protección se apagaba sola, en silencio.
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(elSegundoFactorEsObligatorio({ data: null, error: null })).toBe(true);
    expect(consola).toHaveBeenCalledOnce();
  });

  it('si la lectura falla, se exige igual y queda registrado', () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(elSegundoFactorEsObligatorio({ data: null, error: { message: 'sin conexión' } })).toBe(true);
    expect(consola).toHaveBeenCalledOnce();
  });

  it('una lectura que ni siquiera llegó tampoco apaga la protección', () => {
    const consola = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(elSegundoFactorEsObligatorio(undefined)).toBe(true);
    expect(consola).toHaveBeenCalledOnce();
  });
});
