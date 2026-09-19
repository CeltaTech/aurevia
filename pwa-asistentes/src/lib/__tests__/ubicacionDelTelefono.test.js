// Los dos fallos de ubicación no son el mismo, y esta prueba existe para que no se vuelvan uno.
//
// El defecto que corrige: a alguien que tiene el GPS encendido y está adentro de un edificio se le
// decía «active el GPS». Lo mandaba a buscar una perilla que ya estaba puesta y lo dejaba parado
// en la puerta. Acá se rompe a propósito cada código del navegador, para que si alguien vuelve a
// juntar los dos casos en un solo mensaje, deje de pasar.
//
// LA UBICACIÓN NO APARECE EN NINGUNA PARTE DE ESTA PRUEBA, ni siquiera inventada como número real:
// lo que se comprueba es qué se devuelve y qué se rechaza, no dónde está nadie.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UBICACION_NEGADA,
  UBICACION_NO_DISPONIBLE,
  FALLOS_DE_UBICACION,
  esFalloDeUbicacion,
  obtenerUbicacion,
} from '../ubicacionDelTelefono.js';

/** El navegador de mentira: contesta lo que le digan y nada más. */
function conNavegador(geolocation, correr) {
  const antes = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { value: geolocation ? { geolocation } : {}, configurable: true });
  return Promise.resolve()
    .then(correr)
    .finally(() => {
      Object.defineProperty(globalThis, 'navigator', { value: antes, configurable: true });
    });
}

const queFalla = (code) => ({
  getCurrentPosition: (_ok, mal) => mal({ code }),
});

test('el permiso negado se cuenta como negado, y es el único que habla de la persona', async () => {
  await conNavegador(queFalla(1), async () => {
    await assert.rejects(obtenerUbicacion(), (e) => e.message === UBICACION_NEGADA);
  });
});

test('el aparato que no pudo ubicarse no es alguien que negó nada', async () => {
  // 2 es `POSITION_UNAVAILABLE` y 3 es `TIMEOUT`: los dos son el edificio, no la persona.
  for (const code of [2, 3]) {
    await conNavegador(queFalla(code), async () => {
      await assert.rejects(obtenerUbicacion(), (e) => e.message === UBICACION_NO_DISPONIBLE, `con el código ${code}`);
    });
  }
});

test('un código que no se entiende no acusa a nadie de haber negado el permiso', async () => {
  // Falla hacia el lado que no culpa: decirle «no dio permiso» a quien sí lo dio lo manda a
  // arreglar algo que no está roto.
  for (const code of [undefined, 0, 99, 'PERMISSION_DENIED', null]) {
    await conNavegador(queFalla(code), async () => {
      await assert.rejects(obtenerUbicacion(), (e) => e.message === UBICACION_NO_DISPONIBLE, `con ${JSON.stringify(code)}`);
    });
  }
});

test('un navegador sin geolocalización no le negó nada a nadie: no puede', async () => {
  await conNavegador(null, async () => {
    await assert.rejects(obtenerUbicacion(), (e) => e.message === UBICACION_NO_DISPONIBLE);
  });
});

test('cuando el aparato contesta, lo que vuelve es el punto y nada más', async () => {
  const geolocation = {
    getCurrentPosition: (ok) => ok({ coords: { latitude: 1.5, longitude: -2.5, accuracy: 7, altitude: null } }),
  };
  await conNavegador(geolocation, async () => {
    assert.deepEqual(await obtenerUbicacion(), { lat: 1.5, lng: -2.5 });
  });
});

test('un fallo que no es de ubicación sigue su camino', () => {
  // Falla cerrado: lo del motor se muestra con el catálogo de errores, no con la frase de la
  // ubicación. Si esto se abriera, cualquier error del motor le diría a la persona que revise
  // su GPS.
  assert.equal(esFalloDeUbicacion(new Error('sesion_vencida')), false);
  assert.equal(esFalloDeUbicacion(undefined), false);
  assert.equal(esFalloDeUbicacion({}), false);
  for (const clave of FALLOS_DE_UBICACION) {
    assert.equal(esFalloDeUbicacion(new Error(clave)), true, `${clave} sí es un fallo de ubicación`);
  }
});

test('los dos fallos son dos, y la clave del error es la clave de la frase', () => {
  assert.equal(UBICACION_NEGADA === UBICACION_NO_DISPONIBLE, false);
  assert.deepEqual(FALLOS_DE_UBICACION, [UBICACION_NEGADA, UBICACION_NO_DISPONIBLE]);
});
