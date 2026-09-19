/**
 * De qué Prestadora es la puerta por donde se entra.
 *
 *   npx vitest run   (desde panel/)
 *
 * POR QUÉ EXISTE ESTA PRUEBA. De esto sale con qué cuenta se intenta entrar, así que se rompe de
 * dos maneras silenciosas: haciendo que una dirección con subdominio busque un dominio que nadie
 * cargó —y entonces nadie entra—, y dejando que una dirección vacía o rara caiga en alguna
 * Prestadora por descarte, que es entrar por la puerta de otro.
 *
 * Los datos son inventados.
 */
import { describe, it, expect } from 'vitest';
import { segmentoDeLaPuerta, laPuertaEstaReconocida } from '../puertaDeIngreso';
import { IDENTIDAD } from '../../config/identidadProducto';

describe('el segmento que sale de la dirección', () => {
  it('de una dirección del producto queda la primera etiqueta', () => {
    expect(segmentoDeLaPuerta(`cuidardelsur.${IDENTIDAD.dominio}`)).toBe('cuidardelsur');
  });

  it('y con el «www» adelante, también', () => {
    expect(segmentoDeLaPuerta(`www.cuidardelsur.${IDENTIDAD.dominio}`)).toBe('cuidardelsur');
  });

  it('de una dirección propia de la Prestadora viaja entera', () => {
    expect(segmentoDeLaPuerta('panel.cuidardelsur.com.ar')).toBe('panel.cuidardelsur.com.ar');
  });

  it('la máquina de trabajo entra por la Prestadora de pruebas', () => {
    expect(segmentoDeLaPuerta('localhost')).toBe('localhost');
  });

  it('las mayúsculas y los espacios no hacen otra puerta', () => {
    expect(segmentoDeLaPuerta(`  CuidarDelSur.${IDENTIDAD.dominio.toUpperCase()}  `)).toBe('cuidardelsur');
  });

  it('la dirección del producto sin ninguna Prestadora adelante no es de nadie', () => {
    // Viaja entera y el motor no la reconoce: lo que no puede pasar es que caiga en la primera
    // Prestadora cargada.
    expect(segmentoDeLaPuerta(IDENTIDAD.dominio)).toBe(IDENTIDAD.dominio);
  });

  it('sin dirección no hay puerta', () => {
    expect(segmentoDeLaPuerta('')).toBe('');
    expect(segmentoDeLaPuerta(null)).toBe('');
    expect(segmentoDeLaPuerta(undefined)).toBe('');
  });
});

describe('cuándo se da por reconocida la puerta', () => {
  it('con el identificador de la Prestadora, sí', () => {
    expect(laPuertaEstaReconocida({ prestadoraId: '11111111-1111-4111-8111-111111111111' })).toBe(true);
  });

  // Los cinco casos que no se dan por reconocidos. Un control que decide con un valor vacío deja
  // pasar justo el caso que no entendió.
  it('sin identificador, no', () => {
    expect(laPuertaEstaReconocida(null)).toBe(false);
    expect(laPuertaEstaReconocida(undefined)).toBe(false);
    expect(laPuertaEstaReconocida({})).toBe(false);
    expect(laPuertaEstaReconocida({ prestadoraId: '' })).toBe(false);
    expect(laPuertaEstaReconocida({ prestadoraId: '   ' })).toBe(false);
  });

  it('y un nombre solo no alcanza', () => {
    // Que el motor conteste algo no quiere decir que haya Prestadora: sin identificador no hay
    // cuenta de acceso que armar.
    expect(laPuertaEstaReconocida({ nombre: 'Cuidar del Sur' })).toBe(false);
  });
});
