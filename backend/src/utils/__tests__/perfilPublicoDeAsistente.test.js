/**
 * El perfil público de un Asistente en la vidriera del Marketplace.
 *
 *   npm test --prefix backend
 *
 * QUÉ SE PRUEBA ACÁ, Y POR QUÉ ESTO. Dos cosas, y las dos son las que hacen daño si se rompen.
 *
 * La primera es el dato de contacto. El Marketplace vende justamente eso —llegar a la persona—
 * y una ficha de Asistente lo tiene todo adentro: teléfono, correo, documento. Alcanza con que
 * una ruta nueva pida una columna de más para que la vidriera lo regale. La prueba arma el
 * perfil a partir de una ficha completa y comprueba que nada de eso salga.
 *
 * La segunda es el orden. Con `ranking_plataforma` apagada, la lista no puede premiar a nadie:
 * si alguien la ordenara por calificación "porque queda mejor", la Prestadora estaría usando
 * una función de riesgo legal que nunca encendió y sin el aviso que le corresponde.
 *
 * Qué daría con el sistema roto: si el orden neutro fuera alfabético o por fecha de alta, la
 * prueba del reparto parejo encuentra siempre a la misma persona primera; si el promedio se
 * calculara sobre cero opiniones, la del recién llegado daría 0 en vez de nada.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  COLUMNAS_PERFIL_PUBLICO,
  NUNCA_SALEN,
  ORDEN,
  ordenarPool,
  perfilPublicoDeAsistente,
  promedioDeCalificaciones,
} from '../perfilPublicoDeAsistente.js';

const HOY = new Date('2026-09-15T10:00:00');

/** Una ficha entera, como la que tiene la base. Datos inventados. */
const FICHA_COMPLETA = {
  id: 'a-1',
  nombre: 'Rosa Giménez',
  foto_url: 'https://ejemplo/foto.jpg',
  zonas: ['Caballito', 'Flores'],
  tipo_asistente_id: 't-1',
  fecha_alta: '2024-03-15',
  telefono: '+54 9 11 5555 0000',
  email: 'rosa@ejemplo.test',
  dni: '30111222',
  disponibilidad: { lunes: true },
  horas_semanales: 40,
  tipo_vinculo: 'monotributo',
  canales: ['marketplace'],
  estado: 'activo',
  qr_token: 'tok-123',
  prestadora_id: 'p-1',
};

describe('qué se ve y qué no se ve de un Asistente en la vidriera', () => {
  it('el dato de contacto no sale, aunque la ficha lo traiga entero', () => {
    const perfil = perfilPublicoDeAsistente({ asistente: FICHA_COMPLETA, ahora: HOY });
    const salida = JSON.stringify(perfil);

    for (const campo of NUNCA_SALEN) {
      assert.ok(!Object.hasOwn(perfil, campo), `salió el campo ${campo}`);
    }
    assert.ok(!salida.includes('5555 0000'), 'salió el teléfono');
    assert.ok(!salida.includes('rosa@ejemplo.test'), 'salió el correo');
    assert.ok(!salida.includes('30111222'), 'salió el documento');
    assert.ok(!salida.includes('tok-123'), 'salió el código del Asistente');
  });

  it('la consulta no pide ninguna columna de contacto: no hay de dónde filtrarla', () => {
    const pedidas = COLUMNAS_PERFIL_PUBLICO.split(',').map((c) => c.trim());
    for (const campo of NUNCA_SALEN) {
      assert.ok(!pedidas.includes(campo), `la consulta pide ${campo}`);
    }
  });

  it('sale lo que hace falta para elegir: qué es, dónde trabaja y desde cuándo', () => {
    const perfil = perfilPublicoDeAsistente({
      asistente: FICHA_COMPLETA,
      tipo: { id: 't-1', clave: 'enfermero', nombre: null, prestadora_id: null },
      ahora: HOY,
    });
    assert.equal(perfil.nombre, 'Rosa Giménez');
    assert.deepEqual(perfil.zonas, ['Caballito', 'Flores']);
    assert.equal(perfil.tipo.clave, 'enfermero');
    assert.equal(perfil.antiguedad_meses, 30);
  });

  it('la insignia de verificación repite lo que ya se le cuenta a la Familia, sin nombrar papeles', () => {
    const perfil = perfilPublicoDeAsistente({
      asistente: FICHA_COMPLETA,
      documentacion: {
        resumen: 'al_dia',
        matricula: 'vigente_verificada',
        papelesExigidos: 3,
        alDia: 3,
      },
      ahora: HOY,
    });
    assert.equal(perfil.verificacion.documentacion, 'al_dia');
    assert.equal(perfil.verificacion.matricula, 'vigente_verificada');
    assert.equal(perfil.verificacion.papeles_al_dia, 3);
  });

  it('sin estado documental no se inventa ninguna insignia', () => {
    const perfil = perfilPublicoDeAsistente({ asistente: FICHA_COMPLETA, ahora: HOY });
    assert.equal(perfil.verificacion, null);
  });
});

