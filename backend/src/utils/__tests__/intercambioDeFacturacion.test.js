/**
 * Pruebas del ida y vuelta por archivo, del lado del motor.
 *
 * El archivo que se prueba acá es una copia generada del que vive en el Panel
 * (`scripts/copias_entre_apps.mjs`), y allá está probado en detalle. Lo que se comprueba acá es
 * lo que la copia puede romper y el original no: que resuelva sus propias importaciones corriendo
 * en el motor, y que la decisión por renglón —lo único que la ruta de importación delega— dé lo
 * mismo de los dos lados.
 *
 * No hace falta base de datos: la decisión recibe lo que la base contestó, no la consulta.
 *
 *   npm test --prefix backend
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOPE_DE_FILAS,
  esIdentificador,
  leerArchivo,
  loFacturadoDeLaFila,
  queHacerConLaFilaFacturada,
} from '../intercambioDeFacturacion.js';

const FACTURA = '60000000-0000-4000-8000-000000000001';
const SIN_FACTURAR = { id: FACTURA, facturado_at: null };

test('el archivo que devuelve el facturador se lee y se traduce a lo que guarda la base', () => {
  const { filas } = leerArchivo(
    'factura_id;comprobante_tipo;comprobante_numero;monto_facturado\r\n' +
      `${FACTURA};Factura B;0001-00000123;1.234,56\r\n`
  );
  assert.equal(filas.length, 1);
  assert.deepEqual(loFacturadoDeLaFila(filas[0]), {
    factura_id: FACTURA,
    comprobante_tipo: 'Factura B',
    comprobante_numero: '0001-00000123',
    monto_facturado: 1234.56,
  });
});

test('no se leen más filas que el tope', () => {
  const muchas = ['factura_id', ...Array.from({ length: TOPE_DE_FILAS + 20 }, () => FACTURA)];
  assert.equal(leerArchivo(muchas.join('\n')).filas.length, TOPE_DE_FILAS);
});

test('un renglón bien formado sobre una factura sin facturar se anota', () => {
  const decision = queHacerConLaFilaFacturada(
    { factura_id: FACTURA, comprobante_tipo: 'Factura B', monto_facturado: 1500 },
    { factura: SIN_FACTURAR }
  );
  assert.deepEqual(decision, { resultado: 'anotado' });
});

test('una factura que ya tiene comprobante anotado no se pisa', () => {
  const decision = queHacerConLaFilaFacturada(
    { factura_id: FACTURA, comprobante_tipo: 'Factura B', monto_facturado: 1500 },
    { factura: { id: FACTURA, facturado_at: '2026-09-10T10:00:00Z' } }
  );
  assert.deepEqual(decision, { resultado: 'ya_facturada' });
});

test('la factura que no aparece —también la de otra Prestadora— se rechaza', () => {
  const decision = queHacerConLaFilaFacturada(
    { factura_id: FACTURA, comprobante_tipo: 'Factura B', monto_facturado: 1500 },
    { factura: null }
  );
  assert.deepEqual(decision, { resultado: 'rechazado', motivo: 'no_encontrada' });
});

test('un identificador mal escrito se rechaza antes de preguntarle a la base', () => {
  assert.equal(esIdentificador('0001-00000123'), false);
  assert.deepEqual(
    queHacerConLaFilaFacturada({ factura_id: '0001-00000123', comprobante_tipo: 'Factura B', monto_facturado: 1 }),
    { resultado: 'rechazado', motivo: 'factura_id' }
  );
});
