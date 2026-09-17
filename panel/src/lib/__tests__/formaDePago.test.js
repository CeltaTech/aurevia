/**
 * Que la cuenta de lo que se le paga a cada Asistente dé lo que tiene que dar.
 *
 *   npx vitest run src/lib/__tests__/formaDePago.test.js
 *
 * POR QUÉ EXISTE. De acá sale el importe que cobra una persona. Un error de un día en el conteo
 * es un día de trabajo que no se paga, y un valor que se lee como cero cuando en realidad está
 * sin cargar es una liquidación de cero pesos emitida sin que nadie note nada.
 */
import { describe, expect, it } from 'vitest';
import {
  COLUMNA_DEL_VALOR,
  DIAS_DE_UNA_SEMANA,
  REGLA_DE_PAGO,
  UNIDADES,
  diasCubiertos,
  diasEntre,
  esMontoFijo,
  reglaDePagoDe,
  revisarReglaDePago,
  soloLoQueCorreDelPago,
  unidadDeMedicionDe,
  unidadesDelPeriodo,
  valorDeLaHoraExtra,
  valorDeLaUnidad,
} from '../formaDePago';

describe('con qué se le mide el trabajo a cada persona', () => {
  it('usa la unidad que se eligió en la ficha', () => {
    expect(unidadDeMedicionDe({ unidad_medicion: 'guardia', tipo_vinculo: 'dependencia' })).toBe(UNIDADES.GUARDIA);
  });

  it('a una ficha vieja le deduce la unidad del vínculo, como hacía el sistema antes', () => {
    expect(unidadDeMedicionDe({ tipo_vinculo: 'dependencia' })).toBe(UNIDADES.MES);
    expect(unidadDeMedicionDe({ tipo_vinculo: 'monotributo' })).toBe(UNIDADES.HORA);
  });

  it('ante un vínculo que no conoce, mide por hora', () => {
    expect(unidadDeMedicionDe({ tipo_vinculo: 'lo_que_sea' })).toBe(UNIDADES.HORA);
    expect(unidadDeMedicionDe(null)).toBe(UNIDADES.HORA);
  });

  it('descarta una unidad inventada y vuelve a deducirla', () => {
    expect(unidadDeMedicionDe({ unidad_medicion: 'quincena', tipo_vinculo: 'dependencia' })).toBe(UNIDADES.MES);
  });

  it('el monto fijo es el de semana y el de mes, no el de hora ni el de guardia', () => {
    expect(esMontoFijo(UNIDADES.MES)).toBe(true);
    expect(esMontoFijo(UNIDADES.SEMANA)).toBe(true);
    expect(esMontoFijo(UNIDADES.HORA)).toBe(false);
    expect(esMontoFijo(UNIDADES.GUARDIA)).toBe(false);
  });
});

describe('cuánto vale una unidad', () => {
  it('busca el valor en la columna que le corresponde a esa unidad', () => {
    const pago = { valor_hora: 100, valor_guardia: 200, valor_semana: 300, sueldo_basico: 400 };
    expect(valorDeLaUnidad(pago, UNIDADES.HORA)).toBe(100);
    expect(valorDeLaUnidad(pago, UNIDADES.GUARDIA)).toBe(200);
    expect(valorDeLaUnidad(pago, UNIDADES.SEMANA)).toBe(300);
    expect(valorDeLaUnidad(pago, UNIDADES.MES)).toBe(400);
  });

  // No sabemos cuánto cobra y no le pagamos nada son dos cosas distintas, y de la diferencia
  // depende que la liquidación se frene o salga en cero.
  it('devuelve nada cuando el valor no está cargado, y cero cuando el cero está cargado', () => {
    expect(valorDeLaUnidad({}, UNIDADES.HORA)).toBeNull();
    expect(valorDeLaUnidad({ valor_hora: null }, UNIDADES.HORA)).toBeNull();
    expect(valorDeLaUnidad({ valor_hora: '' }, UNIDADES.HORA)).toBeNull();
    expect(valorDeLaUnidad({ valor_hora: 0 }, UNIDADES.HORA)).toBe(0);
  });

  it('convierte el texto que devuelve la base en número', () => {
    expect(valorDeLaUnidad({ valor_hora: '1500.50' }, UNIDADES.HORA)).toBe(1500.5);
  });

  it('la hora extra sigue la misma regla', () => {
    expect(valorDeLaHoraExtra({ valor_hora_extra: '2000' })).toBe(2000);
    expect(valorDeLaHoraExtra({})).toBeNull();
  });

  it('cada unidad tiene su columna y ninguna comparte con otra', () => {
    const columnas = Object.values(COLUMNA_DEL_VALOR);
    expect(new Set(columnas).size).toBe(columnas.length);
  });
});

describe('cuántos días', () => {
  it('cuenta los dos extremos', () => {
    expect(diasEntre('2026-03-01', '2026-03-31')).toBe(31);
    expect(diasEntre('2026-03-10', '2026-03-10')).toBe(1);
  });

  it('cuenta bien el mes de febrero de un año bisiesto', () => {
    expect(diasEntre('2028-02-01', '2028-02-29')).toBe(29);
  });

  // El cambio de hora de verano corre el reloj sesenta minutos: una resta hecha en hora local
  // daría 30,96 días donde hay 31, y ese resto se convierte en plata al multiplicarlo.
  it('no se mueve con el cambio de hora', () => {
    expect(diasEntre('2026-10-01', '2026-10-31')).toBe(31);
    expect(diasEntre('2026-03-01', '2026-03-31')).toBe(31);
  });

  it('una fecha final anterior a la inicial no da días negativos', () => {
    expect(diasEntre('2026-03-31', '2026-03-01')).toBe(0);
  });
});

