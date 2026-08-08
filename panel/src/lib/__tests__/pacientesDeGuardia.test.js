import { describe, expect, it, vi } from 'vitest';

// Este archivo prueba las cuentas, no la base. La conexión a Supabase se reemplaza por una
// vacía para que importar el módulo no intente conectarse a ningún lado.
vi.mock('../supabaseClient', () => ({ supabase: {} }));

const {
  SIN_PACIENTES,
  atiendeAVarios,
  conPacientes,
  filasPorPaciente,
  pacientesDeGuardia,
  resumenDePacientes,
  textoDePacientes,
} = await import('../pacientesDeGuardia');

const ELENA = '50000000-0000-4000-8000-000000000001';
const ALBERTO = '50000000-0000-4000-8000-000000000004';

const NOMBRES = { [ELENA]: 'Elena Gómez', [ALBERTO]: 'Alberto Gómez' };

describe('pacientesDeGuardia', () => {
  it('devuelve la lista completa cuando la guardia cubre a dos personas', () => {
    const mapa = new Map([['g1', [ELENA, ALBERTO]]]);
    expect(pacientesDeGuardia({ id: 'g1', paciente_id: ELENA }, mapa)).toEqual([ELENA, ALBERTO]);
  });

  it('si la pantalla todavía no pidió la lista, cae al Paciente de la columna vieja', () => {
    expect(pacientesDeGuardia({ id: 'g1', paciente_id: ELENA }, new Map())).toEqual([ELENA]);
  });

  it('una guardia sin nadie devuelve una lista vacía, no un nulo', () => {
    expect(pacientesDeGuardia({ id: 'g1', paciente_id: null }, new Map())).toEqual([]);
  });

  it('no se rompe si no le pasan ni guardia ni mapa', () => {
    expect(pacientesDeGuardia(undefined, undefined)).toEqual([]);
  });
});

describe('atiendeAVarios', () => {
  it('con una sola persona es falso', () => {
    expect(atiendeAVarios({ id: 'g1' }, new Map([['g1', [ELENA]]]))).toBe(false);
  });

  it('con dos personas es verdadero', () => {
    expect(atiendeAVarios({ id: 'g1' }, new Map([['g1', [ELENA, ALBERTO]]]))).toBe(true);
  });
});

describe('conPacientes', () => {
  it('agrega los ids y los nombres, ordenados alfabéticamente', () => {
    const mapa = new Map([['g1', [ELENA, ALBERTO]]]);
    const [fila] = conPacientes([{ id: 'g1', fecha: '2026-08-20' }], mapa, NOMBRES);
    expect(fila.paciente_ids).toEqual([ALBERTO, ELENA]);
    expect(fila.pacientes_nombres).toEqual(['Alberto Gómez', 'Elena Gómez']);
    expect(fila.fecha).toBe('2026-08-20');
  });

  it('cada id viaja pegado a su nombre, aunque el orden cambie', () => {
    const mapa = new Map([['g1', [ELENA, ALBERTO]]]);
    const [fila] = conPacientes([{ id: 'g1' }], mapa, NOMBRES);
    // Elena entró primera y sale segunda: si los ids y los nombres se ordenaran por separado,
    // acá quedaría el nombre de una al lado del id de la otra.
    expect(fila.pacientes).toEqual([
      { id: ALBERTO, nombre: 'Alberto Gómez' },
      { id: ELENA, nombre: 'Elena Gómez' },
    ]);
  });

  it('un nombre que todavía no cargó entra como nulo, no desaparece', () => {
    const mapa = new Map([['g1', [ELENA, 'desconocido']]]);
    const [fila] = conPacientes([{ id: 'g1' }], mapa, NOMBRES);
    expect(fila.paciente_ids).toHaveLength(2);
    expect(fila.pacientes_nombres).toHaveLength(2);
    expect(fila.pacientes_nombres).toContain('Elena Gómez');
    expect(fila.pacientes_nombres).toContain(null);
  });

  it('con una lista vacía de guardias devuelve una lista vacía', () => {
    expect(conPacientes([], new Map(), NOMBRES)).toEqual([]);
  });
});

describe('textoDePacientes', () => {
  it('junta los nombres con un separador', () => {
    expect(textoDePacientes(['Alberto Gómez', 'Elena Gómez'], 'y {n} más')).toBe(
      'Alberto Gómez · Elena Gómez'
    );
  });

  it('el caso del asilo: muestra dos y dice cuántos faltan', () => {
    const veinte = Array.from({ length: 20 }, (_, i) => `Paciente ${i + 1}`);
    expect(textoDePacientes(veinte, 'y {n} más')).toBe('Paciente 1 · Paciente 2 · y 18 más');
  });

  it('sin nadie devuelve el texto de vacío que le pasen', () => {
    expect(textoDePacientes([], 'y {n} más')).toBe('—');
    expect(textoDePacientes(null, 'y {n} más', null)).toBe(null);
  });
});

describe('resumenDePacientes', () => {
  it('con dos o menos los muestra a todos y no queda nadie afuera', () => {
    expect(resumenDePacientes(['Elena Gómez', 'Alberto Gómez'])).toEqual({
      visibles: ['Elena Gómez', 'Alberto Gómez'],
      restantes: 0,
    });
  });

  it('el caso del asilo: muestra los primeros y cuenta los que faltan', () => {
    const veinte = Array.from({ length: 20 }, (_, i) => `Paciente ${i + 1}`);
    const { visibles, restantes } = resumenDePacientes(veinte);
    expect(visibles).toHaveLength(2);
    expect(restantes).toBe(18);
  });

  it('los nombres que todavía no cargaron no se cuentan', () => {
    expect(resumenDePacientes(['Elena Gómez', null, null]).restantes).toBe(0);
  });
});

describe('filasPorPaciente', () => {
  it('un turno de tres personas aparece en las tres filas de la vista por Paciente', () => {
    const guardia = conPacientes(
      [{ id: 'g1' }],
      new Map([['g1', [ELENA, ALBERTO, 'tercero']]]),
      NOMBRES
    )[0];
    expect(filasPorPaciente(guardia)).toHaveLength(3);
    expect(filasPorPaciente(guardia)).toContain(ELENA);
    expect(filasPorPaciente(guardia)).toContain(ALBERTO);
  });

  it('si la lista todavía no llegó, cae al Paciente de la columna vieja', () => {
    expect(filasPorPaciente({ id: 'g1', paciente_id: ELENA })).toEqual([ELENA]);
  });

  it('una guardia sin nadie va a la fila de los que no tienen Paciente', () => {
    expect(filasPorPaciente({ id: 'g1' })).toEqual([SIN_PACIENTES]);
  });
});
