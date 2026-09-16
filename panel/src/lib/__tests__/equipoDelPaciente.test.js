/**
 * Quiénes son el equipo de un Paciente.
 *
 *   npx vitest run --dir src/lib   (desde `panel/`)
 *
 * POR QUÉ EXISTE ESTA PRUEBA. El equipo se arma solo y se corrige a mano, y las dos mitades
 * pueden romperse de maneras distintas:
 *
 *  1. Que lo corregido a mano no mande. Si la Coordinadora saca a alguien y el sistema lo vuelve
 *     a poner porque cumple la regla, la corrección no sirvió de nada.
 *  2. Que lo deducido quede congelado. Por eso se guardan sólo las correcciones: la que dejó de
 *     venir tiene que salir sola, sin que nadie la saque.
 *  3. Que entre quien no corresponde. Un turno cancelado, uno que todavía no pasó o uno de otro
 *     Paciente no hacen a nadie del equipo.
 */
import { describe, expect, it } from 'vitest';
import {
  ORIGEN,
  REGLA_DE_EQUIPO,
  REGLA_QUE_SE_PUEDE_TOCAR,
  equipoDelPaciente,
  quienCubreFrancos,
  reglaDeEquipoDe,
  revisarRegla,
  soloLoQueCorreDeLaRegla,
} from '../equipoDelPaciente';

const PACIENTE = 'paciente-1';
const OTRO_PACIENTE = 'paciente-2';
const AHORA = new Date('2026-09-16T12:00:00');

/** Un turno de ese Paciente, hecho por esa Asistente, hace tantos días. */
function turno(asistenteId, diasAtras, extra = {}) {
  const dia = new Date(AHORA.getTime() - diasAtras * 24 * 60 * 60 * 1000);
  const fecha = dia.toISOString().slice(0, 10);
  return {
    id: `g-${asistenteId}-${diasAtras}-${extra.paciente_id ?? PACIENTE}`,
    asistente_id: asistenteId,
    paciente_id: PACIENTE,
    fecha,
    hora_inicio: '08:00',
    hora_fin: '16:00',
    estado: 'confirmada',
    ...extra,
  };
}

/** Tantos turnos de esa Asistente, uno por semana hacia atrás. */
function turnosSemanales(asistenteId, cuantos, extra = {}) {
  return Array.from({ length: cuantos }, (_, i) => turno(asistenteId, 7 * (i + 1), extra));
}

const idsDe = (equipo) => equipo.asistentes.map((a) => a.asistente_id);

describe('el equipo se arma solo con quienes tienen turnos habituales', () => {
  it('con los turnos que pide la regla, entra sola', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      guardias: turnosSemanales('ana', 3),
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual(['ana']);
    expect(equipo.asistentes[0].origen).toBe(ORIGEN.POR_SUS_TURNOS);
    expect(equipo.asistentes[0].turnos).toBe(3);
    expect(equipo.asistentes[0].decidido).toBe(false);
  });

  it('con un turno menos, no entra', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      guardias: turnosSemanales('ana', 2),
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual([]);
  });

  it('los turnos viejos no cuentan, así que quien dejó de venir sale solo', () => {
    // Tres turnos, pero de hace más de un año. Nadie tiene que sacarla a mano.
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      guardias: [turno('ana', 400), turno('ana', 407), turno('ana', 414)],
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual([]);
  });

  it('los turnos que todavía no pasaron no cuentan', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      guardias: [turno('ana', -1), turno('ana', -8), turno('ana', -15)],
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual([]);
  });

  it('los turnos cancelados y los que la Asistente faltó no cuentan', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      guardias: [
        turno('ana', 7),
        turno('ana', 14, { estado: 'cancelada' }),
        turno('ana', 21, { estado: 'ausente' }),
      ],
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual([]);
  });

  it('los turnos de otro Paciente no cuentan', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      guardias: turnosSemanales('ana', 3, { paciente_id: OTRO_PACIENTE }),
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual([]);
  });

  it('un turno atiende a varios Pacientes a la vez, y cuenta para todos', () => {
    // Una guardia puede tocar a más de un Paciente: la respuesta a "a quién atiende" es una lista.
    const guardias = turnosSemanales('ana', 3, { paciente_id: null });
    const pacientesPorGuardia = new Map(guardias.map((g) => [g.id, [OTRO_PACIENTE, PACIENTE]]));
    const equipo = equipoDelPaciente({ pacienteId: PACIENTE, guardias, pacientesPorGuardia, ahora: AHORA });
    expect(idsDe(equipo)).toEqual(['ana']);
  });

  it('una serie vigente basta, aunque todavía no haya hecho ningún turno', () => {
    // Es el caso de quien entra la semana que viene con un turno fijo semanal.
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      series: [{ asistente_id: 'beatriz', estado: 'activa' }],
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual(['beatriz']);
    expect(equipo.asistentes[0].origen).toBe(ORIGEN.POR_SU_SERIE);
  });

  it('una serie terminada no basta', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      series: [{ asistente_id: 'beatriz', estado: 'activa', vigente_hasta: '2026-01-31' }],
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual([]);
  });

  it('una serie sin Asistente fija no mete a nadie', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      series: [{ asistente_id: null, estado: 'activa' }],
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual([]);
  });
});

