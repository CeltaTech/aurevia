import { describe, expect, it } from 'vitest';
import {
  DIAS_DE_HORIZONTE,
  documentacionPorAsistente,
  guardiasActivasPorAsistente,
} from '../resumenDelPlantel';
import { ESTADO_VENCIMIENTO } from '../reglaVencimientos';
import { T } from '../../i18n/translations';

const IDIOMAS = ['es-AR', 'en', 'pt-BR'];

// Datos inventados: ninguna persona real entra en una prueba (CLAUDE.md §6).
const AHORA = new Date('2026-09-15T10:00:00');

const guardia = (extra) => ({
  asistente_id: 'a',
  fecha: '2026-09-20',
  hora_inicio: '08:00',
  hora_fin: '16:00',
  estado: 'programada',
  ...extra,
});

describe('guardiasActivasPorAsistente', () => {
  it('cuenta las guardias de cada Asistente por separado', () => {
    const cuenta = guardiasActivasPorAsistente(
      [guardia({}), guardia({}), guardia({ asistente_id: 'b' })],
      { ahora: AHORA },
    );
    expect(cuenta.get('a')).toBe(2);
    expect(cuenta.get('b')).toBe(1);
  });

  // Lo que ya terminó no espera nada de nadie, así que no es una guardia activa.
  it('no cuenta la completada ni la cancelada', () => {
    const cuenta = guardiasActivasPorAsistente(
      [guardia({ estado: 'completada' }), guardia({ estado: 'cancelada' })],
      { ahora: AHORA },
    );
    expect(cuenta.has('a')).toBe(false);
  });

  // La ausente sí cuenta: alguien tiene que cubrir ese turno.
  it('cuenta la ausente, porque todavía espera algo', () => {
    const cuenta = guardiasActivasPorAsistente([guardia({ estado: 'ausente' })], { ahora: AHORA });
    expect(cuenta.get('a')).toBe(1);
  });

  it('no cuenta la guardia que no tiene Asistente', () => {
    const cuenta = guardiasActivasPorAsistente([guardia({ asistente_id: null })], { ahora: AHORA });
    expect(cuenta.size).toBe(0);
  });

  it('no se cae sin guardias', () => {
    expect(guardiasActivasPorAsistente(undefined).size).toBe(0);
    expect(guardiasActivasPorAsistente(null).size).toBe(0);
  });

  it('el horizonte es un mes, y es un número, no un texto', () => {
    expect(DIAS_DE_HORIZONTE).toBe(30);
  });
});

const papel = (extra) => ({
  asistente_id: 'a',
  fecha_vencimiento: '2026-12-31',
  tipos_documento_asistente: { requiere_vencimiento: true },
  ...extra,
});

describe('documentacionPorAsistente', () => {
  it('muestra el papel que peor está, no el promedio', () => {
    const estados = documentacionPorAsistente(
      [papel({}), papel({ fecha_vencimiento: '2026-09-01' })],
      30,
      AHORA,
    );
    expect(estados.get('a')).toBe(ESTADO_VENCIMIENTO.VENCIDO);
  });

  it('distingue vigente, por vencer y vencido', () => {
    const estados = documentacionPorAsistente(
      [
        papel({ asistente_id: 'lejos', fecha_vencimiento: '2027-06-01' }),
        papel({ asistente_id: 'cerca', fecha_vencimiento: '2026-09-25' }),
        papel({ asistente_id: 'paso', fecha_vencimiento: '2026-08-01' }),
      ],
      30,
      AHORA,
    );
    expect(estados.get('lejos')).toBe(ESTADO_VENCIMIENTO.VIGENTE);
    expect(estados.get('cerca')).toBe(ESTADO_VENCIMIENTO.POR_VENCER);
    expect(estados.get('paso')).toBe(ESTADO_VENCIMIENTO.VENCIDO);
  });

  it('respeta la ventana de aviso que configuró la Prestadora', () => {
    const papeles = [papel({ fecha_vencimiento: '2026-10-20' })];
    expect(documentacionPorAsistente(papeles, 30, AHORA).get('a')).toBe(
      ESTADO_VENCIMIENTO.VIGENTE,
    );
    expect(documentacionPorAsistente(papeles, 60, AHORA).get('a')).toBe(
      ESTADO_VENCIMIENTO.POR_VENCER,
    );
  });

  // Que no haya nada que vencer no es lo mismo que tener todo al día: se deja afuera del mapa
  // para que la pantalla diga otra cosa, en vez de afirmar algo que ninguna fila dice.
  it('deja afuera a quien no tiene ningún papel con vencimiento', () => {
    const estados = documentacionPorAsistente([papel({ fecha_vencimiento: null })], 30, AHORA);
    expect(estados.has('a')).toBe(false);
  });

  it('no mira el papel de un tipo que no vence', () => {
    const estados = documentacionPorAsistente(
      [papel({ tipos_documento_asistente: { requiere_vencimiento: false } })],
      30,
      AHORA,
    );
    expect(estados.has('a')).toBe(false);
  });

  // El tipo puede no haber venido en la consulta. La fecha sí está cargada, así que manda ella:
  // descartar el papel por un dato que no se pidió sería esconder un vencimiento.
  it('cuenta el papel aunque no haya venido su tipo', () => {
    const estados = documentacionPorAsistente(
      [papel({ tipos_documento_asistente: null, fecha_vencimiento: '2026-08-01' })],
      30,
      AHORA,
    );
    expect(estados.get('a')).toBe(ESTADO_VENCIMIENTO.VENCIDO);
  });

  it('no se cae sin papeles', () => {
    expect(documentacionPorAsistente(undefined).size).toBe(0);
  });
});

describe('los textos de la lista existen en los tres idiomas', () => {
  it.each(IDIOMAS)('%s nombra las columnas nuevas y los tres estados', (idioma) => {
    const textos = T[idioma].asistentes;
    for (const clave of [
      'col_especialidades',
      'col_guardias_activas',
      'col_documentacion',
      'documentacion_sin_papeles',
    ]) {
      expect(typeof textos[clave], `falta ${clave} en ${idioma}`).toBe('string');
      expect(textos[clave].length).toBeGreaterThan(0);
    }
    for (const estado of Object.values(ESTADO_VENCIMIENTO)) {
      expect(typeof textos[`documentacion_${estado}`], `falta ${estado} en ${idioma}`).toBe(
        'string',
      );
    }
    // El hueco tiene que estar escrito, o la pantalla mostraría la cantidad de días en ninguna
    // parte y nadie sabría de qué período habla el número.
    expect(textos.col_guardias_activas).toContain('{dias}');
  });
});
