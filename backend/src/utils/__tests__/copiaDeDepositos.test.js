import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { copiarDepositos, depositosDeSupabase, claveEnElDestino, sinLaRuta } from '../copiaDeDepositos.js';

/* Lo que se prueba acá es el respaldo de los archivos, que es la mitad del respaldo que hasta
   ahora no existía. Las pruebas miran tres cosas que sólo se notan el día de restaurar: que no
   quede ningún depósito afuera, que lo que ya está arriba no se vuelva a subir, y que una falla
   no se lleve puesto el resto de la copia. */

function almacenamientoFalso(contenido) {
  const bajados = [];
  return {
    bajados,
    async listarDepositos() {
      return Object.keys(contenido);
    },
    async listarArchivos(deposito) {
      return contenido[deposito];
    },
    async descargar(deposito, ruta) {
      bajados.push(`${deposito}/${ruta}`);
      if (ruta.includes('rota')) throw new Error(`falla de red al bajar ${deposito}/${ruta}`);
      return Buffer.from(`contenido de ${ruta}`);
    },
  };
}

function destinoFalso({ yaTiene = [] } = {}) {
  const subidos = [];
  return {
    subidos,
    async yaEstaIgual(clave) {
      return yaTiene.includes(clave);
    },
    async subir(clave, cuerpo, archivo) {
      subidos.push({ clave, cuerpo: cuerpo.toString(), actualizado: archivo.actualizado });
    },
  };
}

const DOS_DEPOSITOS = {
  'certificados-medicos': [
    { ruta: 'presdemo/asis-1/apto.pdf', tamano: 120, actualizado: '2026-09-01T10:00:00Z' },
  ],
  'reportes-fotos': [
    { ruta: 'presdemo/guardia-7/foto.jpg', tamano: 900, actualizado: '2026-09-02T10:00:00Z' },
    { ruta: 'presdemo/guardia-8/foto.jpg', tamano: 800, actualizado: '2026-09-03T10:00:00Z' },
  ],
};

describe('copiarDepositos', () => {
  let avisos;
  beforeEach(() => { avisos = []; });

  it('copia todos los archivos de todos los depósitos, con la ruta espejada', async () => {
    const almacenamiento = almacenamientoFalso(DOS_DEPOSITOS);
    const destino = destinoFalso();

    const cuenta = await copiarDepositos({ almacenamiento, destinos: [destino], avisar: (t) => avisos.push(t) });

    assert.equal(cuenta.depositos, 2);
    assert.equal(cuenta.copiados, 3);
    assert.equal(cuenta.fallados, 0);
    assert.deepEqual(destino.subidos.map((s) => s.clave), [
      'archivos/certificados-medicos/presdemo/asis-1/apto.pdf',
      'archivos/reportes-fotos/presdemo/guardia-7/foto.jpg',
      'archivos/reportes-fotos/presdemo/guardia-8/foto.jpg',
    ]);
  });

  it('sube a los dos destinos y baja el archivo una sola vez', async () => {
    const almacenamiento = almacenamientoFalso({ 'documentos-cese': [{ ruta: 'p/uno.pdf', tamano: 10, actualizado: 'x' }] });
    const r2 = destinoFalso();
    const b2 = destinoFalso();

    await copiarDepositos({ almacenamiento, destinos: [r2, b2] });

    assert.equal(r2.subidos.length, 1);
    assert.equal(b2.subidos.length, 1);
    assert.deepEqual(almacenamiento.bajados, ['documentos-cese/p/uno.pdf']);
  });

  it('lo que ya está igual no se vuelve a subir, y ni siquiera se baja', async () => {
    const almacenamiento = almacenamientoFalso(DOS_DEPOSITOS);
    const destino = destinoFalso({
      yaTiene: [
        'archivos/certificados-medicos/presdemo/asis-1/apto.pdf',
        'archivos/reportes-fotos/presdemo/guardia-7/foto.jpg',
        'archivos/reportes-fotos/presdemo/guardia-8/foto.jpg',
      ],
    });

    const cuenta = await copiarDepositos({ almacenamiento, destinos: [destino] });

    assert.equal(cuenta.yaEstaban, 3);
    assert.equal(cuenta.copiados, 0);
    assert.equal(destino.subidos.length, 0);
    assert.deepEqual(almacenamiento.bajados, [], 'un archivo que ya está arriba no se baja de nuevo');
  });

  it('si le falta a uno solo de los destinos, se sube únicamente a ése', async () => {
    const almacenamiento = almacenamientoFalso({ 'fotos-identidad': [{ ruta: 'p/cara.jpg', tamano: 5, actualizado: 'x' }] });
    const r2 = destinoFalso({ yaTiene: ['archivos/fotos-identidad/p/cara.jpg'] });
    const b2 = destinoFalso();

    await copiarDepositos({ almacenamiento, destinos: [r2, b2] });

    assert.equal(r2.subidos.length, 0);
    assert.deepEqual(b2.subidos.map((s) => s.clave), ['archivos/fotos-identidad/p/cara.jpg']);
  });

  it('un destino que no sabe contestar se trata como si no lo tuviera', async () => {
    const almacenamiento = almacenamientoFalso({ 'documentos-cese': [{ ruta: 'p/uno.pdf', tamano: 10, actualizado: 'x' }] });
    const destino = destinoFalso();
    destino.yaEstaIgual = async () => { throw new Error('el depósito no contesta'); };

    const cuenta = await copiarDepositos({ almacenamiento, destinos: [destino] });

    assert.equal(cuenta.copiados, 1);
    assert.equal(destino.subidos.length, 1);
  });

  it('se le pasa al destino la fecha de modificación, que es con lo que después se compara', async () => {
    const almacenamiento = almacenamientoFalso({ 'documentos-cese': [{ ruta: 'p/uno.pdf', tamano: 10, actualizado: '2026-09-04T12:00:00Z' }] });
    const destino = destinoFalso();

    await copiarDepositos({ almacenamiento, destinos: [destino] });

    assert.equal(destino.subidos[0].actualizado, '2026-09-04T12:00:00Z');
  });

  it('un archivo que falla no corta la copia de los demás, y se cuenta', async () => {
    const almacenamiento = almacenamientoFalso({
      'reportes-fotos': [
        { ruta: 'p/rota.jpg', tamano: 1, actualizado: 'x' },
        { ruta: 'p/sana.jpg', tamano: 2, actualizado: 'x' },
      ],
    });
    const destino = destinoFalso();

    const cuenta = await copiarDepositos({ almacenamiento, destinos: [destino], avisar: (t) => avisos.push(t) });

    assert.equal(cuenta.fallados, 1);
    assert.equal(cuenta.copiados, 1);
    assert.deepEqual(destino.subidos.map((s) => s.clave), ['archivos/reportes-fotos/p/sana.jpg']);
  });

  it('el aviso de una falla no lleva la ruta del archivo adentro', async () => {
    const almacenamiento = almacenamientoFalso({ 'certificados-medicos': [{ ruta: 'presdemo/asis-9/rota.pdf', tamano: 1, actualizado: 'x' }] });

    await copiarDepositos({ almacenamiento, destinos: [destinoFalso()], avisar: (t) => avisos.push(t) });

    const dela = avisos.filter((t) => t.includes('No se pudo copiar'));
    assert.equal(dela.length, 1, 'tiene que haber avisado de la falla, o la prueba no prueba nada');
    assert.ok(!dela[0].includes('asis-9'), 'la ruta dice de quién es el archivo y no puede salir en un registro');
    assert.ok(!dela[0].includes('rota.pdf'));
  });

  it('sin depósitos no se copia nada y no se rompe', async () => {
    const cuenta = await copiarDepositos({ almacenamiento: almacenamientoFalso({}), destinos: [destinoFalso()] });
    assert.deepEqual(cuenta, { depositos: 0, copiados: 0, yaEstaban: 0, fallados: 0 });
  });
});