describe('la Coordinadora corrige a mano, y su corrección manda', () => {
  it('puede sumar a alguien que no llega sola', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      guardias: [turno('ana', 7)],
      decisiones: [{ asistente_id: 'ana', situacion: 'sumada' }],
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual(['ana']);
    expect(equipo.asistentes[0].origen).toBe(ORIGEN.A_MANO);
    expect(equipo.asistentes[0].decidido).toBe(true);
  });

  it('puede sumar a alguien que nunca hizo un turno', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      decisiones: [{ asistente_id: 'carla', situacion: 'sumada' }],
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual(['carla']);
    expect(equipo.asistentes[0].turnos).toBe(0);
  });

  it('puede sacar a alguien que el sistema pondría, y no vuelve a entrar', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      guardias: turnosSemanales('ana', 5),
      decisiones: [{ asistente_id: 'ana', situacion: 'sacada' }],
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual([]);
    expect(equipo.afuera.map((a) => a.asistente_id)).toEqual(['ana']);
    expect(equipo.afuera[0].llegaba_solo).toBe(true);
  });

  it('marca quién cubre francos, y esa persona va primero', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      guardias: [...turnosSemanales('ana', 8), ...turnosSemanales('dora', 3)],
      decisiones: [{ asistente_id: 'dora', situacion: 'sumada', cubre_francos: true }],
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual(['dora', 'ana'], 'quien cubre francos no quedó primera');
    expect(quienCubreFrancos(equipo).map((a) => a.asistente_id)).toEqual(['dora']);
  });

  it('el resto se ordena por cuántos turnos hizo', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      guardias: [...turnosSemanales('ana', 3), ...turnosSemanales('elsa', 9)],
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual(['elsa', 'ana']);
  });

  it('la corrección no congela lo deducido: quien sigue viniendo sigue estando', () => {
    // Guardar sólo las correcciones es lo que hace posible esto. Si se guardara la lista entera,
    // Ana tendría que haber sido agregada a mano el día que empezó a venir.
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      guardias: turnosSemanales('ana', 4),
      decisiones: [{ asistente_id: 'carla', situacion: 'sumada' }],
      ahora: AHORA,
    });
    expect(idsDe(equipo).sort()).toEqual(['ana', 'carla']);
  });
});

describe('quién coordina a este Paciente', () => {
  it('sin nadie fijado, son quienes lo alcanzan por sus zonas', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      coordinadoresQueAlcanzan: ['u-1', 'u-2', 'u-1'],
      ahora: AHORA,
    });
    expect(equipo.coordinadores.map((c) => c.usuario_id)).toEqual(['u-1', 'u-2']);
    expect(equipo.coordinadores[0].origen).toBe(ORIGEN.POR_SU_ZONA);
  });

  it('con alguien fijado, manda esa persona sola', () => {
    // Un aviso que le llega a seis personas no le llega a ninguna.
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      coordinadoresQueAlcanzan: ['u-1', 'u-2'],
      decisiones: [{ usuario_id: 'u-3', situacion: 'sumada' }],
      ahora: AHORA,
    });
    expect(equipo.coordinadores.map((c) => c.usuario_id)).toEqual(['u-3']);
    expect(equipo.coordinadores[0].origen).toBe(ORIGEN.A_MANO);
  });

  it('a quien alcanza por zona se lo puede sacar', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      coordinadoresQueAlcanzan: ['u-1', 'u-2'],
      decisiones: [{ usuario_id: 'u-1', situacion: 'sacada' }],
      ahora: AHORA,
    });
    expect(equipo.coordinadores.map((c) => c.usuario_id)).toEqual(['u-2']);
  });

  it('quien coordina no se mezcla con las Asistentes', () => {
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      guardias: turnosSemanales('ana', 3),
      decisiones: [{ usuario_id: 'u-3', situacion: 'sumada' }],
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual(['ana']);
    expect(equipo.coordinadores.map((c) => c.usuario_id)).toEqual(['u-3']);
  });
});

