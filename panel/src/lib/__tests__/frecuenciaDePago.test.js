/**
 * Cada cuánto cobra cada Asistente, y qué período se le arma.
 *
 *   npx vitest run src/lib/__tests__/frecuenciaDePago.test.js
 *
 * POR QUÉ EXISTE. De acá salen los bordes de cada liquidación. Un borde mal puesto no se ve
 * en la pantalla: se ve un mes después, cuando alguien cobra dos veces la misma guardia o no
 * cobra una que hizo. Por eso la prueba que más importa no es ninguna de las obvias sino la
 * última: que recorriendo un año entero, día por día, cada día caiga en exactamente un
 * período. Eso es lo que nadie puede verificar a ojo.
 *
 * Qué daría con el sistema roto: un `+ 1` de más en el corte semanal deja un día afuera y la
 * cobertura falla; partir la quincena por días corridos en vez de por el número del día
 * desfasa los períodos y también falla.
 */
import { describe, expect, it } from 'vitest';
import {
  DIAS_DE_LA_SEMANA,
  FRECUENCIAS,
  FRECUENCIA_DE_PAGO,
  diaDeLaSemanaDe,
  diasDelMesDelPeriodo,
  fechaDePagoDe,
  frecuenciaDePagoDe,
  periodoQueContiene,
  periodoSiguienteA,
  periodosQueTocan,
  revisarFrecuenciaDePago,
  soloLoQueCorreDeLaFrecuencia,
  ultimoDiaDelMesDe,
} from '../frecuenciaDePago';

const POR_SEMANA = { cada_cuanto: FRECUENCIAS.SEMANA, dia_de_corte: DIAS_DE_LA_SEMANA.VIERNES };
const POR_QUINCENA = { cada_cuanto: FRECUENCIAS.QUINCENA };
const POR_MES = { cada_cuanto: FRECUENCIAS.MES };

describe('lo que sale de fábrica', () => {
  it('es el mes calendario pagado al cierre, que es lo que el sistema hacía hasta ahora', () => {
    expect(FRECUENCIA_DE_PAGO.cada_cuanto).toBe(FRECUENCIAS.MES);
    expect(FRECUENCIA_DE_PAGO.dias_hasta_el_pago).toBe(0);
    expect(periodoQueContiene('2026-02-17', {})).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' });
  });

  it('febrero de un año bisiesto termina el 29', () => {
    expect(ultimoDiaDelMesDe('2028-02-03')).toBe('2028-02-29');
  });
});

describe('el período por mes', () => {
  it('va del primero al último día', () => {
    expect(periodoQueContiene('2026-09-17', POR_MES)).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' });
  });

  it('el último día del mes todavía es de ese mes', () => {
    expect(periodoQueContiene('2026-09-30', POR_MES).desde).toBe('2026-09-01');
  });
});

describe('el período por quincena', () => {
  it('el día 15 cierra la primera', () => {
    expect(periodoQueContiene('2026-09-15', POR_QUINCENA)).toEqual({ desde: '2026-09-01', hasta: '2026-09-15' });
  });

  it('el día 16 abre la segunda, que termina con el mes', () => {
    expect(periodoQueContiene('2026-09-16', POR_QUINCENA)).toEqual({ desde: '2026-09-16', hasta: '2026-09-30' });
  });

  it('las dos mitades caen siempre en el mismo lugar, mes tras mes', () => {
    // Si se partiera cada quince días corridos, esto se iría desfasando y en diciembre las
    // quincenas no coincidirían con ningún día redondo del calendario.
    for (const mes of ['2026-01', '2026-02', '2026-07', '2026-12']) {
      expect(periodoQueContiene(`${mes}-15`, POR_QUINCENA).hasta).toBe(`${mes}-15`);
      expect(periodoQueContiene(`${mes}-16`, POR_QUINCENA).desde).toBe(`${mes}-16`);
    }
  });
});

