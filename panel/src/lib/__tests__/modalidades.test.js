import { describe, expect, it } from 'vitest';
import {
  MODALIDAD,
  modalidadesHabilitadas,
  modalidadesDelAsistente,
  trabajaEnModalidad,
  motivoDeModalidadDelError,
  mensajeDeModalidad,
} from '../modalidades';
import { T } from '../../i18n/translations';

const IDIOMAS = ['es-AR', 'en', 'pt-BR'];

describe('modalidadesHabilitadas', () => {
  it('deja pasar solo las modalidades que la Prestadora tiene activas', () => {
    expect(modalidadesHabilitadas(['directa'])).toEqual(['directa']);
    expect(modalidadesHabilitadas(['marketplace'])).toEqual(['marketplace']);
    expect(modalidadesHabilitadas(['directa', 'marketplace'])).toEqual(['directa', 'marketplace']);
  });

  it('la subcontratación no es una modalidad de una persona', () => {
    // Es trabajo de otra empresa, con su propio plantel: nadie de nuestra base lo cubre.
    expect(modalidadesHabilitadas(['subcontratacion'])).toEqual(['directa']);
    expect(modalidadesHabilitadas(['directa', 'subcontratacion'])).toEqual(['directa']);
  });

  it('una Prestadora recién creada trabaja en directa', () => {
    expect(modalidadesHabilitadas([])).toEqual(['directa']);
    expect(modalidadesHabilitadas(null)).toEqual(['directa']);
    expect(modalidadesHabilitadas(undefined)).toEqual(['directa']);
  });

  it('devuelve siempre el mismo orden, no el de las modalidades', () => {
    expect(modalidadesHabilitadas(['marketplace', 'directa'])).toEqual(['directa', 'marketplace']);
  });
});

describe('modalidadesDelAsistente', () => {
  it('lee la columna vieja y devuelve la lista', () => {
    // La columna se sigue llamando `canales` porque un nombre guardado no se renombra
    // (regla 13). Este es el único lugar de la aplicación que la nombra.
    expect(modalidadesDelAsistente({ canales: ['directa'] })).toEqual(['directa']);
  });

  it('una ficha sin nada cargado no tiene ninguna modalidad', () => {
    expect(modalidadesDelAsistente({})).toEqual([]);
    expect(modalidadesDelAsistente({ canales: null })).toEqual([]);
    expect(modalidadesDelAsistente(null)).toEqual([]);
  });
});

describe('trabajaEnModalidad', () => {
  const soloDirecta = { canales: ['directa'] };
  const lasDos = { canales: ['directa', 'marketplace'] };

  it('cruza la modalidad de la guardia contra la ficha del Asistente', () => {
    expect(trabajaEnModalidad(soloDirecta, MODALIDAD.DIRECTA)).toBe(true);
    expect(trabajaEnModalidad(soloDirecta, MODALIDAD.MARKETPLACE)).toBe(false);
    expect(trabajaEnModalidad(lasDos, MODALIDAD.MARKETPLACE)).toBe(true);
  });

  it('una guardia sin modalidad no cruza nada', () => {
    // Guardias viejas, anteriores a que la columna existiera: no se bloquea a nadie por eso.
    expect(trabajaEnModalidad(soloDirecta, null)).toBe(true);
    expect(trabajaEnModalidad(soloDirecta, undefined)).toBe(true);
  });

  it('un Asistente sin modalidades cargadas no trabaja en ninguna', () => {
    expect(trabajaEnModalidad({}, MODALIDAD.DIRECTA)).toBe(false);
    expect(trabajaEnModalidad({ canales: null }, MODALIDAD.DIRECTA)).toBe(false);
    expect(trabajaEnModalidad(null, MODALIDAD.DIRECTA)).toBe(false);
  });

  it('la subcontratación no la cubre nadie del plantel propio', () => {
    expect(trabajaEnModalidad(lasDos, 'subcontratacion')).toBe(false);
  });
});