describe('cada Prestadora corre los números de la regla', () => {
  it('sin nada guardado salen los de fábrica', () => {
    expect(reglaDeEquipoDe(null)).toEqual(REGLA_DE_EQUIPO);
  });

  it('lo corrido manda, y cambia de verdad quién entra', () => {
    const regla = reglaDeEquipoDe({ turnos_para_ser_del_equipo: 2 });
    expect(regla.turnos_para_ser_del_equipo).toBe(2);
    const equipo = equipoDelPaciente({
      pacienteId: PACIENTE,
      guardias: turnosSemanales('ana', 2),
      regla,
      ahora: AHORA,
    });
    expect(idsDe(equipo)).toEqual(['ana'], 'la configuración de la Prestadora no cambió nada');
  });

  it('la ventana corrida también cambia quién entra', () => {
    const guardias = [turno('ana', 100), turno('ana', 110), turno('ana', 120)];
    expect(idsDe(equipoDelPaciente({ pacienteId: PACIENTE, guardias, ahora: AHORA }))).toEqual([]);
    const regla = reglaDeEquipoDe({ dias_hacia_atras: 365 });
    expect(idsDe(equipoDelPaciente({ pacienteId: PACIENTE, guardias, regla, ahora: AHORA }))).toEqual(['ana']);
  });

  it('un número fuera de borde o que no es número se ignora', () => {
    expect(reglaDeEquipoDe({ turnos_para_ser_del_equipo: 0 })).toEqual(REGLA_DE_EQUIPO);
    expect(reglaDeEquipoDe({ dias_hacia_atras: 5000 })).toEqual(REGLA_DE_EQUIPO);
    expect(reglaDeEquipoDe({ dias_hacia_atras: 'noventa' })).toEqual(REGLA_DE_EQUIPO);
  });

  it('se guarda lo que se corrió y nada más', () => {
    expect(soloLoQueCorreDeLaRegla({ ...REGLA_DE_EQUIPO })).toEqual({});
    expect(soloLoQueCorreDeLaRegla({ ...REGLA_DE_EQUIPO, dias_hacia_atras: 120 })).toEqual({
      dias_hacia_atras: 120,
    });
  });

  it('lo guardado y lo leído dan la vuelta completa sin cambiar nada', () => {
    const elegida = { turnos_para_ser_del_equipo: 5, dias_hacia_atras: 180 };
    expect(reglaDeEquipoDe(soloLoQueCorreDeLaRegla(elegida))).toEqual(elegida);
  });

  it('lo que llega de afuera se revisa, y cada borde deja pasar sus dos extremos', () => {
    expect(revisarRegla({ dias_hacia_atras: 120 })).toEqual({ ok: true });
    expect(revisarRegla({ lo_que_sea: 1 })).toEqual({ ok: false, clave: 'lo_que_sea' });
    for (const [clave, borde] of Object.entries(REGLA_QUE_SE_PUEDE_TOCAR)) {
      expect(revisarRegla({ [clave]: borde.minimo }).ok).toBe(true);
      expect(revisarRegla({ [clave]: borde.maximo }).ok).toBe(true);
      expect(revisarRegla({ [clave]: borde.minimo - 1 }).ok).toBe(false);
      expect(revisarRegla({ [clave]: borde.maximo + 1 }).ok).toBe(false);
    }
  });

  it('ninguna ventana puede llegar a cero, que dejaría a todo Paciente sin equipo', () => {
    expect(REGLA_QUE_SE_PUEDE_TOCAR.dias_hacia_atras.minimo).toBeGreaterThan(0);
    expect(REGLA_QUE_SE_PUEDE_TOCAR.turnos_para_ser_del_equipo.minimo).toBeGreaterThan(0);
  });
});
