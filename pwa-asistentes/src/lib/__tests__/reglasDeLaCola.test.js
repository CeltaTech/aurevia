// Las reglas de la cola sin señal. Corren sin teléfono, sin base y sin red: `reglasDeLaCola.js`
// es una lista de objetos y decisiones sobre ella, y por eso se puede probar de verdad.
//
// UNA PRUEBA QUE NO PUEDE FALLAR NO PRUEBA NADA, así que las dos reglas que importan se rompen a
// propósito: una cola firmada por otra cuenta y un ítem que ya gastó todos sus intentos. Si
// alguien afloja el filtro por dueño o sube el tope sin querer, acá se ve.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOPE_DE_INTENTOS,
  seAgoto,
  esDeLaSesion,
  loQueSeManda,
  loQueSeMuestra,
  loQueSeDescarta,
  conIntentoFallido,
  motivoQueSeMuestra,
} from '../reglasDeLaCola.js';

const ANA = 'ana-uuid';
const BETO = 'beto-uuid';

function item(extra = {}) {
  return { id: 'x', tipo: 'checkin', guardiaId: 'g1', duenoId: ANA, creadoEn: 1, intentos: 0, situacion: null, ...extra };
}

// ---------------------------------------------------------------------------
// La cola es de quien tiene la sesión abierta
// ---------------------------------------------------------------------------

test('lo anotado por otra cuenta no se manda nunca con esta sesión', () => {
  const cola = [item({ id: 'de-ana', duenoId: ANA }), item({ id: 'de-beto', duenoId: BETO })];
  const aMandar = loQueSeManda(cola, ANA);
  assert.deepEqual(aMandar.map((i) => i.id), ['de-ana']);
  // Y al revés, que es el caso que cruza Prestadoras: la misma cola con la otra sesión abierta
  // manda lo otro y nada de lo de Ana.
  assert.deepEqual(loQueSeManda(cola, BETO).map((i) => i.id), ['de-beto']);
});

test('lo de otra cuenta tampoco se muestra', () => {
  const cola = [item({ id: 'de-ana', duenoId: ANA }), item({ id: 'de-beto', duenoId: BETO })];
  assert.deepEqual(loQueSeMuestra(cola, BETO).map((i) => i.id), ['de-beto']);
});

test('lo que quedó de una sesión anterior se descarta, y lo propio no', () => {
  const cola = [item({ id: 'de-ana', duenoId: ANA }), item({ id: 'de-beto', duenoId: BETO })];
  assert.deepEqual(loQueSeDescarta(cola, ANA).map((i) => i.id), ['de-beto']);
});

test('lo anotado por una versión anterior no tiene dueño, así que se descarta y no se manda', () => {
  // La versión 1 de la base del teléfono no firmaba. No hay forma de saber con qué cuenta se
  // anotó, y mandarlo con la que esté abierta ahora es justo lo que no puede pasar.
  const cola = [item({ id: 'viejo', duenoId: undefined })];
  assert.deepEqual(loQueSeManda(cola, ANA), []);
  assert.deepEqual(loQueSeDescarta(cola, ANA).map((i) => i.id), ['viejo']);
});

test('sin sesión abierta no se manda nada y no se descarta nada', () => {
  // Falla cerrado por los dos lados: sin dueño conocido no sale nada del teléfono, y tampoco se
  // borra la cola de quien está por entrar.
  const cola = [item({ id: 'de-ana', duenoId: ANA })];
  assert.deepEqual(loQueSeManda(cola, null), []);
  assert.deepEqual(loQueSeMuestra(cola, null), []);
  assert.deepEqual(loQueSeDescarta(cola, null), []);
  assert.equal(esDeLaSesion(item({ duenoId: null }), null), false);
});

test('el orden de envío es el orden en que pasaron las cosas', () => {
  const cola = [
    item({ id: 'cierre', creadoEn: 300 }),
    item({ id: 'llegada', creadoEn: 100 }),
    item({ id: 'reporte', creadoEn: 200 }),
  ];
  assert.deepEqual(loQueSeManda(cola, ANA).map((i) => i.id), ['llegada', 'reporte', 'cierre']);
});

// ---------------------------------------------------------------------------
// El tope de intentos
// ---------------------------------------------------------------------------

test('al llegar al tope el ítem deja de mandarse', () => {
  assert.equal(seAgoto(item({ intentos: TOPE_DE_INTENTOS - 1 })), false);
  assert.equal(seAgoto(item({ intentos: TOPE_DE_INTENTOS })), true);
  // Roto a propósito: uno con el tope gastado adentro de una cola por lo demás sana.
  const cola = [item({ id: 'sano' }), item({ id: 'agotado', intentos: TOPE_DE_INTENTOS })];
  assert.deepEqual(loQueSeManda(cola, ANA).map((i) => i.id), ['sano']);
});

test('lo agotado no se borra: se sigue mostrando con su motivo', () => {
  const cola = [item({ id: 'agotado', intentos: TOPE_DE_INTENTOS, situacion: 'dato_invalido' })];
  const visibles = loQueSeMuestra(cola, ANA);
  assert.equal(visibles.length, 1);
  assert.equal(motivoQueSeMuestra(visibles[0]), 'dato_invalido');
});

test('cada intento fallido suma uno, y tres seguidos agotan', () => {
  let actual = item({ intentos: 0 });
  for (let vuelta = 0; vuelta < TOPE_DE_INTENTOS; vuelta += 1) {
    assert.equal(seAgoto(actual), false, `no debería estar agotado en la vuelta ${vuelta}`);
    actual = conIntentoFallido(actual, 'sin_permiso');
  }
  assert.equal(actual.intentos, TOPE_DE_INTENTOS);
  assert.equal(seAgoto(actual), true);
});

test('una cuenta de intentos rota no deja mandar para siempre', () => {
  // Valores que no son un número, o negativos, vuelven a cero en vez de romper la comparación:
  // `undefined >= 3` da falso, y un control escrito así deja pasar justo el caso que no entendió.
  assert.equal(seAgoto(item({ intentos: undefined })), false);
  assert.equal(seAgoto(item({ intentos: 'muchos' })), false);
  assert.equal(seAgoto(item({ intentos: -5 })), false);
  assert.equal(seAgoto(item({ intentos: 99 })), true);
});

// ---------------------------------------------------------------------------
// El motivo que se muestra
// ---------------------------------------------------------------------------

test('el motivo que se guarda es una situación del catálogo, nunca el texto del motor', () => {
  const fallido = conIntentoFallido(item(), 'duplicado');
  assert.equal(fallido.situacion, 'duplicado');
  // Sin situación clasificada queda la genérica: nunca se guarda vacío, porque entonces la
  // pantalla no tendría nada que decir.
  assert.equal(conIntentoFallido(item(), '').situacion, 'falla_del_sistema');
  assert.equal(conIntentoFallido(item(), undefined).situacion, 'falla_del_sistema');
});

test('sin rechazo no hay motivo que mostrar', () => {
  assert.equal(motivoQueSeMuestra(item()), '');
  assert.equal(motivoQueSeMuestra(undefined), '');
});
