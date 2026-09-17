import { describe, expect, it } from 'vitest';
import {
  REGLA_DE_LA_TOMA,
  TIPOS_DE_ALARMA,
  TIPOS_DE_ALARMA_POSIBLES,
  alarmasTomadas,
  esTipoDeAlarma,
  hastaCuandoDura,
  minutosQueLeQuedan,
  reglaDeLaTomaDe,
  revisarRegla,
  soloLoQueCorreDeLaRegla,
  tomaVigente,
} from '../alarmasTomadas';

const AHORA = new Date('2026-09-16T12:00:00Z');
const minutosDespues = (n) => new Date(AHORA.getTime() + n * 60_000).toISOString();
const minutosAntes = (n) => new Date(AHORA.getTime() - n * 60_000).toISOString();

describe('los tipos de alarma', () => {
  it('reconoce los cuatro y ninguno más', () => {
    expect(TIPOS_DE_ALARMA_POSIBLES).toHaveLength(4);
    for (const tipo of TIPOS_DE_ALARMA_POSIBLES) expect(esTipoDeAlarma(tipo)).toBe(true);
    expect(esTipoDeAlarma('incidente_inventado')).toBe(false);
    expect(esTipoDeAlarma(undefined)).toBe(false);
  });
});

describe('la regla de cuánto dura la toma', () => {
  it('sin configuración corren los valores de fábrica', () => {
    expect(reglaDeLaTomaDe(null)).toEqual(REGLA_DE_LA_TOMA);
    expect(reglaDeLaTomaDe({})).toEqual(REGLA_DE_LA_TOMA);
  });

  it('toma el valor que corrió la Prestadora', () => {
    expect(reglaDeLaTomaDe({ minutos_que_dura_hacerse_cargo: 30 }).minutos_que_dura_hacerse_cargo).toBe(30);
  });

  it('descarta lo que queda fuera de los bordes en vez de creerlo', () => {
    expect(reglaDeLaTomaDe({ minutos_que_dura_hacerse_cargo: 1 })).toEqual(REGLA_DE_LA_TOMA);
    expect(reglaDeLaTomaDe({ minutos_que_dura_hacerse_cargo: 99999 })).toEqual(REGLA_DE_LA_TOMA);
    expect(reglaDeLaTomaDe({ minutos_que_dura_hacerse_cargo: 'un rato' })).toEqual(REGLA_DE_LA_TOMA);
  });

  it('rechaza lo que llega de afuera fuera de los bordes, y lo que no conoce', () => {
    expect(revisarRegla({ minutos_que_dura_hacerse_cargo: 60 })).toEqual({ ok: true });
    expect(revisarRegla({ minutos_que_dura_hacerse_cargo: 4 }).ok).toBe(false);
    expect(revisarRegla({ minutos_que_dura_hacerse_cargo: 1441 }).ok).toBe(false);
    expect(revisarRegla({ minutos_inventados: 60 })).toEqual({ ok: false, clave: 'minutos_inventados' });
  });

  it('guarda sólo lo que corre respecto de los valores de fábrica', () => {
    expect(soloLoQueCorreDeLaRegla({ minutos_que_dura_hacerse_cargo: 60 })).toEqual({});
    expect(soloLoQueCorreDeLaRegla({ minutos_que_dura_hacerse_cargo: 30 })).toEqual({
      minutos_que_dura_hacerse_cargo: 30,
    });
  });
});

describe('si una toma sigue en pie', () => {
  it('la que vence más adelante, sí', () => {
    expect(tomaVigente({ tomada_at: minutosAntes(10), vence_at: minutosDespues(50) }, AHORA)).toBe(true);
  });

  it('la que ya venció, no', () => {
    expect(tomaVigente({ tomada_at: minutosAntes(70), vence_at: minutosAntes(10) }, AHORA)).toBe(false);
  });

  it('la que alguien soltó a mano, no, aunque le quedara rato', () => {
    expect(
      tomaVigente({ tomada_at: minutosAntes(10), vence_at: minutosDespues(50), soltada_at: minutosAntes(1) }, AHORA)
    ).toBe(false);
  });

  // La prueba que justifica el archivo: sin este recorte, quien apretara el botón podría dejar
  // muda una alarma un año entero mandando una fecha cualquiera.
  it('no le cree a una fecha de vencimiento imposible: la acota al rato que decidió la Prestadora', () => {
    const inventada = { tomada_at: minutosAntes(120), vence_at: minutosDespues(525_600) };
    expect(tomaVigente(inventada, AHORA)).toBe(false);
    expect(minutosQueLeQuedan(inventada, AHORA)).toBe(0);
  });

  it('una fila sin fechas o con fechas ilegibles no silencia nada', () => {
    expect(tomaVigente(null, AHORA)).toBe(false);
    expect(tomaVigente({ tomada_at: minutosAntes(10) }, AHORA)).toBe(false);
    expect(tomaVigente({ tomada_at: 'ayer', vence_at: 'mañana' }, AHORA)).toBe(false);
  });
});

describe('a qué alarmas alcanza una toma en pie', () => {
  it('devuelve los identificadores de las filas alarmadas, no los de las tomas', () => {
    const tomas = [
      { id: 't1', referencia_id: 'alarma-viva', tomada_at: minutosAntes(10), vence_at: minutosDespues(50) },
      { id: 't2', referencia_id: 'alarma-vencida', tomada_at: minutosAntes(70), vence_at: minutosAntes(10) },
    ];
    const tomadas = alarmasTomadas(tomas, AHORA);
    expect(tomadas.has('alarma-viva')).toBe(true);
    expect(tomadas.has('alarma-vencida')).toBe(false);
    expect(tomadas.has('t1')).toBe(false);
  });

  it('sin tomas no silencia ninguna', () => {
    expect(alarmasTomadas([], AHORA).size).toBe(0);
    expect(alarmasTomadas(null, AHORA).size).toBe(0);
  });
});

describe('cuánto le queda a una toma', () => {
  it('cuenta con la regla de esa Prestadora, no con la de fábrica', () => {
    const toma = { referencia_id: 'x', tomada_at: minutosAntes(20), vence_at: minutosDespues(40) };
    expect(minutosQueLeQuedan(toma, AHORA)).toBe(40);
    // Con media hora configurada, de esa toma queda lo que va de los veinte minutos ya corridos a
    // los treinta, y no los cuarenta que dice la fila.
    expect(minutosQueLeQuedan(toma, AHORA, { minutos_que_dura_hacerse_cargo: 30 })).toBe(10);
    // Y con quince, ya se venció aunque la fila diga otra cosa.
    expect(minutosQueLeQuedan(toma, AHORA, { minutos_que_dura_hacerse_cargo: 15 })).toBe(0);
  });

  it('hasta cuándo dura una que se toma ahora', () => {
    expect(hastaCuandoDura(AHORA).toISOString()).toBe(minutosDespues(60));
    expect(hastaCuandoDura(AHORA, { minutos_que_dura_hacerse_cargo: 15 }).toISOString()).toBe(minutosDespues(15));
  });
});

describe('las cuatro clases de alarma tienen nombre guardado propio', () => {
  it('no se repiten entre sí', () => {
    expect(new Set(Object.values(TIPOS_DE_ALARMA)).size).toBe(4);
  });
});