describe('claveEnElDestino y sinLaRuta', () => {
  it('la clave del destino espeja el depósito y la ruta', () => {
    assert.equal(claveEnElDestino('reportes-fotos', 'p/g/foto.jpg'), 'archivos/reportes-fotos/p/g/foto.jpg');
  });

  it('sinLaRuta saca todas las rutas que se le nombren', () => {
    const mensaje = 'no existe archivos/x/p/uno.pdf ni p/uno.pdf';
    assert.equal(sinLaRuta(mensaje, 'archivos/x/p/uno.pdf', 'p/uno.pdf'), 'no existe <ruta> ni <ruta>');
  });
});

describe('depositosDeSupabase', () => {
  function supabaseFalso({ depositos = [], porCarpeta = {} }) {
    return {
      storage: {
        async listBuckets() {
          return { data: depositos.map((name) => ({ name })), error: null };
        },
        from() {
          return {
            async list(prefijo, { offset }) {
              const entradas = porCarpeta[prefijo] ?? [];
              return { data: entradas.slice(offset, offset + 100), error: null };
            },
          };
        },
      },
    };
  }

  it('devuelve los depósitos por nombre', async () => {
    const lector = depositosDeSupabase(supabaseFalso({ depositos: ['uno', 'dos'] }));
    assert.deepEqual(await lector.listarDepositos(), ['uno', 'dos']);
  });

  it('baja por las carpetas: una entrada sin id es carpeta, no archivo', async () => {
    const lector = depositosDeSupabase(supabaseFalso({
      porCarpeta: {
        '': [{ name: 'presdemo', id: null }],
        presdemo: [
          { name: 'asis-1', id: null },
          { name: 'suelto.pdf', id: 'a', metadata: { size: 3 }, updated_at: 'f1' },
        ],
        'presdemo/asis-1': [{ name: 'apto.pdf', id: 'b', metadata: { size: 7 }, updated_at: 'f2' }],
      },
    }));

    const archivos = await lector.listarArchivos('certificados-medicos');

    assert.deepEqual(
      archivos.map((a) => a.ruta).sort(),
      ['presdemo/asis-1/apto.pdf', 'presdemo/suelto.pdf'],
    );
    const apto = archivos.find((a) => a.ruta.endsWith('apto.pdf'));
    assert.equal(apto.tamano, 7);
    assert.equal(apto.actualizado, 'f2');
  });

  it('pide la página siguiente cuando la carpeta tiene más de cien archivos', async () => {
    const muchos = Array.from({ length: 150 }, (_, i) => ({
      name: `archivo-${i}.pdf`, id: `id-${i}`, metadata: { size: 1 }, updated_at: 'f',
    }));
    const lector = depositosDeSupabase(supabaseFalso({ porCarpeta: { '': muchos } }));

    const archivos = await lector.listarArchivos('reportes-fotos');

    assert.equal(archivos.length, 150, 'quedarse en la primera página dejaría cincuenta archivos sin respaldo');
  });

  it('un error al listar no se traga: rompe el respaldo', async () => {
    const supabase = {
      storage: {
        async listBuckets() { return { data: null, error: { message: 'sin permiso' } }; },
      },
    };
    await assert.rejects(() => depositosDeSupabase(supabase).listarDepositos(), /sin permiso/);
  });
});
