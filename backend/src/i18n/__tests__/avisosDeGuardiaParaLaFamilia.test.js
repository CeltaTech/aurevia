// Los avisos de guardia que le llegan a la Familia. Se prueban rompiéndolos a propósito: un
// idioma que falta, una clave que no existe y una guardia que no se pudo leer no pueden dejar
// salir un aviso a medias, y nada de adentro puede aparecer en el texto.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AVISOS_DE_GUARDIA_PARA_LA_FAMILIA,
  avisoDeGuardiaParaLaFamilia,
} from '../avisosDeGuardiaParaLaFamilia.js';

const IDIOMAS = ['es-AR', 'en', 'pt-BR'];
const CLAVES = ['guardia_sin_cerrar_familia', 'guardia_sin_cerrar_grave_familia', 'alerta_temprana_guardia_familia'];

const GUARDIA = {
  fecha: '2026-09-19',
  horaInicio: '08:00',
  horaFin: '16:00',
  pacientes: ['Marta Giménez'],
};

test('los tres idiomas tienen exactamente las mismas claves', () => {
  for (const idioma of IDIOMAS) {
    assert.deepEqual(Object.keys(AVISOS_DE_GUARDIA_PARA_LA_FAMILIA[idioma]).sort(), [...CLAVES].sort(), `en ${idioma}`);
  }
});

test('ningún aviso deja un hueco a la vista en ninguno de los tres idiomas', () => {
  for (const idioma of IDIOMAS) {
    for (const clave of CLAVES) {
      const { titulo, cuerpo } = avisoDeGuardiaParaLaFamilia(clave, idioma, GUARDIA);
      assert.ok(titulo.trim().length > 0, `${clave} en ${idioma} sin título`);
      assert.ok(cuerpo.trim().length > 0, `${clave} en ${idioma} sin cuerpo`);
      assert.equal(cuerpo.includes('undefined'), false, `${clave} en ${idioma} deja un hueco`);
      assert.equal(cuerpo.includes('[object Object]'), false, `${clave} en ${idioma} deja un hueco`);
      assert.ok(cuerpo.includes('Marta Giménez'), `${clave} en ${idioma} no nombra al Paciente`);
    }
  }
});

test('un idioma que no está cae a es-AR en vez de salir vacío', () => {
  const caido = avisoDeGuardiaParaLaFamilia('guardia_sin_cerrar_familia', 'fr-FR', GUARDIA);
  assert.deepEqual(caido, avisoDeGuardiaParaLaFamilia('guardia_sin_cerrar_familia', 'es-AR', GUARDIA));
});

test('una clave que no existe no manda nada', () => {
  assert.equal(avisoDeGuardiaParaLaFamilia('lo_que_sea', 'es-AR', GUARDIA), null);
});

test('una guardia sin Pacientes cargados se nombra igual, sin dejar el renglón cortado', () => {
  for (const idioma of IDIOMAS) {
    const { cuerpo } = avisoDeGuardiaParaLaFamilia('guardia_sin_cerrar_familia', idioma, { ...GUARDIA, pacientes: [] });
    assert.equal(cuerpo.includes('undefined'), false);
    assert.equal(/\s,/.test(cuerpo), false, `${idioma} deja una coma suelta`);
  }
});

test('nada de adentro entra en el texto de la Familia', () => {
  // El aviso de quien coordina lleva el nombre del Asistente, los minutos de la cuenta interna,
  // el escalón y el identificador de la guardia. Si alguno se cuela acá, la Familia está viendo
  // lo que no es suyo.
  const deAdentro = {
    ...GUARDIA,
    asistente: 'Rocío Paz',
    minutosDeAtraso: 137,
    veces: 4,
    salidaMarcada: false,
    id: 'guardia-uuid-0001',
    motivo: 'sin marcar salida',
  };
  for (const idioma of IDIOMAS) {
    for (const clave of CLAVES) {
      const { titulo, cuerpo } = avisoDeGuardiaParaLaFamilia(clave, idioma, deAdentro);
      const texto = `${titulo} ${cuerpo}`;
      for (const prohibido of ['Rocío Paz', '137', 'guardia-uuid-0001', 'sin marcar salida']) {
        assert.equal(texto.includes(prohibido), false, `${clave} en ${idioma} filtró ${prohibido}`);
      }
    }
  }
});
