import { describe, expect, it } from 'vitest';
import { diaDelMomento, diasDeEspera, hoyISO, sumarDias } from '../horarios';
import { T } from '../../i18n/translations';

describe('diaDelMomento', () => {
  // Éste es el error que la prueba tiene que encontrar: pasar una fecha que ya viene escrita como
  // día por `new Date`. En un huso de menos de cero —el de acá— eso la corre al día anterior, y la
  // pantalla diría que algo se autorizó un día antes de lo que dice la base.
  it('deja intacta una fecha que ya viene escrita como día', () => {
    expect(diaDelMomento('2026-08-01')).toBe('2026-08-01');
  });

  it('saca el día de un momento guardado', () => {
    expect(diaDelMomento('2026-08-01T15:30:00Z')).toBe('2026-08-01');
  });

  it('no inventa un día cuando no hay momento ni cuando el momento no se entiende', () => {
    expect(diaDelMomento(null)).toBeNull();
    expect(diaDelMomento('')).toBeNull();
    expect(diaDelMomento('cualquier cosa')).toBeNull();
  });
});

describe('diasDeEspera', () => {
  it('cuenta los días enteros entre las dos fechas', () => {
    expect(diasDeEspera('2026-08-01', '2026-08-04')).toBe(3);
  });

  it('el mismo día es cero', () => {
    expect(diasDeEspera('2026-08-04', '2026-08-04')).toBe(0);
  });

  // Algo anotado con fecha de mañana lleva esperando cero días, no menos uno: un número negativo
  // en la pantalla se leería como un error del sistema y no como lo que es.
  it('nunca da negativo', () => {
    expect(diasDeEspera('2026-08-10', '2026-08-04')).toBe(0);
  });

  it('cuenta igual desde un momento guardado que desde un día escrito', () => {
    expect(diasDeEspera('2026-08-01T23:50:00', '2026-08-02')).toBe(1);
  });

  it('sin una de las dos fechas no inventa una cuenta', () => {
    expect(diasDeEspera(null, '2026-08-04')).toBeNull();
    expect(diasDeEspera('2026-08-04', null)).toBeNull();
  });

  // Sin fecha de hasta cuenta contra hoy, que es como la usan las pantallas.
  it('cuenta contra hoy cuando no se le dice hasta cuándo', () => {
    expect(diasDeEspera(sumarDias(hoyISO(), -5))).toBe(5);
  });
});

const IDIOMAS = ['es-AR', 'en', 'pt-BR'];

// Las tres formas que devuelve `diasDeEspera` —cero, uno y varios— se dicen con tres textos
// distintos, porque «Abierta hace 1 días» está mal escrito en los tres idiomas. Si falta alguno,
// la tarjeta de la excepción muestra un renglón en blanco justo en el dato que dice cuál mirar
// primero.
describe('los textos de las excepciones de familiar', () => {
  it.each(IDIOMAS)('%s nombra las tres formas de decir cuánto lleva abierta', (idioma) => {
    const textos = T[idioma].continuidad;
    for (const clave of [
      'excepciones_titulo',
      'excepciones_explicacion',
      'excepciones_vacio',
      'excepciones_col_familiar',
      'excepciones_col_desde',
      'excepciones_abierta_hoy',
      'excepciones_abierta_un_dia',
      'excepciones_abierta_dias',
      'excepciones_cerrar',
      'excepciones_confirmar_cerrar',
    ]) {
      expect(typeof textos[clave], `falta ${clave} en ${idioma}`).toBe('string');
      expect(textos[clave].length).toBeGreaterThan(0);
    }
    // Sin el hueco, la tarjeta diría que está abierta hace días sin decir cuántos.
    expect(textos.excepciones_abierta_dias).toContain('{n}');
  });
});