describe('cuántos días del período estuvo la persona', () => {
  const PERIODO = { desde: '2026-03-01', hasta: '2026-03-31' };

  it('sin prorrateo, el período entero aunque haya entrado a mitad de mes', () => {
    expect(diasCubiertos({ ...PERIODO, fechaAlta: '2026-03-16', prorratear: false })).toBe(31);
  });

  it('con prorrateo, desde el día en que entró', () => {
    expect(diasCubiertos({ ...PERIODO, fechaAlta: '2026-03-16', prorratear: true })).toBe(16);
  });

  it('con prorrateo, hasta el día en que se fue', () => {
    expect(diasCubiertos({ ...PERIODO, fechaBaja: '2026-03-10', prorratear: true })).toBe(10);
  });

  it('una persona que entró antes y sigue trabajando cubre el período entero', () => {
    expect(diasCubiertos({ ...PERIODO, fechaAlta: '2025-01-01', fechaBaja: null, prorratear: true })).toBe(31);
  });

  it('quien entró y se fue dentro del mismo período cobra sólo ese tramo', () => {
    expect(diasCubiertos({ ...PERIODO, fechaAlta: '2026-03-10', fechaBaja: '2026-03-14', prorratear: true })).toBe(5);
  });
});

describe('cuántas unidades se pagan en el período', () => {
  const MARZO = { diasDelPeriodo: 31, diasDeLaPersona: 31 };

  it('por hora, las horas que hizo', () => {
    expect(unidadesDelPeriodo({ unidad: UNIDADES.HORA, acumulado: { horas: 176, guardias: 22 }, ...MARZO })).toBe(176);
  });

  it('por guardia, las guardias que hizo', () => {
    expect(unidadesDelPeriodo({ unidad: UNIDADES.GUARDIA, acumulado: { horas: 176, guardias: 22 }, ...MARZO })).toBe(22);
  });

  it('sin nada acumulado, cero: no se le paga por lo que no hizo', () => {
    expect(unidadesDelPeriodo({ unidad: UNIDADES.HORA, acumulado: null, ...MARZO })).toBe(0);
    expect(unidadesDelPeriodo({ unidad: UNIDADES.GUARDIA, acumulado: {}, ...MARZO })).toBe(0);
  });

  it('por mes, el período entero es uno', () => {
    expect(unidadesDelPeriodo({ unidad: UNIDADES.MES, ...MARZO })).toBe(1);
  });

  it('por mes, media persona a mitad de mes', () => {
    expect(
      unidadesDelPeriodo({ unidad: UNIDADES.MES, diasDelPeriodo: 30, diasDeLaPersona: 15 })
    ).toBe(0.5);
  });

  it('por semana, los días divididos por siete', () => {
    expect(unidadesDelPeriodo({ unidad: UNIDADES.SEMANA, diasDelPeriodo: 28, diasDeLaPersona: 28 })).toBe(4);
    expect(unidadesDelPeriodo({ unidad: UNIDADES.SEMANA, diasDelPeriodo: 31, diasDeLaPersona: 31 }))
      .toBe(31 / DIAS_DE_UNA_SEMANA);
  });

  // Dividir por cero da infinito, y un infinito multiplicado por el sueldo sale impreso.
  it('un período sin días no explota', () => {
    expect(unidadesDelPeriodo({ unidad: UNIDADES.MES, diasDelPeriodo: 0, diasDeLaPersona: 0 })).toBe(0);
  });
});

describe('la regla que cada Prestadora puede correr', () => {
  it('sin fila guardada rige la de fábrica', () => {
    expect(reglaDePagoDe(undefined)).toEqual(REGLA_DE_PAGO);
    expect(reglaDePagoDe({})).toEqual(REGLA_DE_PAGO);
  });

  it('lo que la Prestadora corrió pisa a lo de fábrica', () => {
    expect(reglaDePagoDe({ prorratear_monto_fijo: false }).prorratear_monto_fijo).toBe(false);
  });

  it('un valor que no es booleano no se toma, y una clave desconocida no entra', () => {
    expect(reglaDePagoDe({ prorratear_monto_fijo: 'no' }).prorratear_monto_fijo).toBe(true);
    expect(reglaDePagoDe({ inventada: true }).inventada).toBeUndefined();
  });

  it('rechaza antes de guardar lo que no puede guardarse, y dice qué clave es', () => {
    expect(revisarReglaDePago({ prorratear_monto_fijo: false })).toEqual({ ok: true });
    expect(revisarReglaDePago({})).toEqual({ ok: true });
    expect(revisarReglaDePago({ prorratear_monto_fijo: 'si' })).toEqual({ ok: false, clave: 'prorratear_monto_fijo' });
    expect(revisarReglaDePago({ inventada: true })).toEqual({ ok: false, clave: 'inventada' });
  });

  // Guardar lo que coincide con fábrica congelaría a esa Prestadora el día que el valor de
  // fábrica cambie: quedaría con el viejo sin haber decidido nada.
  it('guarda solamente lo que difiere de fábrica', () => {
    expect(soloLoQueCorreDelPago({ prorratear_monto_fijo: true })).toEqual({});
    expect(soloLoQueCorreDelPago({ prorratear_monto_fijo: false })).toEqual({ prorratear_monto_fijo: false });
    expect(soloLoQueCorreDelPago({ inventada: 1 })).toEqual({});
    expect(soloLoQueCorreDelPago(null)).toEqual({});
  });

  it('lo que sale de guardar vuelve a entrar igual', () => {
    const corridos = soloLoQueCorreDelPago({ prorratear_monto_fijo: false });
    expect(reglaDePagoDe(corridos).prorratear_monto_fijo).toBe(false);
  });
});
