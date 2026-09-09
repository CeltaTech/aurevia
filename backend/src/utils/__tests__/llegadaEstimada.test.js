/**
 * La cuenta de la hora estimada de llegada, y a partir de cuántos minutos de atraso eso se
 * convierte en un aviso (pendiente #101).
 *
 *   npm test --prefix backend
 *
 * POR QUÉ EXISTE ESTA PRUEBA. Son tres cosas que no se ven mirando el código:
 *
 *   1. EL MARGEN LO DECIDE LA PRESTADORA, no el producto. El número escrito en el archivo es
 *      solamente con lo que arranca quien todavía no configuró nada. Si alguien lo convierte en
 *      la regla —tomando el primero de la lista, o ignorando lo configurado—, estas pruebas
 *      fallan.
 *   2. «NO SE SABE» NO ES «LLEGA BIEN». `llegaTarde` contesta `true`, `false` o `null`, y el
 *      `null` es un tercer resultado con significado propio. El día que alguien lo reemplace por
 *      un `false` «para simplificar», el sistema va a decir que llega a horario gente de la que
 *      no tiene ni un dato.
 *   3. NINGUNA HORA INVENTADA. Sin salida o sin distancia no hay estimación, y eso se dice.
 *
 * Este archivo prueba la copia del motor, que es la que corre en el servidor. El original vive
 * en `panel/src/lib/llegadaEstimada.js` y `scripts/verificar_identidad.mjs` corta el build si las
 * dos se despegaron.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import {
  FACTOR_RECORRIDO,
  MINUTOS_DEMORA_POR_OMISION,
  VELOCIDAD_MEDIA_KM_H,
  horaEstimadaDeLlegada,
  llegaTarde,
  minutosDeDemoraTolerados,
  minutosDeViaje,
} from '../llegadaEstimada.js';

const UN_MINUTO = 60_000;

describe('minutosDeDemoraTolerados — el margen lo decide la Prestadora', () => {
  it('sin niveles cargados vale el valor de arranque, y no rompe', () => {
    assert.equal(minutosDeDemoraTolerados([]), MINUTOS_DEMORA_POR_OMISION);
    assert.equal(minutosDeDemoraTolerados(null), MINUTOS_DEMORA_POR_OMISION);
    assert.equal(minutosDeDemoraTolerados(undefined), MINUTOS_DEMORA_POR_OMISION);
  });

  it('con un nivel configurado manda ese número, no el del archivo', () => {
    assert.equal(minutosDeDemoraTolerados([{ minutos_demora: 45 }]), 45);
    // Y se nota que manda de verdad: 45 no es el valor de arranque.
    assert.notEqual(45, MINUTOS_DEMORA_POR_OMISION);
  });

  it('con varios niveles manda el menor: el primer escalón es el que avisa', () => {
    assert.equal(minutosDeDemoraTolerados([{ minutos_demora: 60 }, { minutos_demora: 20 }, { minutos_demora: 90 }]), 20);
  });

  it('un nivel sin número se saltea en vez de arrastrar la lista a cero', () => {
    assert.equal(minutosDeDemoraTolerados([{ minutos_demora: null }, { minutos_demora: 30 }]), 30);
    assert.equal(minutosDeDemoraTolerados([{}, { minutos_demora: 30 }]), 30);
    assert.equal(minutosDeDemoraTolerados([{ minutos_demora: 0 }, { minutos_demora: 30 }]), 30);
    assert.equal(minutosDeDemoraTolerados([{ minutos_demora: -5 }, { minutos_demora: 30 }]), 30);
    assert.equal(minutosDeDemoraTolerados([{ minutos_demora: 'treinta' }, { minutos_demora: 30 }]), 30);
  });

  it('con todos los niveles sin número vuelve al valor de arranque', () => {
    assert.equal(minutosDeDemoraTolerados([{ minutos_demora: null }, { minutos_demora: 0 }]), MINUTOS_DEMORA_POR_OMISION);
  });
});

describe('minutosDeViaje — cuánto lleva recorrer una distancia', () => {
  it('sin distancia no hay minutos: no se inventa un viaje', () => {
    assert.equal(minutosDeViaje(null), null);
    assert.equal(minutosDeViaje(undefined), null);
    assert.equal(minutosDeViaje(NaN), null);
    assert.equal(minutosDeViaje('mil'), null);
    assert.equal(minutosDeViaje(-100), null);
  });

  it('estar en la puerta son cero minutos', () => {
    assert.equal(minutosDeViaje(0), 0);
  });

  it('la cuenta usa la velocidad media y el factor de recorrido, y redondea hacia arriba', () => {
    // Diez kilómetros en línea recta son trece de calles, y trece kilómetros a la velocidad
    // media son treinta y nueve minutos.
    const esperado = Math.ceil(((10 * FACTOR_RECORRIDO) / VELOCIDAD_MEDIA_KM_H) * 60);
    assert.equal(esperado, 39);
    assert.equal(minutosDeViaje(10000), 39);
  });

  it('un viaje de un minuto y monedas se redondea al minuto siguiente, nunca hacia abajo', () => {
    assert.equal(minutosDeViaje(500), 2);
  });
});

describe('horaEstimadaDeLlegada — nunca una hora inventada', () => {
  const SALIDA = new Date('2026-09-09T14:00:00');

  it('sin marca de salida no hay estimación', () => {
    assert.equal(horaEstimadaDeLlegada({ salidaAt: null, metros: 1000 }), null);
    assert.equal(horaEstimadaDeLlegada({ salidaAt: undefined, metros: 1000 }), null);
    assert.equal(horaEstimadaDeLlegada({ salidaAt: 'cualquier cosa', metros: 1000 }), null);
  });

  it('sin distancia tampoco: la hora sola no alcanza', () => {
    assert.equal(horaEstimadaDeLlegada({ salidaAt: SALIDA, metros: null }), null);
  });

  it('con salida y distancia devuelve la hora, y le suma los minutos del viaje', () => {
    const llegada = horaEstimadaDeLlegada({ salidaAt: SALIDA, metros: 10000 });
    assert.ok(llegada instanceof Date);
    assert.equal(llegada.getTime() - SALIDA.getTime(), 39 * UN_MINUTO);
  });

  it('la salida puede venir como texto, que es como la guarda la base', () => {
    const llegada = horaEstimadaDeLlegada({ salidaAt: SALIDA.toISOString(), metros: 10000 });
    assert.equal(llegada.getTime() - SALIDA.getTime(), 39 * UN_MINUTO);
  });
});

describe('llegaTarde — tres resultados, y el tercero no es un no', () => {
  const INICIO = new Date('2026-09-09T14:00:00');

  it('sin estimación contesta «no se sabe», que no es «llega bien»', () => {
    const respuesta = llegaTarde({ llegadaEstimada: null, inicio: INICIO, minutosTolerados: 10 });
    assert.equal(respuesta, null);
    // Escrito aparte a propósito: si algún día esto devolviera `false`, la prueba de arriba
    // seguiría pasando con `assert.equal`, y el sistema estaría diciendo que llega a horario
    // alguien de quien no tiene ni un dato.
    assert.notStrictEqual(respuesta, false);
  });

  it('sin hora de inicio tampoco se sabe', () => {
    assert.equal(llegaTarde({ llegadaEstimada: new Date(), inicio: null, minutosTolerados: 10 }), null);
    assert.equal(llegaTarde({ llegadaEstimada: new Date(), inicio: new Date('vaya a saber'), minutosTolerados: 10 }), null);
  });

  it('llegar adentro del margen no es llegar tarde', () => {
    const llegadaEstimada = new Date(INICIO.getTime() + 9 * UN_MINUTO);
    assert.equal(llegaTarde({ llegadaEstimada, inicio: INICIO, minutosTolerados: 10 }), false);
  });

  it('justo en el borde del margen todavía no es tarde', () => {
    const llegadaEstimada = new Date(INICIO.getTime() + 10 * UN_MINUTO);
    assert.equal(llegaTarde({ llegadaEstimada, inicio: INICIO, minutosTolerados: 10 }), false);
  });

  it('pasado el margen sí', () => {
    const llegadaEstimada = new Date(INICIO.getTime() + 11 * UN_MINUTO);
    assert.equal(llegaTarde({ llegadaEstimada, inicio: INICIO, minutosTolerados: 10 }), true);
  });

  it('el margen configurado cambia la respuesta sobre la misma llegada', () => {
    const llegadaEstimada = new Date(INICIO.getTime() + 30 * UN_MINUTO);
    assert.equal(llegaTarde({ llegadaEstimada, inicio: INICIO, minutosTolerados: 10 }), true);
    assert.equal(llegaTarde({ llegadaEstimada, inicio: INICIO, minutosTolerados: 45 }), false);
  });

  it('un margen imposible no deja el sistema sin margen: vale el de arranque', () => {
    const adentro = new Date(INICIO.getTime() + (MINUTOS_DEMORA_POR_OMISION - 1) * UN_MINUTO);
    const afuera = new Date(INICIO.getTime() + (MINUTOS_DEMORA_POR_OMISION + 1) * UN_MINUTO);
    for (const margen of [null, undefined, 0, -10, NaN, 'diez']) {
      assert.equal(llegaTarde({ llegadaEstimada: adentro, inicio: INICIO, minutosTolerados: margen }), false);
      assert.equal(llegaTarde({ llegadaEstimada: afuera, inicio: INICIO, minutosTolerados: margen }), true);
    }
  });
});
