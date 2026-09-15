import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { IDENTIDAD } from '../../config/identidadProducto.js';
import {
  elegirElUltimoRespaldo,
  diferenciasDeTablas,
  diferenciasDeConteo,
  diferenciasDeArchivos,
  depositoDeLaClave,
  veredicto,
} from '../comprobacionDeRestauracion.js';

// Los volcados se nombran con el código técnico del producto, como los arma `backup_a_buckets.mjs`.
const volcadoDe = (fecha) => `${IDENTIDAD.codigo}_backup_${fecha}.sql.gz`;

const SIN_DIFERENCIAS = {
  tablas: { faltan: [], sobran: [] },
  conteos: { distintas: [], conDatos: 3, comparadas: 10 },
  archivos: { faltan: {}, distintos: {}, comparados: 12 },
};

describe('elegirElUltimoRespaldo', () => {
  test('elige el más nuevo, que por la forma del nombre es el último alfabético', () => {
    const elegido = elegirElUltimoRespaldo([
      volcadoDe('2026-07-13T09-23-51-351Z'),
      volcadoDe('2026-09-14T06-00-02-118Z'),
      volcadoDe('2026-08-01T06-00-01-004Z'),
    ]);
    assert.equal(elegido, volcadoDe('2026-09-14T06-00-02-118Z'));
  });

  test('el espejo de archivos no es un volcado y no se elige nunca', () => {
    const elegido = elegirElUltimoRespaldo([
      volcadoDe('2026-09-14T06-00-02-118Z'),
      'archivos/certificados-medicos/una/ruta.pdf',
      'archivos/zzz-ultimo-alfabeticamente/otra.pdf',
    ]);
    assert.equal(elegido, volcadoDe('2026-09-14T06-00-02-118Z'));
  });

  test('sin ningún volcado se rompe, en vez de devolver cualquier cosa', () => {
    assert.throws(
      () => elegirElUltimoRespaldo(['archivos/certificados-medicos/una/ruta.pdf']),
      /No hay ningún volcado/,
    );
  });
});

describe('diferenciasDeTablas', () => {
  test('sin diferencias, las dos listas quedan vacías', () => {
    const d = diferenciasDeTablas(['prestadoras', 'guardias'], ['guardias', 'prestadoras']);
    assert.deepEqual(d, { faltan: [], sobran: [] });
  });

  test('la tabla que no volvió aparece como faltante', () => {
    const d = diferenciasDeTablas(['prestadoras', 'guardias'], ['prestadoras']);
    assert.deepEqual(d.faltan, ['guardias']);
  });

  test('la tabla que el volcado trae de más también se informa: el volcado quedó viejo', () => {
    const d = diferenciasDeTablas(['prestadoras'], ['prestadoras', 'tabla_que_ya_no_existe']);
    assert.deepEqual(d.sobran, ['tabla_que_ya_no_existe']);
  });
});

describe('diferenciasDeConteo', () => {
  test('cuenta cuántas tablas tenían datos, que es lo que decide si la comparación sirvió', () => {
    const d = diferenciasDeConteo(
      { prestadoras: 1, usuarios: 5, guardias: 0 },
      { prestadoras: 1, usuarios: 5, guardias: 0 },
    );
    assert.deepEqual(d.distintas, []);
    assert.equal(d.conDatos, 2);
    assert.equal(d.comparadas, 3);
  });

  test('una tabla que volvió con menos filas se informa con los dos números', () => {
    const d = diferenciasDeConteo({ usuarios: 5 }, { usuarios: 4 });
    assert.deepEqual(d.distintas, [{ tabla: 'usuarios', produccion: 5, restaurada: 4 }]);
  });

  test('una tabla que directamente no está se distingue de una que volvió en cero', () => {
    const ausente = diferenciasDeConteo({ usuarios: 5 }, {});
    const enCero = diferenciasDeConteo({ usuarios: 5 }, { usuarios: 0 });
    assert.equal(ausente.distintas[0].restaurada, null);
    assert.equal(enCero.distintas[0].restaurada, 0);
  });
});