describe('el período por semana', () => {
  it('con corte el viernes, va de sábado a viernes', () => {
    // El 2026-09-18 es viernes.
    expect(diaDeLaSemanaDe('2026-09-18')).toBe(DIAS_DE_LA_SEMANA.VIERNES);
    expect(periodoQueContiene('2026-09-18', POR_SEMANA)).toEqual({ desde: '2026-09-12', hasta: '2026-09-18' });
  });

  it('el mismo día de corte cierra su propia semana, no abre la siguiente', () => {
    expect(periodoQueContiene('2026-09-18', POR_SEMANA).hasta).toBe('2026-09-18');
    expect(periodoQueContiene('2026-09-19', POR_SEMANA).hasta).toBe('2026-09-25');
  });

  it('el corte lo elige la Prestadora: con domingo, la semana es otra', () => {
    const conDomingo = { cada_cuanto: FRECUENCIAS.SEMANA, dia_de_corte: DIAS_DE_LA_SEMANA.DOMINGO };
    expect(periodoQueContiene('2026-09-18', conDomingo)).toEqual({ desde: '2026-09-14', hasta: '2026-09-20' });
  });

  it('una semana cruza el fin de mes sin partirse', () => {
    const periodo = periodoQueContiene('2026-10-02', POR_SEMANA);
    expect(periodo).toEqual({ desde: '2026-09-26', hasta: '2026-10-02' });
  });
});

describe('cuándo sale la plata', () => {
  it('sin plazo, el mismo día que cierra el período', () => {
    expect(fechaDePagoDe({ desde: '2026-09-01', hasta: '2026-09-30' }, POR_MES)).toBe('2026-09-30');
  });

  it('a treinta días, treinta días después del cierre', () => {
    const a30 = { cada_cuanto: FRECUENCIAS.MES, dias_hasta_el_pago: 30 };
    expect(fechaDePagoDe({ desde: '2026-09-01', hasta: '2026-09-30' }, a30)).toBe('2026-10-30');
  });
});

describe('las tres capas', () => {
  it('lo de la persona pisa lo de la Prestadora, y lo de la Prestadora pisa fábrica', () => {
    const regla = frecuenciaDePagoDe({ cada_cuanto: FRECUENCIAS.QUINCENA, dias_hasta_el_pago: 10 }, { cada_cuanto: FRECUENCIAS.SEMANA });
    expect(regla.cada_cuanto).toBe(FRECUENCIAS.SEMANA);
    // El plazo de la Prestadora se conserva: la persona no lo tocó.
    expect(regla.dias_hasta_el_pago).toBe(10);
    expect(regla.dia_de_corte).toBe(FRECUENCIA_DE_PAGO.dia_de_corte);
  });

  it('sin nada arreglado con nadie, rige lo de fábrica', () => {
    expect(frecuenciaDePagoDe(null, null)).toEqual(FRECUENCIA_DE_PAGO);
    expect(frecuenciaDePagoDe({}, {})).toEqual(FRECUENCIA_DE_PAGO);
  });

  it('un valor guardado fuera de borde se ignora y vale el de fábrica', () => {
    // Que una liquidación no se pueda generar es peor que una que sale con el valor de fábrica.
    expect(frecuenciaDePagoDe({ cada_cuanto: 'cada_luna_llena' }).cada_cuanto).toBe(FRECUENCIA_DE_PAGO.cada_cuanto);
    expect(frecuenciaDePagoDe({ dia_de_corte: 0 }).dia_de_corte).toBe(FRECUENCIA_DE_PAGO.dia_de_corte);
    expect(frecuenciaDePagoDe({ dias_hasta_el_pago: 400 }).dias_hasta_el_pago).toBe(0);
  });
});

describe('lo que se puede guardar', () => {
  it('cada borde deja pasar sus dos extremos y rechaza lo de afuera', () => {
    expect(revisarFrecuenciaDePago({ dia_de_corte: 1 }).ok).toBe(true);
    expect(revisarFrecuenciaDePago({ dia_de_corte: 7 }).ok).toBe(true);
    expect(revisarFrecuenciaDePago({ dia_de_corte: 8 })).toEqual({ ok: false, clave: 'dia_de_corte' });
    expect(revisarFrecuenciaDePago({ dias_hasta_el_pago: 0 }).ok).toBe(true);
    expect(revisarFrecuenciaDePago({ dias_hasta_el_pago: 91 }).ok).toBe(false);
  });

  it('una clave que nadie puede tocar se rechaza', () => {
    expect(revisarFrecuenciaDePago({ lo_que_sea: 3 })).toEqual({ ok: false, clave: 'lo_que_sea' });
  });

  it('guardar sin tocar nada no congela ningún valor de fábrica', () => {
    expect(soloLoQueCorreDeLaFrecuencia({ ...FRECUENCIA_DE_PAGO })).toEqual({});
  });

  it('se guarda solamente lo que se corrió', () => {
    expect(soloLoQueCorreDeLaFrecuencia({ ...FRECUENCIA_DE_PAGO, dias_hasta_el_pago: 30 }))
      .toEqual({ dias_hasta_el_pago: 30 });
  });
});

