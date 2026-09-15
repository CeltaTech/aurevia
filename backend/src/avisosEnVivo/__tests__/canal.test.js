import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { escuchar, empujar, cuantosEscuchan, ASUNTOS } from '../canal.js';

/* Toda conexión que abrió una prueba, para cerrarla al terminar. No es prolijidad: una conexión
   abierta deja andando la señal de vida y el reloj que la cierra, y con un reloj pendiente el
   proceso de pruebas no termina nunca. */
const abiertas = [];

afterEach(() => {
  while (abiertas.length) abiertas.pop().end();
});

/* Una respuesta HTTP de mentira, que guarda lo que le escriben en vez de mandarlo a ningún lado.
   Es un `EventEmitter` porque el canal se entera de que una conexión se fue por el evento
   `close`, que es exactamente como se entera de verdad. */
function respuestaDeMentira() {
  const res = new EventEmitter();
  res.encabezados = null;
  res.escrito = [];
  res.terminada = false;
  res.writeHead = (codigo, encabezados) => {
    res.codigo = codigo;
    res.encabezados = encabezados;
  };
  res.write = (texto) => res.escrito.push(texto);
  res.end = () => {
    if (res.terminada) return;
    res.terminada = true;
    res.emit('close');
  };
  abiertas.push(res);
  return res;
}

/** Sólo los avisos: lo que empieza con dos puntos son comentarios del protocolo. */
const avisosDe = (res) => res.escrito.filter((t) => !t.startsWith(':'));

// Cada prueba usa Organizaciones propias para no depender del orden en que corren: el registro de
// quién escucha es uno solo y vive mientras dure el proceso.
let siguiente = 0;
const otraPrestadora = () => `prestadora-de-prueba-${(siguiente += 1)}`;

test('el aviso llega a quien escucha esa Organización', () => {
  const prestadora = otraPrestadora();
  const res = respuestaDeMentira();

  escuchar(res, prestadora);
  assert.equal(res.codigo, 200);
  assert.equal(res.encabezados['Content-Type'], 'text/event-stream');
  assert.equal(cuantosEscuchan(prestadora), 1);

  empujar(prestadora, ASUNTOS.PEDIDOS_DE_CODIGO);

  assert.deepEqual(avisosDe(res), [`event: ${ASUNTOS.PEDIDOS_DE_CODIGO}\ndata: {}\n\n`]);
});

// Es la prueba que sostiene el aislamiento de este canal: si empujara a todas las conexiones
// abiertas, cada Prestadora se enteraría del movimiento de las demás.
test('el aviso de una Organización no llega a otra', () => {
  const unaPrestadora = otraPrestadora();
  const otra = otraPrestadora();
  const deUna = respuestaDeMentira();
  const deLaOtra = respuestaDeMentira();

  escuchar(deUna, unaPrestadora);
  escuchar(deLaOtra, otra);

  empujar(unaPrestadora, ASUNTOS.PEDIDOS_DE_CODIGO);

  assert.equal(avisosDe(deUna).length, 1);
  assert.deepEqual(avisosDe(deLaOtra), []);
});

test('dos pantallas de la misma Organización reciben las dos', () => {
  const prestadora = otraPrestadora();
  const una = respuestaDeMentira();
  const otra = respuestaDeMentira();

  escuchar(una, prestadora);
  escuchar(otra, prestadora);
  assert.equal(cuantosEscuchan(prestadora), 2);

  empujar(prestadora, ASUNTOS.PEDIDOS_DE_CODIGO);

  assert.equal(avisosDe(una).length, 1);
  assert.equal(avisosDe(otra).length, 1);
});

// Sin esto el registro crecería con cada pestaña que se cerró, y el motor le escribiría a
// conexiones muertas en cada aviso.
test('la conexión que se va deja de estar en la lista', () => {
  const prestadora = otraPrestadora();
  const res = respuestaDeMentira();

  escuchar(res, prestadora);
  res.emit('close');

  assert.equal(cuantosEscuchan(prestadora), 0);

  empujar(prestadora, ASUNTOS.PEDIDOS_DE_CODIGO);
  assert.deepEqual(avisosDe(res), []);
});

test('empujar sin nadie escuchando no rompe nada', () => {
  assert.doesNotThrow(() => empujar(otraPrestadora(), ASUNTOS.PEDIDOS_DE_CODIGO));
});

// Una conexión que se cayó entre medio no puede cortar el aviso a las demás.
test('una conexión rota no deja sin aviso a las otras', () => {
  const prestadora = otraPrestadora();
  const rota = respuestaDeMentira();
  const sana = respuestaDeMentira();

  escuchar(rota, prestadora);
  escuchar(sana, prestadora);
  // Se cae después de haber quedado conectada, que es el caso real: el motor todavía la tiene en
  // la lista cuando le va a escribir.
  rota.write = () => {
    throw new Error('conexión cerrada');
  };

  assert.doesNotThrow(() => empujar(prestadora, ASUNTOS.PEDIDOS_DE_CODIGO));
  assert.equal(avisosDe(sana).length, 1);
});

test('la señal de vida sale sola y la conexión se cierra al cumplir su tiempo', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const prestadora = otraPrestadora();
  const res = respuestaDeMentira();

  escuchar(res, prestadora);
  const alPrincipio = res.escrito.length;

  // Un minuto: alcanza para varias señales de vida y no llega al cierre.
  t.mock.timers.tick(60 * 1000);
  assert.ok(res.escrito.length > alPrincipio, 'no salió ninguna señal de vida');
  assert.ok(
    res.escrito.every((escrito) => escrito.startsWith(':')),
    'la señal de vida no puede ser un aviso',
  );
  assert.equal(res.terminada, false);

  // Pasada la vida de la conexión, la cierra el motor para que la pantalla la reabra y el
  // permiso se vuelva a comprobar.
  t.mock.timers.tick(15 * 60 * 1000);
  assert.equal(res.terminada, true);
  assert.equal(cuantosEscuchan(prestadora), 0);
});
