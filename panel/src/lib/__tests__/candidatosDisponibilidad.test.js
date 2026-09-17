/**
 * El interruptor de disponibilidad del Asistente, visto desde la lista de candidatos.
 *
 *   npm test --prefix panel
 *
 * QUÉ SE PRUEBA ACÁ, Y POR QUÉ ESTO Y NO OTRA COSA. La regla tiene dos mitades y la que se
 * equivoca fácil es la segunda: quien se puso no disponible **sigue apareciendo** y **se le
 * puede asignar la guardia igual**. Una implementación que lo sacara de la lista, o que lo
 * marcara como bloqueado, pasaría cualquier prueba que sólo mirara "aparece el motivo".
 *
 * Qué daría con el sistema roto: si alguien cambiara el `suma(...)` por un `bloqueado = true`,
 * la tercera prueba falla; si filtrara la lista como se filtra a quien ya no está en el plantel,
 * falla la primera.
 */
import { describe, expect, it } from 'vitest';
import { candidatosParaGuardia, estaDisponibleParaOfertas, MOTIVO } from '../candidatos';

const HUECO = {
  id: 'g-1',
  fecha: '2026-09-20',
  hora_inicio: '08:00',
  hora_fin: '16:00',
  canal_modalidad: 'directa',
  paciente_ids: [],
};

const DISPONIBLE = {
  id: 'a-1',
  nombre: 'Ana Prueba',
  estado: 'activo',
  canales: ['directa'],
  disponible_para_ofertas: true,
};

const NO_DISPONIBLE = {
  id: 'a-2',
  nombre: 'Bruno Prueba',
  estado: 'activo',
  canales: ['directa'],
  disponible_para_ofertas: false,
};

/** El que había antes de que la columna existiera: llega sin el dato. */
const SIN_EL_DATO = { id: 'a-3', nombre: 'Carla Prueba', estado: 'activo', canales: ['directa'] };

const evaluar = (asistentes) =>
  candidatosParaGuardia(HUECO, { asistentes, ahora: new Date('2026-09-18T10:00:00') });

const motivosEnContra = (candidato) => candidato.enContra.map((m) => m.clave);

describe('el interruptor de disponibilidad en la lista de candidatos', () => {
  it('quien se puso no disponible sigue en la lista', () => {
    const lista = evaluar([DISPONIBLE, NO_DISPONIBLE]);
    expect(lista.map((c) => c.asistente.id)).toContain(NO_DISPONIBLE.id);
  });

  it('y se ve por qué quedó donde quedó', () => {
    const bruno = evaluar([DISPONIBLE, NO_DISPONIBLE]).find((c) => c.asistente.id === NO_DISPONIBLE.id);
    expect(motivosEnContra(bruno)).toContain(MOTIVO.NO_DISPONIBLE);
  });

  it('pero no queda bloqueado: la Coordinadora puede asignarle la guardia igual', () => {
    const bruno = evaluar([DISPONIBLE, NO_DISPONIBLE]).find((c) => c.asistente.id === NO_DISPONIBLE.id);
    expect(bruno.bloqueado).toBe(false);
    // Ni desaconsejado, que es la otra forma de mandarlo al fondo. Esto es una preferencia que
    // puso él, no un hecho de la agenda: resta puntos y nada más.
    expect(bruno.desaconsejado).toBe(false);
  });

  it('queda debajo de quien sí está disponible', () => {
    const lista = evaluar([NO_DISPONIBLE, DISPONIBLE]);
    expect(lista.map((c) => c.asistente.id)).toEqual([DISPONIBLE.id, NO_DISPONIBLE.id]);
  });

  it('a quien está disponible no se le dice nada: no hay nada que avisar', () => {
    const ana = evaluar([DISPONIBLE]).find((c) => c.asistente.id === DISPONIBLE.id);
    expect(motivosEnContra(ana)).not.toContain(MOTIVO.NO_DISPONIBLE);
    expect(ana.aFavor.map((m) => m.clave)).not.toContain(MOTIVO.NO_DISPONIBLE);
  });

  it('sin el dato cargado se lo trata como disponible, no como apagado', () => {
    const carla = evaluar([SIN_EL_DATO]).find((c) => c.asistente.id === SIN_EL_DATO.id);
    expect(motivosEnContra(carla)).not.toContain(MOTIVO.NO_DISPONIBLE);
  });
});

describe('estaDisponibleParaOfertas', () => {
  it('sólo un false explícito lo apaga', () => {
    expect(estaDisponibleParaOfertas({ disponible_para_ofertas: false })).toBe(false);
    expect(estaDisponibleParaOfertas({ disponible_para_ofertas: true })).toBe(true);
    expect(estaDisponibleParaOfertas({})).toBe(true);
    expect(estaDisponibleParaOfertas(null)).toBe(true);
  });
});
