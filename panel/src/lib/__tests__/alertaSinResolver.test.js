import { describe, expect, it, vi } from 'vitest';
import { NIVEL_CRITICO, sigueSinResolver, sigueSinResolverYEsCritica, soloSinResolver } from '../alertaSinResolver';

// Una alerta recién escrita por la IA: nadie la miró todavía.
const ABIERTA = { id: 'a', nivel: NIVEL_CRITICO, resuelta: false };

describe('sigueSinResolver', () => {
  it('encuentra la alerta que nadie miró', () => {
    expect(sigueSinResolver(ABIERTA)).toBe(true);
  });

  it('deja afuera la que alguien ya dio por resuelta', () => {
    expect(sigueSinResolver({ ...ABIERTA, resuelta: true })).toBe(false);
  });

  // La IA escribe la alerta sin esa columna y la base la completa en `false`; si la consulta no la
  // pidió, acá llega sin ella. Que eso se lea como "ya está resuelta" escondería justo la que nadie
  // miró, así que la ausencia cuenta como abierta.
  it('trata como abierta la alerta que llegó sin esa columna', () => {
    expect(sigueSinResolver({ id: 'a', nivel: NIVEL_CRITICO })).toBe(true);
  });

  it('no se cae con una alerta que no llegó', () => {
    expect(sigueSinResolver(undefined)).toBe(true);
  });
});

describe('sigueSinResolverYEsCritica', () => {
  it('encuentra la que no puede esperar', () => {
    expect(sigueSinResolverYEsCritica(ABIERTA)).toBe(true);
  });

  it('deja afuera la abierta de otro nivel', () => {
    expect(sigueSinResolverYEsCritica({ ...ABIERTA, nivel: 'amarilla' })).toBe(false);
  });

  it('deja afuera la crítica que alguien ya resolvió', () => {
    expect(sigueSinResolverYEsCritica({ ...ABIERTA, resuelta: true })).toBe(false);
  });
});

describe('soloSinResolver', () => {
  // La misma pregunta, hecha del lado de la base. La prueba mira que el filtro sea el de la columna
  // —y con `false`, no con "es nulo"— y que devuelva la consulta para seguir encadenando: si
  // devolviera otra cosa, la pantalla que la usa perdería el `.order()` que viene después.
  it('le agrega a la consulta el filtro de la columna y la devuelve', () => {
    const consulta = { eq: vi.fn(() => consulta) };
    expect(soloSinResolver(consulta)).toBe(consulta);
    expect(consulta.eq).toHaveBeenCalledWith('resuelta', false);
  });
});
