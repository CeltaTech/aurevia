/**
 * Cuándo vale una sala de videollamada, y por qué son dos respuestas y no una.
 *
 *   npm test --prefix backend
 *   node --test backend/src/utils/__tests__/videollamada.test.js
 *
 * POR QUÉ EXISTE ESTA PRUEBA. La sala del chat del Marketplace y la de una entrevista de
 * reclutamiento se arman igual, pero no vencen igual: la del chat se cuenta desde que alguien la
 * abrió, y la de la entrevista alrededor de la hora de la cita. Cuando las dos reglas viven en el
 * mismo archivo, es fácil que una tarea futura use la que tiene más a mano. Si eso pasa, una
 * entrevista agendada para la semana que viene nace vencida, y nadie se entera hasta que el
 * postulante llega el día de la cita y encuentra la puerta cerrada.
 *
 * Nada de esto toca la base: son decisiones de tiempo y de armado de direcciones, y se prueban con
 * un reloj puesto a mano.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

// Nada de acá toca la base, pero el archivo que se prueba también sabe leer la dirección base de
// una Prestadora, así que al importarse arma la conexión. Con estas dos puestas se arma y no se
// usa; sin ellas, el archivo no se puede ni importar.
process.env.SUPABASE_URL ||= 'http://127.0.0.1:1/de-mentira';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'clave-de-mentira';

const {
  MINUTOS_DE_ANTICIPO,
  MINUTOS_DE_TOLERANCIA,
  MINUTOS_QUE_VALE_UNA_SALA,
  momentoDeLaCita,
  nombreDeSalaNuevo,
  salaAbiertaSigueValiendo,
  urlDeSala,
} = await import('../videollamada.js');

const AHORA = new Date('2026-10-07T12:00:00.000Z').getTime();
const minutos = (n) => n * 60 * 1000;

describe('la sala que alguien abrió en un chat', () => {
  it('vale mientras no se pase de su ventana', () => {
    assert.equal(salaAbiertaSigueValiendo(new Date(AHORA - minutos(1)).toISOString(), AHORA), true);
    assert.equal(
      salaAbiertaSigueValiendo(
        new Date(AHORA - minutos(MINUTOS_QUE_VALE_UNA_SALA - 1)).toISOString(),
        AHORA,
      ),
      true,
    );
  });

  it('deja de valer pasada la ventana', () => {
    assert.equal(
      salaAbiertaSigueValiendo(
        new Date(AHORA - minutos(MINUTOS_QUE_VALE_UNA_SALA + 1)).toISOString(),
        AHORA,
      ),
      false,
    );
  });

  // Una sala abierta «dentro de un rato» no es una sala vigente: es un dato que no se entiende, y
  // lo que corresponde ahí es negar, no estirar la ventana hacia adelante.
  it('una fecha en el futuro, una vacía o una que no se entiende niegan', () => {
    assert.equal(salaAbiertaSigueValiendo(new Date(AHORA + minutos(5)).toISOString(), AHORA), false);
    assert.equal(salaAbiertaSigueValiendo(null, AHORA), false);
    assert.equal(salaAbiertaSigueValiendo('no es una fecha', AHORA), false);
  });
});

describe('la cita de una entrevista', () => {
  const cita = new Date(AHORA).toISOString();

  // Ésta es la prueba que importa: con la regla del chat, una entrevista agendada para dentro de
  // una semana daría «ya pasó» el mismo día que se agendó.
  it('una entrevista de la semana que viene no nace vencida', () => {
    const laSemanaQueViene = new Date(AHORA + minutos(60 * 24 * 7)).toISOString();
    assert.equal(momentoDeLaCita(laSemanaQueViene, AHORA), 'todavia_no');
  });

  it('se abre antes de la hora, no a la hora justa', () => {
    assert.equal(momentoDeLaCita(cita, AHORA - minutos(MINUTOS_DE_ANTICIPO - 1)), 'ahora');
    assert.equal(momentoDeLaCita(cita, AHORA - minutos(MINUTOS_DE_ANTICIPO + 1)), 'todavia_no');
  });

  it('sigue abierta un rato después, y después no', () => {
    assert.equal(momentoDeLaCita(cita, AHORA + minutos(MINUTOS_DE_TOLERANCIA - 1)), 'ahora');
    assert.equal(momentoDeLaCita(cita, AHORA + minutos(MINUTOS_DE_TOLERANCIA + 1)), 'ya_paso');
  });

  // Falla cerrado: una fecha que no se entiende no abre ninguna puerta.
  it('una fecha que no se entiende no abre nada', () => {
    assert.equal(momentoDeLaCita('cualquier cosa', AHORA), 'ya_paso');
    assert.equal(momentoDeLaCita(null, AHORA), 'ya_paso');
  });
});

describe('el nombre de la sala es toda su protección', () => {
  it('no se repite y no lleva nada que se pueda deducir', () => {
    const nombres = new Set(Array.from({ length: 200 }, () => nombreDeSalaNuevo()));
    assert.equal(nombres.size, 200);
    for (const nombre of nombres) assert.match(nombre, /^[0-9a-f]{32}$/);
  });
});

describe('la dirección de la sala', () => {
  it('se arma pegando la base de la Prestadora y el nombre', () => {
    assert.equal(urlDeSala('https://salas.ejemplo', 'abc'), 'https://salas.ejemplo/abc');
  });

  // Sin base o sin sala no hay media dirección: no hay ninguna, y quien llama tiene que poder
  // distinguirlo de un texto a medio armar.
  it('sin base o sin sala no hay dirección', () => {
    assert.equal(urlDeSala(null, 'abc'), null);
    assert.equal(urlDeSala('https://salas.ejemplo', null), null);
    assert.equal(urlDeSala('', ''), null);
  });
});
