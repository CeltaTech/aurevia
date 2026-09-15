import { describe, expect, it } from 'vitest';
import { PESTANAS, PESTANAS_COORDINADOR, pestanasDe } from '../pestanasDelAsistente';
import { T } from '../../i18n/translations';

const IDIOMAS = ['es-AR', 'en', 'pt-BR'];

describe('pestanasDelAsistente', () => {
  // Éste es el error que la prueba tiene que encontrar: agregar una pestaña y traducirla
  // después. La ficha mostraría un botón en blanco, y sólo en dos de los tres idiomas.
  it.each(IDIOMAS)('%s nombra todas las pestañas', (idioma) => {
    for (const pestana of PESTANAS) {
      const nombre = T[idioma].asistentes.tabs[pestana];
      expect(typeof nombre, `falta el nombre de ${pestana} en ${idioma}`).toBe('string');
      expect(nombre.length).toBeGreaterThan(0);
    }
  });

  it.each(IDIOMAS)('%s nombra los textos del historial de guardias', (idioma) => {
    const textos = T[idioma].asistentes.historial;
    for (const clave of [
      'col_fecha',
      'col_horario',
      'col_paciente',
      'col_registro',
      'col_situacion',
      'sin_registro',
      'vacio',
      'vacio_ayuda',
    ]) {
      expect(typeof textos[clave], `falta ${clave} en ${idioma}`).toBe('string');
      expect(textos[clave].length).toBeGreaterThan(0);
    }
    // Sin el hueco, el aviso diría que se muestran "las últimas guardias" sin decir cuántas, y
    // nadie sabría cuánto quedó afuera.
    expect(textos.tope).toContain('{n}');
  });

  it('el Coordinador no alcanza ninguna pestaña de datos laborales ni reservados', () => {
    for (const pestana of ['matriculas', 'vinculo_cese', 'simulador', 'score_riesgo']) {
      expect(PESTANAS_COORDINADOR).not.toContain(pestana);
    }
  });

  it('lo que ve el Coordinador es un subconjunto de lo que ve el Admin', () => {
    for (const pestana of PESTANAS_COORDINADOR) {
      expect(PESTANAS, `${pestana} no está en la lista completa`).toContain(pestana);
    }
  });

  it('ninguna pestaña está repetida', () => {
    expect(new Set(PESTANAS).size).toBe(PESTANAS.length);
    expect(new Set(PESTANAS_COORDINADOR).size).toBe(PESTANAS_COORDINADOR.length);
  });

  it('entrega una lista u otra según quién mira', () => {
    expect(pestanasDe(true)).toBe(PESTANAS);
    expect(pestanasDe(false)).toBe(PESTANAS_COORDINADOR);
  });
});
