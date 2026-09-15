import { describe, expect, it } from 'vitest';
import { SITUACION, UMBRALES, situacionDeGuardia, umbralesDeLaPrestadora } from '../semaforoGuardia';

/* Los umbrales del semáforo salen de la configuración de cada Prestadora.
   ==========================================================================

   Las primeras pruebas miran la traducción de columnas a umbrales. Las últimas dos miran lo que
   de verdad importa: que ese número cambie el color de una guardia. Comprobar sólo que la
   función devuelve `24` no probaría nada — un umbral bien traducido que nadie usa deja la grilla
   exactamente como estaba. */

describe('umbralesDeLaPrestadora', () => {
  it('toma los tres números de la configuración de la Prestadora', () => {
    const u = umbralesDeLaPrestadora({
      avisoSinCubrir: { horas_antes: 24 },
      ausenciaAutomatica: { minutos_tolerancia_checkin: 30 },
      escaladaCoordinador: { minutos_gracia_cierre_guardia: 90 },
    });

    expect(u.horas_hueco_urgente).toBe(24);
    expect(u.minutos_tolerancia_llegada).toBe(30);
    expect(u.horas_para_cerrar).toBe(1.5);
  });

  it('pasa de minutos a horas, que es como razona el semáforo', () => {
    // La Prestadora contesta «a los cuántos minutos de terminada quiero que me avisen»; el
    // semáforo pregunta «cuántas horas puede quedar sin cerrar». Es el mismo número.
    expect(umbralesDeLaPrestadora({ escaladaCoordinador: { minutos_gracia_cierre_guardia: 15 } }).horas_para_cerrar).toBe(0.25);
  });

  it('sin ninguna configuración devuelve los de fábrica', () => {
    expect(umbralesDeLaPrestadora()).toEqual(UMBRALES);
    expect(umbralesDeLaPrestadora({})).toEqual(UMBRALES);
  });

  it('una Prestadora que configuró una sola de las tres tablas conserva las otras dos de fábrica', () => {
    const u = umbralesDeLaPrestadora({ avisoSinCubrir: { horas_antes: 12 } });

    expect(u.horas_hueco_urgente).toBe(12);
    expect(u.minutos_tolerancia_llegada).toBe(UMBRALES.minutos_tolerancia_llegada);
    expect(u.horas_para_cerrar).toBe(UMBRALES.horas_para_cerrar);
  });

  it('un valor que no es un número útil no reemplaza al de fábrica', () => {
    // Un cero diría «toda guardia es urgente desde siempre», y un nulo o un texto vacío son
    // columnas que esa Prestadora nunca completó. Ninguno de los tres es una decisión suya.
    for (const valor of [0, -3, null, undefined, '', 'mucho', NaN]) {
      const u = umbralesDeLaPrestadora({
        avisoSinCubrir: { horas_antes: valor },
        ausenciaAutomatica: { minutos_tolerancia_checkin: valor },
        escaladaCoordinador: { minutos_gracia_cierre_guardia: valor },
      });
      expect(u).toEqual(UMBRALES);
    }
  });
});

/* Las fechas se arman en hora local a propósito: `inicioDeGuardia` lee `fecha` y `hora_inicio`
   como cadenas sin huso, así que una prueba escrita en huso cero daría distinto según dónde
   corra. */
const AHORA = new Date(2026, 8, 15, 12, 0, 0);
const HOY = '2026-09-15';

describe('el umbral configurado cambia lo que se ve', () => {
  it('una guardia terminada hace media hora y sin salida marcada: sin cerrar para quien puso quince minutos, en curso para quien no configuró nada', () => {
    const guardia = {
      estado: 'activa',
      asistente_id: 'asis-1',
      fecha: HOY,
      hora_inicio: '06:00',
      hora_fin: '11:30',
      checkin_at: '2026-09-15T06:05:00',
      checkout_at: null,
    };

    const conLosDeFabrica = umbralesDeLaPrestadora();
    const conQuinceMinutos = umbralesDeLaPrestadora({
      escaladaCoordinador: { minutos_gracia_cierre_guardia: 15 },
    });

    expect(situacionDeGuardia(guardia, { ahora: AHORA, umbrales: conLosDeFabrica })).toBe(SITUACION.EN_CURSO);
    expect(situacionDeGuardia(guardia, { ahora: AHORA, umbrales: conQuinceMinutos })).toBe(SITUACION.SIN_CERRAR);
  });

  it('un hueco de pasado mañana: urgente para quien avisa con cuarenta y ocho horas, todavía no para quien avisa con veinticuatro', () => {
    // Empieza a las 18 de mañana: faltan 30 horas.
    const hueco = {
      estado: 'programada',
      asistente_id: null,
      ofrecida_at: null,
      fecha: '2026-09-16',
      hora_inicio: '18:00',
      hora_fin: '22:00',
    };

    const conCuarentaYOcho = umbralesDeLaPrestadora({ avisoSinCubrir: { horas_antes: 48 } });
    const conVeinticuatro = umbralesDeLaPrestadora({ avisoSinCubrir: { horas_antes: 24 } });

    expect(situacionDeGuardia(hueco, { ahora: AHORA, umbrales: conCuarentaYOcho })).toBe(SITUACION.HUECO_URGENTE);
    expect(situacionDeGuardia(hueco, { ahora: AHORA, umbrales: conVeinticuatro })).toBe(SITUACION.HUECO);
  });
});