describe('recorrer los períodos', () => {
  it('el siguiente empieza el día después de que termina el anterior', () => {
    const uno = periodoQueContiene('2026-09-18', POR_SEMANA);
    const dos = periodoSiguienteA(uno, POR_SEMANA);
    expect(dos.desde).toBe('2026-09-19');
    expect(dos.hasta).toBe('2026-09-25');
  });

  it('un mes cualquiera tiene dos quincenas', () => {
    expect(periodosQueTocan('2026-09-01', '2026-09-30', POR_QUINCENA)).toEqual([
      { desde: '2026-09-01', hasta: '2026-09-15' },
      { desde: '2026-09-16', hasta: '2026-09-30' },
    ]);
  });

  it('un tramo al revés no devuelve nada, en vez de girar sin fin', () => {
    expect(periodosQueTocan('2026-09-30', '2026-09-01', POR_MES)).toEqual([]);
  });
});

describe('que ningún día quede sin período ni en dos', () => {
  // Ésta es la prueba que no se puede hacer a ojo, y la única que atrapa un borde corrido por
  // un día: una guardia en un día que cae en dos períodos se paga dos veces.
  const recorrerElAnio = (frecuencia) => {
    const vistos = new Map();
    for (let dia = new Date(Date.UTC(2026, 0, 1)); dia < new Date(Date.UTC(2027, 0, 1)); dia.setUTCDate(dia.getUTCDate() + 1)) {
      const fecha = dia.toISOString().slice(0, 10);
      const periodo = periodoQueContiene(fecha, frecuencia);
      expect(periodo.desde <= fecha && fecha <= periodo.hasta).toBe(true);
      vistos.set(fecha, `${periodo.desde}|${periodo.hasta}`);
    }
    return vistos;
  };

  for (const [nombre, frecuencia] of [['por mes', POR_MES], ['por quincena', POR_QUINCENA], ['por semana', POR_SEMANA]]) {
    it(`${nombre}: los 365 días de 2026 caen en un período, y en uno solo`, () => {
      const vistos = recorrerElAnio(frecuencia);
      expect(vistos.size).toBe(365);
      // Y los períodos que salieron encajan sin huecos: ordenados, cada uno empieza justo
      // donde terminó el anterior.
      const distintos = [...new Set(vistos.values())].map((t) => t.split('|')).sort();
      for (let i = 1; i < distintos.length; i += 1) {
        const anterior = new Date(`${distintos[i - 1][1]}T00:00:00Z`);
        anterior.setUTCDate(anterior.getUTCDate() + 1);
        expect(distintos[i][0]).toBe(anterior.toISOString().slice(0, 10));
      }
    });
  }
});

describe('el sueldo mensual cobrado por semana', () => {
  it('se mide contra los días del mes, no contra los del período', () => {
    // Si se midiera contra los del período, una semana daría 7/7 y se pagaría el sueldo
    // entero cada semana: cuatro sueldos por mes.
    expect(diasDelMesDelPeriodo({ desde: '2026-09-12', hasta: '2026-09-18' })).toBe(30);
    expect(diasDelMesDelPeriodo({ desde: '2026-02-02', hasta: '2026-02-08' })).toBe(28);
  });

  it('las semanas de un mes suman el sueldo entero, no más', () => {
    // Treinta días de septiembre repartidos en semanas de siete: la suma de las partes tiene
    // que dar uno, que es un sueldo. El último período cruza a octubre y su parte se recorta,
    // porque lo que se paga son los días del mes que caen adentro.
    const periodos = periodosQueTocan('2026-09-01', '2026-09-30', POR_SEMANA);
    const diasDeSeptiembre = (p) => {
      const desde = p.desde < '2026-09-01' ? '2026-09-01' : p.desde;
      const hasta = p.hasta > '2026-09-30' ? '2026-09-30' : p.hasta;
      return (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86400000 + 1;
    };
    const total = periodos.reduce((suma, p) => suma + diasDeSeptiembre(p) / 30, 0);
    expect(total).toBeCloseTo(1, 10);
  });
});