describe('motivoDeModalidadDelError', () => {
  it('abre el rechazo que levanta la base al asignar una guardia', () => {
    expect(motivoDeModalidadDelError({ message: 'modalidad_bloquea:marketplace:' })).toEqual({
      motivo: 'bloquea',
      modalidad: 'marketplace',
    });
  });

  it('abre el rechazo de guardar una modalidad que la Prestadora no tiene habilitada', () => {
    expect(motivoDeModalidadDelError({ message: 'modalidad_no_habilitada:marketplace:' })).toEqual({
      motivo: 'no_habilitada',
      modalidad: 'marketplace',
    });
  });

  it('lee el texto crudo tal como llega, sin importar qué lo envuelva', () => {
    expect(motivoDeModalidadDelError('modalidad_bloquea:directa:')).toEqual({
      motivo: 'bloquea',
      modalidad: 'directa',
    });
    expect(
      motivoDeModalidadDelError({ message: 'error de la base: modalidad_bloquea:directa: en guardias' })
    ).toEqual({ motivo: 'bloquea', modalidad: 'directa' });
  });

  it('no se confunde con otros errores', () => {
    expect(motivoDeModalidadDelError({ message: 'matricula_bloquea:vencida:' })).toBeNull();
    expect(motivoDeModalidadDelError({ code: '23505' })).toBeNull();
    expect(motivoDeModalidadDelError(null)).toBeNull();
  });

  it('no confunde la palabra vieja con la nueva', () => {
    // "canal" se retiró: en este producto un canal es por dónde sale un aviso, no cómo
    // trabaja un Asistente. Si un rechazo viejo llegara igual, no se lo interpreta.
    expect(motivoDeModalidadDelError({ message: 'canal_bloquea:marketplace:' })).toBeNull();
  });

  it('descarta una modalidad que no existe', () => {
    expect(motivoDeModalidadDelError({ message: 'modalidad_bloquea:inventada:' })).toBeNull();
  });
});

describe('mensajeDeModalidad', () => {
  it('arma la frase con el nombre de la modalidad en el idioma de quien mira', () => {
    for (const idioma of IDIOMAS) {
      const tm = T[idioma].modalidades;
      const frase = mensajeDeModalidad({ message: 'modalidad_bloquea:marketplace:' }, tm);
      expect(frase).toContain(tm.marketplace);
      expect(frase).not.toContain('{modalidad}');
      expect(frase).not.toContain('modalidad_bloquea');
    }
  });

  it('distingue el bloqueo de la guardia de la modalidad no habilitada', () => {
    const tm = T['es-AR'].modalidades;
    expect(mensajeDeModalidad({ message: 'modalidad_bloquea:directa:' }, tm)).toBe(
      tm.error_bloquea.replace('{modalidad}', tm.directa)
    );
    expect(mensajeDeModalidad({ message: 'modalidad_no_habilitada:directa:' }, tm)).toBe(
      tm.error_no_habilitada.replace('{modalidad}', tm.directa)
    );
  });

  it('devuelve null cuando el error es otra cosa, para que la pantalla siga su camino', () => {
    expect(mensajeDeModalidad({ message: 'Failed to fetch' }, T['es-AR'].modalidades)).toBeNull();
    expect(mensajeDeModalidad({ message: 'modalidad_bloquea:directa:' }, undefined)).toBeNull();
  });
});

describe('los textos existen en los tres idiomas', () => {
  const CLAVES = [
    'etiqueta',
    'ayuda',
    'directa',
    'marketplace',
    'falta_elegir',
    'error_bloquea',
    'error_no_habilitada',
  ];

  it.each(IDIOMAS)('%s tiene el bloque de modalidades completo', (idioma) => {
    const tm = T[idioma].modalidades;
    expect(tm).toBeTruthy();
    for (const clave of CLAVES) {
      expect(typeof tm[clave], `falta ${clave} en ${idioma}`).toBe('string');
      expect(tm[clave].length).toBeGreaterThan(0);
    }
    // El marcador es una pieza del código, no una palabra traducible: se escribe igual en los
    // tres idiomas o el reemplazo no encuentra qué reemplazar.
    expect(tm.error_bloquea).toContain('{modalidad}');
    expect(tm.error_no_habilitada).toContain('{modalidad}');
  });

  it.each(IDIOMAS)('%s explica por qué un candidato queda afuera por la modalidad', (idioma) => {
    const motivos = T[idioma].guardias.cobertura_panel;
    for (const clave of [
      'motivo_modalidad_directa',
      'motivo_modalidad_marketplace',
      'motivo_modalidad_subcontratacion',
    ]) {
      expect(typeof motivos[clave], `falta ${clave} en ${idioma}`).toBe('string');
    }
  });
});
