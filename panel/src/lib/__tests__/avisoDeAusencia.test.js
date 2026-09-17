/**
 * Que el sistema distinga avisar con tiempo de faltar de golpe.
 *
 *   npx vitest run src/lib/__tests__/avisoDeAusencia.test.js
 *
 * POR QUÉ EXISTE. De esta cuenta sale si la Coordinadora recibe una tarea para cuando pueda o una
 * alarma para ahora mismo. Equivocarla en un sentido llena la pantalla de urgencias falsas y la
 * vuelve ruido; equivocarla en el otro deja pasar en silencio un turno que empieza en dos horas.
 */
import { describe, expect, it } from 'vitest';
import {
  COMO_LLEGO,
  REGLA_DE_AVISO_DE_AUSENCIA,
  REGLA_QUE_SE_PUEDE_TOCAR,
  comoLlegoLaAusencia,
  cuandoSeSupo,
  reglaDeAvisoDe,
  revisarRegla,
  soloLoQueCorreDeLaRegla,
  turnosQueDejaSinNadie,
} from '../avisoDeAusencia';

const ASISTENTE = 'asistente-1';

/** Una ausencia abierta que empieza el día indicado y que se supo en el momento indicado. */
function ausencia({ desde = '2026-03-10', hasta = null, supo = '2026-03-09T10:00:00', ...resto } = {}) {
  return {
    asistente_id: ASISTENTE,
    fecha_inicio: desde,
    fecha_fin: hasta,
    avisada_en: supo,
    ...resto,
  };
}

/** Un turno de esa persona. */
function turno({ fecha = '2026-03-10', hora = '08:00:00', ...resto } = {}) {
  return {
    id: `${fecha}-${hora}`,
    asistente_id: ASISTENTE,
    fecha,
    hora_inicio: hora,
    hora_fin: '16:00:00',
    estado: 'programada',
    ...resto,
  };
}

// ---------------------------------------------------------------------------------------

