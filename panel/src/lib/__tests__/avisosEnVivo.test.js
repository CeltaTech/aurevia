import { describe, it, expect } from 'vitest';
import { partir, asuntoDe, ASUNTOS } from '../avisosEnVivo';

/* Lo que se prueba acá es la lectura del formato que manda el motor. La red entrega los pedazos
   donde se le ocurre: un aviso puede llegar partido al medio y dos avisos pueden llegar juntos.
   Si esto se lee mal, la pantalla no se entera de nada y no hay ningún error a la vista. */

describe('partir', () => {
  it('devuelve los avisos completos y guarda lo que quedó a medias', () => {
    const { avisos, pendiente } = partir('', 'event: uno\ndata: {}\n\nevent: do');
    expect(avisos).toEqual(['event: uno\ndata: {}']);
    expect(pendiente).toBe('event: do');
  });

  it('pega lo que quedó a medias con lo que llega después', () => {
    const primero = partir('', 'event: pedi');
    expect(primero.avisos).toEqual([]);

    const segundo = partir(primero.pendiente, 'dos\ndata: {}\n\n');
    expect(segundo.avisos).toEqual(['event: pedidos\ndata: {}']);
    expect(segundo.pendiente).toBe('');
  });

  it('separa dos avisos que llegaron en la misma lectura', () => {
    const { avisos } = partir('', 'event: uno\n\nevent: dos\n\n');
    expect(avisos).toEqual(['event: uno', 'event: dos']);
  });

  it('no da por completo un aviso al que le falta el renglón en blanco', () => {
    const { avisos, pendiente } = partir('', 'event: uno\ndata: {}\n');
    expect(avisos).toEqual([]);
    expect(pendiente).toBe('event: uno\ndata: {}\n');
  });
});

describe('asuntoDe', () => {
  it('saca el asunto del aviso', () => {
    expect(asuntoDe(`event: ${ASUNTOS.PEDIDOS_DE_CODIGO}\ndata: {}`)).toBe(
      ASUNTOS.PEDIDOS_DE_CODIGO,
    );
  });

  // La señal de vida del motor llega como comentario del protocolo. Tomarla por un aviso haría
  // que la pantalla volviera a pedir la lista cada veinte segundos sin que hubiera pasado nada.
  it('no ve ningún asunto en un comentario del protocolo', () => {
    expect(asuntoDe(': sigo acá')).toBe(null);
    expect(asuntoDe(': conectado')).toBe(null);
  });

  it('no ve ningún asunto donde no hay renglón de asunto', () => {
    expect(asuntoDe('data: {}')).toBe(null);
    expect(asuntoDe('')).toBe(null);
  });
});
