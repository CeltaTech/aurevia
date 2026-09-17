import { describe, it, expect } from 'vitest';
import { familiasConSuLocalidad, filtrarFamilias, localidadesConFamilias } from '../familiasPorLocalidad';

// Localidades inventadas. Las dos primeras se llaman igual a propósito: hay un Belgrano en la
// Ciudad y otro en San Isidro, y mientras esto eran palabras tecleadas las dos eran la misma.
const BELGRANO_CIUDAD = 'a1000000-0000-4000-8000-000000000001';
const BELGRANO_SAN_ISIDRO = 'a1000000-0000-4000-8000-000000000004';
const AVELLANEDA = 'a1000000-0000-4000-8000-000000000005';
const DESHABITADA = 'a1000000-0000-4000-8000-000000000009';

const CATALOGO = [
  { id: BELGRANO_CIUDAD, nombre: 'Belgrano' },
  { id: BELGRANO_SAN_ISIDRO, nombre: 'Belgrano' },
  { id: AVELLANEDA, nombre: 'Avellaneda' },
  { id: DESHABITADA, nombre: 'Lanús' },
];

const nombreDeLugar = (id) => CATALOGO.find((lugar) => lugar.id === id)?.nombre ?? '';

// Familias inventadas, cada una con una forma distinta a propósito.
const FILAS = [
  {
    id: 'f1',
    solicitudes: { nombre: 'Alba Ferreyra', email: 'alba@ejemplo.test', telefono: '11 5555 0001', localidad: 'belgrano' },
    pacientes: [{ id: 'p1', lugar_id: BELGRANO_CIUDAD, deleted_at: null }],
  },
  {
    id: 'f2',
    solicitudes: { nombre: 'Bruno Salas', email: 'bruno@ejemplo.test', telefono: '11 5555 0002', localidad: 'san isidro' },
    pacientes: [
      { id: 'p2', lugar_id: BELGRANO_SAN_ISIDRO, deleted_at: null },
      { id: 'p3', lugar_id: AVELLANEDA, deleted_at: null },
    ],
  },
  {
    id: 'f3',
    solicitudes: { nombre: 'Celia Ortiz', email: 'celia@ejemplo.test', telefono: '11 5555 0003', localidad: 'avellaneda' },
    pacientes: [{ id: 'p4', lugar_id: AVELLANEDA, deleted_at: '2026-09-01T00:00:00Z' }],
  },
  {
    id: 'f4',
    solicitudes: { nombre: 'Delia Roca', email: 'delia@ejemplo.test', telefono: '11 5555 0004', localidad: 'vicente lopez' },
    pacientes: [{ id: 'p5', lugar_id: null, deleted_at: null }],
  },
];

const FAMILIAS = familiasConSuLocalidad(FILAS, nombreDeLugar);
const cuales = (lista) => lista.map((fam) => fam.id);

describe('dónde está cada Familia', () => {
  it('está donde viven sus Pacientes, y puede estar en más de un lugar', () => {
    const bruno = FAMILIAS.find((fam) => fam.id === 'f2');
    expect(bruno.lugares).toEqual([BELGRANO_SAN_ISIDRO, AVELLANEDA]);
    expect(bruno.nombresDeLugares).toEqual(['Avellaneda', 'Belgrano']);
  });

  it('el Paciente dado de baja no la pone en ningún lado ni se cuenta', () => {
    const celia = FAMILIAS.find((fam) => fam.id === 'f3');
    expect(celia.lugares).toEqual([]);
    expect(celia.cuantosPacientes).toBe(0);
  });

  it('el Paciente sin localidad elegida no inventa ninguna', () => {
    const delia = FAMILIAS.find((fam) => fam.id === 'f4');
    expect(delia.lugares).toEqual([]);
    expect(delia.cuantosPacientes).toBe(1);
  });
});

describe('buscar por localidad', () => {
  it('sin filtro no se filtra nada', () => {
    expect(cuales(filtrarFamilias(FAMILIAS, {}))).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  it('dos localidades que se llaman igual son dos, no una', () => {
    expect(cuales(filtrarFamilias(FAMILIAS, { lugar: BELGRANO_CIUDAD }))).toEqual(['f1']);
    expect(cuales(filtrarFamilias(FAMILIAS, { lugar: BELGRANO_SAN_ISIDRO }))).toEqual(['f2']);
  });

  it('una Familia con Pacientes en dos localidades aparece buscando cualquiera de las dos', () => {
    expect(cuales(filtrarFamilias(FAMILIAS, { lugar: AVELLANEDA }))).toEqual(['f2']);
  });

  it('el texto libre busca el contacto y no la localidad', () => {
    // «belgrano» es la localidad que escribió quien llamó, y aun así el buscador de texto no la
    // mira: la localidad se elige de la lista. Si esto trajera a f1, las dos maneras de buscar se
    // habrían mezclado.
    expect(cuales(filtrarFamilias(FAMILIAS, { busqueda: 'belgrano' }))).toEqual([]);
    expect(cuales(filtrarFamilias(FAMILIAS, { busqueda: 'salas' }))).toEqual(['f2']);
  });

  it('los dos filtros se cumplen a la vez', () => {
    expect(cuales(filtrarFamilias(FAMILIAS, { lugar: AVELLANEDA, busqueda: 'alba' }))).toEqual([]);
  });
});

describe('qué localidades se ofrecen', () => {
  it('sólo aquellas donde vive alguien, y en el orden del catálogo', () => {
    expect(localidadesConFamilias(FAMILIAS, CATALOGO).map((lugar) => lugar.id)).toEqual([
      BELGRANO_CIUDAD,
      BELGRANO_SAN_ISIDRO,
      AVELLANEDA,
    ]);
  });

  it('la localidad donde no hay nadie no se ofrece', () => {
    expect(localidadesConFamilias(FAMILIAS, CATALOGO).some((lugar) => lugar.id === DESHABITADA)).toBe(false);
  });
});