describe('con tiempo o de golpe', () => {
  it('avisar tres días antes del turno es con tiempo', () => {
    const resultado = comoLlegoLaAusencia({
      ausencia: ausencia({ desde: '2026-03-10', supo: '2026-03-07T08:00:00' }),
      guardias: [turno({ fecha: '2026-03-10' })],
    });
    expect(resultado.como).toBe(COMO_LLEGO.CON_TIEMPO);
    expect(resultado.horas).toBeCloseTo(72, 0);
  });

  it('avisar dos horas antes del turno es de golpe', () => {
    const resultado = comoLlegoLaAusencia({
      ausencia: ausencia({ desde: '2026-03-10', supo: '2026-03-10T06:00:00' }),
      guardias: [turno({ fecha: '2026-03-10', hora: '08:00:00' })],
    });
    expect(resultado.como).toBe(COMO_LLEGO.DE_GOLPE);
    expect(resultado.horas).toBeCloseTo(2, 0);
  });

  it('el borde deja pasar sus dos lados', () => {
    const justo = comoLlegoLaAusencia({
      ausencia: ausencia({ supo: '2026-03-09T08:00:00' }),
      guardias: [turno({ fecha: '2026-03-10', hora: '08:00:00' })],
    });
    expect(justo.horas).toBe(REGLA_DE_AVISO_DE_AUSENCIA.horas_para_considerarla_con_tiempo);
    expect(justo.como).toBe(COMO_LLEGO.CON_TIEMPO);

    const unMinutoMenos = comoLlegoLaAusencia({
      ausencia: ausencia({ supo: '2026-03-09T08:01:00' }),
      guardias: [turno({ fecha: '2026-03-10', hora: '08:00:00' })],
    });
    expect(unMinutoMenos.como).toBe(COMO_LLEGO.DE_GOLPE);
  });

  it('una ausencia que no deja ningún turno sin nadie no apura nada', () => {
    const resultado = comoLlegoLaAusencia({
      ausencia: ausencia({ desde: '2026-03-10', hasta: '2026-03-12', supo: '2026-03-10T07:00:00' }),
      guardias: [turno({ fecha: '2026-03-20' })],
    });
    expect(resultado.como).toBe(COMO_LLEGO.SIN_TURNOS);
    expect(resultado.horas).toBeNull();
  });

  it('se mide contra el primer turno afectado y no contra el día en que empieza la licencia', () => {
    // La licencia empieza el martes, pero su primer turno es el viernes: hay tres días para
    // resolverla, aunque el aviso haya llegado el lunes a la noche.
    const resultado = comoLlegoLaAusencia({
      ausencia: ausencia({ desde: '2026-03-10', supo: '2026-03-09T22:00:00' }),
      guardias: [turno({ fecha: '2026-03-13', hora: '08:00:00' })],
    });
    expect(resultado.como).toBe(COMO_LLEGO.CON_TIEMPO);
    expect(resultado.primerTurno.fecha).toBe('2026-03-13');
  });

  it('cuando hay varios turnos manda el más próximo', () => {
    const resultado = comoLlegoLaAusencia({
      ausencia: ausencia({ desde: '2026-03-10', supo: '2026-03-10T06:00:00' }),
      guardias: [
        turno({ fecha: '2026-03-14' }),
        turno({ fecha: '2026-03-10', hora: '08:00:00' }),
        turno({ fecha: '2026-03-12' }),
      ],
    });
    expect(resultado.primerTurno.fecha).toBe('2026-03-10');
    expect(resultado.como).toBe(COMO_LLEGO.DE_GOLPE);
    expect(resultado.turnos).toHaveLength(3);
  });

  it('un turno que ya había empezado cuando se supo no cuenta como hueco', () => {
    // Avisó a las 10 que no sigue; el turno de las 8 ya lo estaba haciendo. El hueco es el de
    // mañana, no ése.
    const resultado = comoLlegoLaAusencia({
      ausencia: ausencia({ desde: '2026-03-10', supo: '2026-03-10T10:00:00' }),
      guardias: [turno({ fecha: '2026-03-10', hora: '08:00:00' }), turno({ fecha: '2026-03-11', hora: '08:00:00' })],
    });
    expect(resultado.primerTurno.fecha).toBe('2026-03-11');
  });

  it('sin saber cuándo se supo, se trata como urgente', () => {
    // El error caro es el otro: dejar pasar en silencio un turno que empieza esta tarde.
    const resultado = comoLlegoLaAusencia({
      ausencia: { asistente_id: ASISTENTE, fecha_inicio: '2026-03-10', fecha_fin: null },
      guardias: [turno({ fecha: '2026-03-10' })],
    });
    expect(resultado.como).toBe(COMO_LLEGO.DE_GOLPE);
    expect(resultado.horas).toBeNull();
  });

  it('una ausencia vieja sin la columna nueva se mide por su hora de carga', () => {
    const resultado = comoLlegoLaAusencia({
      ausencia: {
        asistente_id: ASISTENTE,
        fecha_inicio: '2026-03-10',
        fecha_fin: null,
        created_at: '2026-03-05T08:00:00',
      },
      guardias: [turno({ fecha: '2026-03-10', hora: '08:00:00' })],
    });
    expect(resultado.como).toBe(COMO_LLEGO.CON_TIEMPO);
  });
});

describe('qué turnos deja sin nadie', () => {
  it('el turno de otra persona no cuenta', () => {
    const turnos = turnosQueDejaSinNadie({
      ausencia: ausencia({ supo: '2026-03-01T08:00:00' }),
      guardias: [turno({ fecha: '2026-03-10', asistente_id: 'otra' })],
    });
    expect(turnos).toHaveLength(0);
  });

  it('un turno cancelado no es un hueco', () => {
    const turnos = turnosQueDejaSinNadie({
      ausencia: ausencia({ supo: '2026-03-01T08:00:00' }),
      guardias: [turno({ fecha: '2026-03-10', estado: 'cancelada' })],
    });
    expect(turnos).toHaveLength(0);
  });

  it('un turno fuera de las fechas de la licencia no cuenta', () => {
    const turnos = turnosQueDejaSinNadie({
      ausencia: ausencia({ desde: '2026-03-10', hasta: '2026-03-12', supo: '2026-03-01T08:00:00' }),
      guardias: [turno({ fecha: '2026-03-13' })],
    });
    expect(turnos).toHaveLength(0);
  });

  it('una licencia sin fecha de vuelta tapa hacia adelante sin límite', () => {
    const turnos = turnosQueDejaSinNadie({
      ausencia: ausencia({ desde: '2026-03-10', hasta: null, supo: '2026-03-01T08:00:00' }),
      guardias: [turno({ fecha: '2026-06-01' })],
    });
    expect(turnos).toHaveLength(1);
  });

  it('el turno de noche que termina al día siguiente queda tapado igual', () => {
    // Arranca el 9 a las 22 y termina el 10 a las 6; la licencia empieza el 10 y lo parte al medio.
    const turnos = turnosQueDejaSinNadie({
      ausencia: ausencia({ desde: '2026-03-10', supo: '2026-03-01T08:00:00' }),
      guardias: [turno({ fecha: '2026-03-09', hora: '22:00:00', hora_fin: '06:00:00' })],
    });
    expect(turnos).toHaveLength(1);
  });
});

