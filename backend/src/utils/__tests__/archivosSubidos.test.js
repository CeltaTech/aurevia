import test from 'node:test';
import assert from 'node:assert/strict';

import { carpetaDeMatriculas, esRutaDeMatriculaDe, extensionDeArchivo, rutaDeMatriculaNueva } from '../archivosSubidos.js';

const PRESTADORA = '11111111-1111-1111-1111-111111111111';
const OTRA_PRESTADORA = '22222222-2222-2222-2222-222222222222';
const ASISTENTE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const OTRO_ASISTENTE = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const RUTA_PROPIA = `${PRESTADORA}/matriculas/${ASISTENTE}/matricula-1757000000000.pdf`;

test('extensionDeArchivo', async (t) => {
  await t.test('conoce los tres tipos que aceptan las rutas de subida', () => {
    assert.equal(extensionDeArchivo('application/pdf'), 'pdf');
    assert.equal(extensionDeArchivo('image/png'), 'png');
    assert.equal(extensionDeArchivo('image/jpeg'), 'jpg');
  });

  // Las rutas ya filtran el tipo antes de llegar acá, así que este caso no debería ocurrir.
  // Si ocurriera, la extensión no puede quedar vacía: un archivo sin extensión en el depósito
  // no se abre en ningún lado.
  await t.test('ante un tipo desconocido no devuelve vacío', () => {
    assert.equal(extensionDeArchivo('application/octet-stream'), 'jpg');
    assert.equal(extensionDeArchivo(undefined), 'jpg');
  });
});

test('rutaDeMatriculaNueva', async (t) => {
  await t.test('empieza por la Prestadora y sigue por el Asistente', () => {
    const ruta = rutaDeMatriculaNueva(PRESTADORA, ASISTENTE, 'pdf');
    assert.ok(ruta.startsWith(carpetaDeMatriculas(PRESTADORA, ASISTENTE)));
    assert.ok(ruta.endsWith('.pdf'));
  });

  // Lo que arma la ruta y lo que la comprueba tienen que estar de acuerdo: si se despegan,
  // el Asistente sube un archivo que después no puede volver a mirar.
  await t.test('lo que arma pasa lo que comprueba', () => {
    const ruta = rutaDeMatriculaNueva(PRESTADORA, ASISTENTE, 'png');
    assert.equal(esRutaDeMatriculaDe(ruta, PRESTADORA, ASISTENTE), true);
  });
});

test('esRutaDeMatriculaDe', async (t) => {
  await t.test('acepta la carpeta propia', () => {
    assert.equal(esRutaDeMatriculaDe(RUTA_PROPIA, PRESTADORA, ASISTENTE), true);
  });

  // Los cuatro casos que la comprobación vieja dejaba pasar. Hasta el 2026-09-05 esto se
  // resolvía buscando `/matriculas/<Asistente>/` en cualquier parte del texto: la Prestadora
  // no entraba en la cuenta, y ni lo que venía antes ni lo que venía después estaban acotados.
  await t.test('rechaza el mismo Asistente bajo otra Prestadora', () => {
    const ajena = `${OTRA_PRESTADORA}/matriculas/${ASISTENTE}/matricula-1.pdf`;
    assert.equal(esRutaDeMatriculaDe(ajena, PRESTADORA, ASISTENTE), false);
  });

  await t.test('rechaza otro Asistente de la misma Prestadora', () => {
    const ajena = `${PRESTADORA}/matriculas/${OTRO_ASISTENTE}/matricula-1.pdf`;
    assert.equal(esRutaDeMatriculaDe(ajena, PRESTADORA, ASISTENTE), false);
  });

  await t.test('rechaza la carpeta propia escondida adentro de otra ruta', () => {
    const disfrazada = `${OTRA_PRESTADORA}/${PRESTADORA}/matriculas/${ASISTENTE}/matricula-1.pdf`;
    assert.equal(esRutaDeMatriculaDe(disfrazada, PRESTADORA, ASISTENTE), false);
  });

  await t.test('rechaza lo que siga bajando después de la carpeta', () => {
    const masAbajo = `${carpetaDeMatriculas(PRESTADORA, ASISTENTE)}sub/matricula-1.pdf`;
    assert.equal(esRutaDeMatriculaDe(masAbajo, PRESTADORA, ASISTENTE), false);
  });

  await t.test('rechaza subir un escalón con puntos', () => {
    assert.equal(esRutaDeMatriculaDe(`${carpetaDeMatriculas(PRESTADORA, ASISTENTE)}..`, PRESTADORA, ASISTENTE), false);
    assert.equal(esRutaDeMatriculaDe(`${carpetaDeMatriculas(PRESTADORA, ASISTENTE)}.`, PRESTADORA, ASISTENTE), false);
  });

  await t.test('rechaza la carpeta sin archivo', () => {
    assert.equal(esRutaDeMatriculaDe(carpetaDeMatriculas(PRESTADORA, ASISTENTE), PRESTADORA, ASISTENTE), false);
  });

  // Falla cerrado: si no se pudo resolver quién pregunta, no se contesta que sí.
  await t.test('sin Prestadora o sin Asistente no acepta nada', () => {
    assert.equal(esRutaDeMatriculaDe(RUTA_PROPIA, undefined, ASISTENTE), false);
    assert.equal(esRutaDeMatriculaDe(RUTA_PROPIA, PRESTADORA, undefined), false);
    assert.equal(esRutaDeMatriculaDe(RUTA_PROPIA, null, null), false);
  });

  await t.test('lo que no es texto no es una ruta', () => {
    assert.equal(esRutaDeMatriculaDe(undefined, PRESTADORA, ASISTENTE), false);
    assert.equal(esRutaDeMatriculaDe(['ruta'], PRESTADORA, ASISTENTE), false);
    assert.equal(esRutaDeMatriculaDe(42, PRESTADORA, ASISTENTE), false);
  });
});
