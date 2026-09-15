import { test } from 'node:test';
import assert from 'node:assert/strict';

// La conexión a la base se arma sola al importar, y `createClient` no acepta una dirección vacía.
// Acá no se consulta nada —las dos funciones probadas son puras—, pero el import la trae igual.
// Mismo recurso que en `accesosDelCirculo.test.js`.
process.env.SUPABASE_URL = 'http://127.0.0.1:1';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'clave-de-mentira';
const { turnosDelAviso, turnosPorFamilia } = await import('../avisoCambioDeAsistente.js');

// Las dos armadas del aviso son puras, así que se prueban sin base de datos. Los datos son
// inventados (CLAUDE.md §6).
const GUARDIAS = [
  { id: 'g-2', fecha: '2026-10-08', hora_inicio: '08:00', hora_fin: '16:00' },
  { id: 'g-1', fecha: '2026-10-07', hora_inicio: '22:00', hora_fin: '06:00' },
];

const PACIENTES = new Map([
  ['g-1', [{ id: 'p-1', nombre: 'Elena', familia_id: 'f-1' }]],
  ['g-2', [
    { id: 'p-1', nombre: 'Elena', familia_id: 'f-1' },
    { id: 'p-2', nombre: 'Aníbal', familia_id: 'f-2' },
  ]],
]);

test('los turnos del Coordinador salen ordenados por cuándo ocurren', () => {
  const turnos = turnosDelAviso(GUARDIAS, PACIENTES);
  assert.deepEqual(turnos.map((t) => t.fecha), ['2026-10-07', '2026-10-08']);
  assert.deepEqual(turnos[0], {
    fecha: '2026-10-07', horaInicio: '22:00', horaFin: '06:00', pacientes: ['Elena'],
  });
  assert.deepEqual(turnos[1].pacientes, ['Elena', 'Aníbal']);
});

test('sin guardias no hay turnos', () => {
  assert.deepEqual(turnosDelAviso([], new Map()), []);
  assert.deepEqual(turnosDelAviso(null, null), []);
});

test('un turno sin Pacientes cargados no rompe el aviso', () => {
  const turnos = turnosDelAviso([{ id: 'g-9', fecha: '2026-10-07', hora_inicio: '08:00', hora_fin: '16:00' }], new Map());
  assert.deepEqual(turnos[0].pacientes, []);
});

test('cada Familia ve solamente sus turnos y sus Pacientes', () => {
  const porFamilia = turnosPorFamilia(GUARDIAS, PACIENTES);

  assert.deepEqual([...porFamilia.keys()].sort(), ['f-1', 'f-2']);
  assert.deepEqual(porFamilia.get('f-1').map((t) => t.fecha), ['2026-10-07', '2026-10-08']);
  assert.deepEqual(porFamilia.get('f-2').map((t) => t.fecha), ['2026-10-08']);
  // La Familia 2 no se entera de que en ese turno también hay otro Paciente.
  assert.deepEqual(porFamilia.get('f-2')[0].pacientes, ['Aníbal']);
});

test('un turno que cubre a dos Pacientes de la misma Familia se cuenta una sola vez', () => {
  const pacientes = new Map([['g-1', [
    { id: 'p-1', nombre: 'Elena', familia_id: 'f-1' },
    { id: 'p-3', nombre: 'Rosa', familia_id: 'f-1' },
  ]]]);
  const turnos = turnosPorFamilia([GUARDIAS[1]], pacientes).get('f-1');

  assert.equal(turnos.length, 1);
  assert.deepEqual(turnos[0].pacientes, ['Elena', 'Rosa']);
});

test('un Paciente sin Familia cargada no arma un destinatario vacío', () => {
  const pacientes = new Map([['g-1', [{ id: 'p-4', nombre: 'Sin familia', familia_id: null }]]]);
  assert.equal(turnosPorFamilia([GUARDIAS[1]], pacientes).size, 0);
});
