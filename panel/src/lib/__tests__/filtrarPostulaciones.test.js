import { describe, it, expect } from 'vitest';
import { filtrarPostulaciones } from '../filtrarPostulaciones';

// Personas inventadas. Cada una está armada para caer de un solo lado de algún filtro, así que
// con el filtrado roto —dejando pasar todo, o escondiendo a quien no declaró un dato— el nombre
// que sobra o falta dice cuál condición se rompió.
const ADA = {
  nombre: 'Ada Ponce',
  email: 'ada.ponce@ejemplo.test',
  telefono: '11 5555 0001',
  estado: 'pendiente',
  especialidades: 'enfermeria,kinesiologia',
  zonas: 'norte',
  disponibilidad: 'manana,tarde',
  situacion_fiscal: 'monotributo',
  disponible_urgencias: true,
  disponible_con_retiro: true,
  disponible_sin_retiro: false,
  honorario_pretendido: 4500,
  distancia_maxima_km: 30,
};

const BRUNO = {
  nombre: 'Bruno Salas',
  email: 'bruno.salas@ejemplo.test',
  telefono: '11 5555 0002',
  estado: 'aprobado',
  especialidades: 'kinesiologia',
  zonas: 'sur',
  disponibilidad: 'noche',
  situacion_fiscal: 'relacion_dependencia',
  disponible_urgencias: false,
  disponible_con_retiro: false,
  disponible_sin_retiro: true,
  honorario_pretendido: 9000,
  distancia_maxima_km: 5,
};

// No dijo cuánto pretende cobrar ni hasta dónde viaja: es el caso que decide qué hace cada filtro
// con el dato ausente.
const CALLADA = {
  nombre: 'Carla Vidal',
  email: 'carla.vidal@ejemplo.test',
  telefono: '11 5555 0003',
  estado: 'pendiente',
  especialidades: 'enfermeria',
  zonas: 'norte',
  disponibilidad: 'manana',
  situacion_fiscal: 'monotributo',
  disponible_urgencias: false,
  disponible_con_retiro: false,
  disponible_sin_retiro: false,
  honorario_pretendido: null,
  distancia_maxima_km: null,
};

const TODAS = [ADA, BRUNO, CALLADA];
const nombres = (filas) => filas.map((p) => p.nombre);

describe('qué postulaciones quedan después de los filtros', () => {
  it('sin ningún filtro puesto quedan todas', () => {
    expect(filtrarPostulaciones(TODAS, {})).toHaveLength(3);
    expect(filtrarPostulaciones(TODAS, { busqueda: '', estado: '', honorario_desde: '' })).toHaveLength(3);
  });

  it('la búsqueda mira nombre, correo y teléfono, sin importar mayúsculas', () => {
    expect(nombres(filtrarPostulaciones(TODAS, { busqueda: 'PONCE' }))).toEqual(['Ada Ponce']);
    expect(nombres(filtrarPostulaciones(TODAS, { busqueda: 'bruno.salas@' }))).toEqual(['Bruno Salas']);
    expect(nombres(filtrarPostulaciones(TODAS, { busqueda: '0003' }))).toEqual(['Carla Vidal']);
  });

  it('las listas de códigos se buscan por código entero, no por pedazo', () => {
    expect(nombres(filtrarPostulaciones(TODAS, { especialidad: 'enfermeria' }))).toEqual(['Ada Ponce', 'Carla Vidal']);
    expect(filtrarPostulaciones(TODAS, { especialidad: 'enfer' })).toHaveLength(0);
    expect(nombres(filtrarPostulaciones(TODAS, { zona: 'sur' }))).toEqual(['Bruno Salas']);
    expect(nombres(filtrarPostulaciones(TODAS, { disponibilidad: 'tarde' }))).toEqual(['Ada Ponce']);
  });

  it('la situación fiscal y la situación de la postulación filtran por valor exacto', () => {
    expect(nombres(filtrarPostulaciones(TODAS, { situacion_fiscal: 'monotributo' }))).toEqual(['Ada Ponce', 'Carla Vidal']);
    expect(nombres(filtrarPostulaciones(TODAS, { estado: 'aprobado' }))).toEqual(['Bruno Salas']);
  });

  it('urgencias deja solamente a quien lo marcó', () => {
    expect(nombres(filtrarPostulaciones(TODAS, { urgencias: 'si' }))).toEqual(['Ada Ponce']);
    expect(filtrarPostulaciones(TODAS, { urgencias: '' })).toHaveLength(3);
  });

  it('el tipo de servicio pregunta por el que se eligió y no deduce el otro', () => {
    expect(nombres(filtrarPostulaciones(TODAS, { tipo_servicio: 'con_retiro' }))).toEqual(['Ada Ponce']);
    expect(nombres(filtrarPostulaciones(TODAS, { tipo_servicio: 'sin_retiro' }))).toEqual(['Bruno Salas']);
  });

  it('el rango de honorario incluye los extremos', () => {
    expect(nombres(filtrarPostulaciones(TODAS, { honorario_desde: '4500' }))).toEqual(['Ada Ponce', 'Bruno Salas']);
    expect(nombres(filtrarPostulaciones(TODAS, { honorario_hasta: '4500' }))).toEqual(['Ada Ponce']);
    expect(nombres(filtrarPostulaciones(TODAS, { honorario_desde: '4000', honorario_hasta: '5000' }))).toEqual(['Ada Ponce']);
  });

  it('quien no dijo cuánto pretende cobrar sólo queda afuera cuando se pide un rango', () => {
    expect(nombres(filtrarPostulaciones(TODAS, {}))).toContain('Carla Vidal');
    expect(nombres(filtrarPostulaciones(TODAS, { honorario_hasta: '999999' }))).not.toContain('Carla Vidal');
  });

  it('la distancia es "viaja al menos tantos kilómetros"', () => {
    expect(nombres(filtrarPostulaciones(TODAS, { distancia_desde: '20' }))).toEqual(['Ada Ponce']);
    expect(nombres(filtrarPostulaciones(TODAS, { distancia_desde: '5' }))).toEqual(['Ada Ponce', 'Bruno Salas']);
  });

  it('un número escrito a medias no esconde a nadie', () => {
    // Mientras se escribe "-" o "1e", `Number` da `NaN`. Un filtro que todavía no se entiende no
    // puede vaciar la lista y hacer creer que no hay postulantes.
    for (const escrito of ['-', 'e', 'abc']) {
      expect(filtrarPostulaciones(TODAS, { honorario_desde: escrito })).toHaveLength(3);
      expect(filtrarPostulaciones(TODAS, { distancia_desde: escrito })).toHaveLength(3);
    }
  });

  it('los filtros se suman entre sí', () => {
    const quedan = filtrarPostulaciones(TODAS, {
      estado: 'pendiente',
      especialidad: 'enfermeria',
      zona: 'norte',
      situacion_fiscal: 'monotributo',
      urgencias: 'si',
    });
    expect(nombres(quedan)).toEqual(['Ada Ponce']);
  });

  it('con algo que no es una lista devuelve una lista vacía', () => {
    for (const nada of [null, undefined, 'Ada', 42, {}]) {
      expect(filtrarPostulaciones(nada, {})).toEqual([]);
    }
  });
});