describe('diferenciasDeArchivos', () => {
  test('lo que falta se cuenta por depósito, y nunca sale la ruta', () => {
    const d = diferenciasDeArchivos(
      {
        'archivos/certificados-medicos/pres/uno.pdf': 100,
        'archivos/certificados-medicos/pres/dos.pdf': 200,
        'archivos/logos-prestadoras/pres/logo.png': 50,
      },
      { 'archivos/logos-prestadoras/pres/logo.png': 50 },
    );
    assert.deepEqual(d.faltan, { 'certificados-medicos': 2 });
    assert.equal(d.comparados, 3);
    assert.ok(!JSON.stringify(d).includes('uno.pdf'), 'no puede salir el nombre del archivo');
    assert.ok(!JSON.stringify(d).includes('pres/'), 'no puede salir la ruta, que dice de quién es');
  });

  test('el que está con otro tamaño se informa aparte del que no está', () => {
    const d = diferenciasDeArchivos(
      { 'archivos/reportes/pres/foto.jpg': 900 },
      { 'archivos/reportes/pres/foto.jpg': 12 },
    );
    assert.deepEqual(d.faltan, {});
    assert.deepEqual(d.distintos, { reportes: 1 });
  });

  test('con todo igual no hay diferencias, pero se sabe cuántos se miraron', () => {
    const iguales = { 'archivos/reportes/pres/foto.jpg': 900 };
    const d = diferenciasDeArchivos(iguales, { ...iguales });
    assert.deepEqual(d.faltan, {});
    assert.deepEqual(d.distintos, {});
    assert.equal(d.comparados, 1);
  });

  test('depositoDeLaClave devuelve el depósito, y avisa cuando la clave no es del espejo', () => {
    assert.equal(depositoDeLaClave('archivos/prescripciones/pres/receta.pdf'), 'prescripciones');
    assert.equal(depositoDeLaClave(volcadoDe('2026-09-14')), '(fuera del espejo)');
  });
});

describe('veredicto', () => {
  test('con datos comparados y nada distinto, sale bien', () => {
    const v = veredicto(SIN_DIFERENCIAS);
    assert.equal(v.estado, 'bien');
  });

  test('todo igual pero nada cargado no es bien: es que no se probó nada', () => {
    const v = veredicto({
      ...SIN_DIFERENCIAS,
      conteos: { distintas: [], conDatos: 0, comparadas: 10 },
      archivos: { faltan: {}, distintos: {}, comparados: 0 },
    });
    assert.equal(v.estado, 'no_probado');
    assert.match(v.motivos[0], /no probó nada/);
  });

  test('las tablas con datos no tapan que no había un solo archivo', () => {
    const v = veredicto({ ...SIN_DIFERENCIAS, archivos: { faltan: {}, distintos: {}, comparados: 0 } });
    assert.equal(v.estado, 'no_probado');
    assert.match(v.motivos[0], /ningún archivo/);
  });

  test('una tabla que no volvió rompe la prueba', () => {
    const v = veredicto({ ...SIN_DIFERENCIAS, tablas: { faltan: ['guardias'], sobran: [] } });
    assert.equal(v.estado, 'roto');
    assert.match(v.motivos[0], /guardias/);
  });

  test('los archivos que faltan rompen la prueba aunque la base haya vuelto entera', () => {
    const v = veredicto({
      ...SIN_DIFERENCIAS,
      archivos: { faltan: { 'certificados-medicos': 4 }, distintos: {}, comparados: 12 },
    });
    assert.equal(v.estado, 'roto');
    assert.equal(v.motivos.length, 1, 'tiene que haber informado la falla, o la prueba no prueba nada');
    assert.match(v.motivos[0], /4 archivos de certificados-medicos/);
  });

  test('ningún motivo lleva una ruta de archivo adentro', () => {
    const v = veredicto({
      ...SIN_DIFERENCIAS,
      archivos: { faltan: { reportes: 1 }, distintos: { prescripciones: 2 }, comparados: 12 },
    });
    assert.equal(v.estado, 'roto');
    assert.ok(v.motivos.every((m) => !m.includes('/')), 'un motivo con barra adentro es una ruta filtrada');
  });
});
