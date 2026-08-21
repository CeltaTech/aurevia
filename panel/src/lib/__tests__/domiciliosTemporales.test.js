import { describe, expect, it } from 'vitest';
import { conMotivoDeDomicilioTemporal } from '../domiciliosTemporales';
import { mensajeDeError } from '../errores';
import { T } from '../../i18n/translations';

// Los dos errores tal como los devuelve Supabase cuando la base frena la carga. El texto
// está copiado de lo que contesta la base local, no inventado.
const PERIODO_PISADO = {
  code: '23P01',
  message:
    'conflicting key value violates exclusion constraint "domicilios_temp_sin_superposicion"',
  details: 'Key (paciente_id, daterange(fecha_inicio, COALESCE(fecha_fin, \'infinity\'::date), \'[]\'))=(…) conflicts with existing key (…).',
  hint: null,
};

const FECHAS_AL_REVES = {
  code: '23514',
  message:
    'new row for relation "domicilios_temporales_paciente" violates check constraint "domicilios_temp_fechas_coherentes"',
  details: 'Failing row contains (…).',
  hint: null,
};

describe('conMotivoDeDomicilioTemporal', () => {
  it('reconoce un período que se pisa con otro', () => {
    expect(conMotivoDeDomicilioTemporal(PERIODO_PISADO).motivo).toBe('domicilio_temporal_pisado');
  });

  it('reconoce las fechas al revés', () => {
    expect(conMotivoDeDomicilioTemporal(FECHAS_AL_REVES).motivo).toBe('domicilio_temporal_fechas_al_reves');
  });

  it('deja pasar sin tocar lo que no reconoce', () => {
    const otro = { code: '23505', message: 'duplicate key value violates unique constraint "otra_cosa"' };
    expect(conMotivoDeDomicilioTemporal(otro)).toBe(otro);
    expect(conMotivoDeDomicilioTemporal(null)).toBe(null);
    expect(conMotivoDeDomicilioTemporal('texto suelto')).toBe('texto suelto');
  });
});

describe('la frase que termina leyendo una persona', () => {
  for (const idioma of Object.keys(T)) {
    it(`explica el período pisado en ${idioma}, sin texto técnico`, () => {
      const frase = mensajeDeError(conMotivoDeDomicilioTemporal(PERIODO_PISADO), T[idioma]);
      expect(frase).toBe(T[idioma].errores.motivos.domicilio_temporal_pisado);
      expect(frase).not.toMatch(/constraint|domicilios_temp/);
    });

    it(`explica las fechas al revés en ${idioma}, sin texto técnico`, () => {
      const frase = mensajeDeError(conMotivoDeDomicilioTemporal(FECHAS_AL_REVES), T[idioma]);
      expect(frase).toBe(T[idioma].errores.motivos.domicilio_temporal_fechas_al_reves);
      expect(frase).not.toMatch(/constraint|domicilios_temp/);
    });
  }
});
