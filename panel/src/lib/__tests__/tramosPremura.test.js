import { describe, expect, it } from 'vitest';
import { ordenarTramosPremura } from '../tramosPremura';

const DE_FABRICA = [
  { maximo_minutos: 60, intervalo_minutos: 10 },
  { maximo_minutos: 240, intervalo_minutos: 30 },
  { maximo_minutos: null, intervalo_minutos: 60 },
];

describe('ordenarTramosPremura', () => {
  it('deja como está una lista que ya venía bien', () => {
    expect(ordenarTramosPremura(DE_FABRICA)).toEqual(DE_FABRICA);
  });

  it('ordena de menor a mayor y deja el abierto al final', () => {
    const desordenados = [
      { maximo_minutos: null, intervalo_minutos: 60 },
      { maximo_minutos: 240, intervalo_minutos: 30 },
      { maximo_minutos: 60, intervalo_minutos: 10 },
    ];
    expect(ordenarTramosPremura(desordenados)).toEqual(DE_FABRICA);
  });

  it('convierte a número lo que la pantalla escribió como texto', () => {
    const escritoAMano = [
      { maximo_minutos: '240', intervalo_minutos: '30' },
      { maximo_minutos: '60', intervalo_minutos: '10' },
      { maximo_minutos: null, intervalo_minutos: '60' },
    ];
    expect(ordenarTramosPremura(escritoAMano)).toEqual(DE_FABRICA);
  });

  it('abre el tramo más ancho cuando ninguno quedó abierto', () => {
    // Sin tramo abierto, pasada la última marca no habría con qué contestar.
    const todosCerrados = [
      { maximo_minutos: 60, intervalo_minutos: 10 },
      { maximo_minutos: 240, intervalo_minutos: 30 },
    ];
    expect(ordenarTramosPremura(todosCerrados)).toEqual([
      { maximo_minutos: 60, intervalo_minutos: 10 },
      { maximo_minutos: null, intervalo_minutos: 30 },
    ]);
  });

  it('se queda con un solo tramo abierto, el primero', () => {
    // Todo lo que va después del primer abierto no se alcanza nunca.
    const dosAbiertos = [
      { maximo_minutos: null, intervalo_minutos: 60 },
      { maximo_minutos: null, intervalo_minutos: 90 },
    ];
    expect(ordenarTramosPremura(dosAbiertos)).toEqual([{ maximo_minutos: null, intervalo_minutos: 60 }]);
  });

  it('una lista vacía o mal guardada no rompe nada', () => {
    expect(ordenarTramosPremura([])).toEqual([]);
    expect(ordenarTramosPremura(null)).toEqual([]);
    expect(ordenarTramosPremura(undefined)).toEqual([]);
    expect(ordenarTramosPremura('cualquier cosa')).toEqual([]);
    expect(ordenarTramosPremura([null, { maximo_minutos: null, intervalo_minutos: 60 }])).toEqual([
      { maximo_minutos: null, intervalo_minutos: 60 },
    ]);
  });
});