describe('la Prestadora corre los números', () => {
  it('sin nada configurado valen los de fábrica', () => {
    expect(reglaDeAvisoDe(null)).toEqual(REGLA_DE_AVISO_DE_AUSENCIA);
    expect(reglaDeAvisoDe({})).toEqual(REGLA_DE_AVISO_DE_AUSENCIA);
  });

  it('con otro borde, lo mismo se clasifica distinto', () => {
    const entrada = {
      ausencia: ausencia({ supo: '2026-03-09T08:00:00' }),
      guardias: [turno({ fecha: '2026-03-13', hora: '08:00:00' })],
    };
    expect(comoLlegoLaAusencia(entrada).como).toBe(COMO_LLEGO.CON_TIEMPO);
    expect(
      comoLlegoLaAusencia({ ...entrada, regla: reglaDeAvisoDe({ horas_para_considerarla_con_tiempo: 200 }) }).como
    ).toBe(COMO_LLEGO.DE_GOLPE);
  });

  it('un valor guardado fuera de borde se ignora y vale el de fábrica', () => {
    expect(reglaDeAvisoDe({ horas_para_considerarla_con_tiempo: 0 }).horas_para_considerarla_con_tiempo)
      .toBe(REGLA_DE_AVISO_DE_AUSENCIA.horas_para_considerarla_con_tiempo);
    expect(reglaDeAvisoDe({ horas_para_considerarla_con_tiempo: 99999 }).horas_para_considerarla_con_tiempo)
      .toBe(REGLA_DE_AVISO_DE_AUSENCIA.horas_para_considerarla_con_tiempo);
  });

  it('cada borde deja pasar sus dos extremos', () => {
    for (const [clave, borde] of Object.entries(REGLA_QUE_SE_PUEDE_TOCAR)) {
      expect(revisarRegla({ [clave]: borde.minimo }).ok).toBe(true);
      expect(revisarRegla({ [clave]: borde.maximo }).ok).toBe(true);
      expect(revisarRegla({ [clave]: borde.minimo - 1 }).ok).toBe(false);
      expect(revisarRegla({ [clave]: borde.maximo + 1 }).ok).toBe(false);
    }
  });

  it('ninguna ventana puede llegar a cero, que volvería urgente a ninguna ausencia', () => {
    expect(REGLA_QUE_SE_PUEDE_TOCAR.horas_para_considerarla_con_tiempo.minimo).toBeGreaterThan(0);
    expect(REGLA_QUE_SE_PUEDE_TOCAR.horas_entre_avisos.minimo).toBeGreaterThan(0);
  });

  it('una clave que nadie puede tocar se rechaza', () => {
    expect(revisarRegla({ lo_que_sea: 3 })).toEqual({ ok: false, clave: 'lo_que_sea' });
  });

  it('guardar sin tocar nada no congela ningún valor de fábrica', () => {
    expect(soloLoQueCorreDeLaRegla({ ...REGLA_DE_AVISO_DE_AUSENCIA })).toEqual({});
  });

  it('se guarda solamente lo que se corrió', () => {
    expect(soloLoQueCorreDeLaRegla({ ...REGLA_DE_AVISO_DE_AUSENCIA, horas_entre_avisos: 6 }))
      .toEqual({ horas_entre_avisos: 6 });
  });
});

describe('cuándo se supo', () => {
  it('manda la columna propia sobre la hora de carga', () => {
    const momento = cuandoSeSupo({ avisada_en: '2026-03-01T08:00:00', created_at: '2026-03-04T20:00:00' });
    expect(momento.getDate()).toBe(1);
  });

  it('sin ninguno de los dos datos no hay momento', () => {
    expect(cuandoSeSupo({})).toBeNull();
    expect(cuandoSeSupo(null)).toBeNull();
  });

  it('una fecha ilegible no se hace pasar por un momento válido', () => {
    expect(cuandoSeSupo({ avisada_en: 'cualquier cosa' })).toBeNull();
  });
});