describe('el promedio de calificaciones', () => {
  it('sin ninguna opinión no hay promedio: cero opiniones no es un cero', () => {
    assert.equal(promedioDeCalificaciones([]), null);
    assert.equal(promedioDeCalificaciones(null), null);
  });

  it('promedia lo que hay y dice sobre cuántas', () => {
    const r = promedioDeCalificaciones([{ estrellas: 5 }, { estrellas: 4 }, { estrellas: 4 }]);
    assert.equal(r.promedio, 4.3);
    assert.equal(r.cuantas, 3);
  });
});

describe('el orden de la vidriera', () => {
  const perfiles = ['a-1', 'a-2', 'a-3', 'a-4', 'a-5'].map((id) => ({ id, calificacion: null }));

  it('el orden neutro no depende del nombre ni de la antigüedad', () => {
    const conNombres = [
      { id: 'a-1', nombre: 'Acosta', calificacion: null },
      { id: 'a-2', nombre: 'Benítez', calificacion: null },
      { id: 'a-3', nombre: 'Zabala', calificacion: null },
    ];
    const orden = ordenarPool(conNombres, { semilla: '2026-09-15' }).map((p) => p.nombre);
    const alfabetico = [...conNombres].sort((a, b) => a.nombre.localeCompare(b.nombre)).map((p) => p.nombre);
    assert.notDeepEqual(orden, alfabetico, 'el orden neutro quedó alfabético');
  });

  it('adentro del mismo día la lista no se reacomoda sola', () => {
    const uno = ordenarPool(perfiles, { semilla: '2026-09-15' }).map((p) => p.id);
    const otro = ordenarPool(perfiles, { semilla: '2026-09-15' }).map((p) => p.id);
    assert.deepEqual(uno, otro);
  });

  it('y al día siguiente le toca a otro estar primero', () => {
    const primeros = new Set();
    for (const dia of ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18', '2026-09-19']) {
      primeros.add(ordenarPool(perfiles, { semilla: dia })[0].id);
    }
    assert.ok(primeros.size > 1, 'siempre queda primero el mismo');
  });

  it('con la función de riesgo apagada, la mejor calificada no queda primera por eso', () => {
    const conNotas = [
      { id: 'a-1', calificacion: { promedio: 3, cuantas: 4 } },
      { id: 'a-2', calificacion: { promedio: 5, cuantas: 9 } },
      { id: 'a-3', calificacion: { promedio: 4, cuantas: 2 } },
    ];
    // Se prueba en varios días para que el resultado no dependa de que hoy dio distinto.
    const dias = ['2026-09-15', '2026-09-16', '2026-09-17', '2026-09-18'];
    const siempreLaMejor = dias.every((d) => ordenarPool(conNotas, { semilla: d })[0].id === 'a-2');
    assert.ok(!siempreLaMejor, 'la calificación está ordenando con la función apagada');
  });

  it('encendida, ordena por calificación y el que no tiene ninguna va al final', () => {
    const conNotas = [
      { id: 'a-1', calificacion: { promedio: 3, cuantas: 4 } },
      { id: 'a-2', calificacion: null },
      { id: 'a-3', calificacion: { promedio: 5, cuantas: 2 } },
    ];
    const orden = ordenarPool(conNotas, { orden: ORDEN.CALIFICACION, semilla: '2026-09-15' });
    assert.deepEqual(orden.map((p) => p.id), ['a-3', 'a-1', 'a-2']);
  });
});
