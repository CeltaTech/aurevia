/**
 * La carpeta de papeles que el Asistente ve de sí mismo.
 *
 *   npm test --prefix backend
 *
 * QUÉ SE PRUEBA ACÁ, Y POR QUÉ ESTO. Dos cosas que se rompen fácil y no se notan mirando la
 * pantalla:
 *
 *   · que un papel exigido y nunca cargado aparezca igual en la lista. Una lista armada desde lo
 *     cargado lo dejaría afuera justo cuando más hace falta verlo, y la pantalla se vería bien:
 *     los papeles que están, todos en verde;
 *   · que el resumen sea el mismo que ve el otro lado del producto. Si esta función se pusiera a
 *     contar por su cuenta, el teléfono del Asistente diría "al día" y el Panel de la Prestadora
 *     "falta un papel", cada uno con razón según su propia cuenta.
 *
 * Qué daría con el sistema roto: la prueba del papel sin cargar devolvería una lista de un solo
 * renglón, y la del resumen daría `al_dia` con un papel faltando.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ESTADO_PAPEL, carpetaDelAsistente, estadoDelCertificado } from '../carpetaDelAsistente.js';
import { RESUMEN_DOCUMENTAL, estadoDocumentalParaLaFamilia } from '../estadoDocumentalParaLaFamilia.js';

const HOY = new Date('2026-09-15T10:00:00');

const APTO = { id: 't-1', nombre: 'Apto médico', requiere_vencimiento: true };
const LIBRETA = { id: 't-2', nombre: 'Libreta sanitaria', requiere_vencimiento: true };
/** Uno que no vence: con estar cargado alcanza. */
const TITULO = { id: 't-3', nombre: 'Título', requiere_vencimiento: false };

const armar = (extra) => carpetaDelAsistente({ diasAviso: 30, ahora: HOY, ...extra });
const papel = (carpeta, id) => carpeta.papeles.find((p) => p.tipo_documento_id === id);

describe('la carpeta de papeles del Asistente', () => {
  it('lo que le exigen y nunca cargó también es un renglón de la lista', () => {
    const carpeta = armar({
      tiposExigidos: [APTO, LIBRETA],
      documentos: [{ tipo_documento_id: 't-1', fecha_vencimiento: '2027-01-01' }],
    });
    assert.equal(carpeta.papeles.length, 2);
    assert.equal(papel(carpeta, 't-2').estado, ESTADO_PAPEL.SIN_CARGAR);
    assert.equal(papel(carpeta, 't-2').fecha_vencimiento, null);
  });

  it('acá sí va el nombre del papel: es lo que le dice qué ir a buscar', () => {
    const carpeta = armar({ tiposExigidos: [APTO], documentos: [] });
    assert.equal(papel(carpeta, 't-1').nombre, 'Apto médico');
  });

  it('un papel cargado y lejos de vencer está vigente, y dice cuántos días le faltan', () => {
    const carpeta = armar({
      tiposExigidos: [APTO],
      documentos: [{ tipo_documento_id: 't-1', fecha_vencimiento: '2026-12-15' }],
    });
    assert.equal(papel(carpeta, 't-1').estado, ESTADO_PAPEL.VIGENTE);
    assert.equal(papel(carpeta, 't-1').dias, 91);
  });

  it('dentro de la ventana de aviso, está por vencer', () => {
    const carpeta = armar({
      tiposExigidos: [APTO],
      documentos: [{ tipo_documento_id: 't-1', fecha_vencimiento: '2026-10-05' }],
    });
    assert.equal(papel(carpeta, 't-1').estado, ESTADO_PAPEL.POR_VENCER);
  });

  it('con la fecha pasada, está vencido', () => {
    const carpeta = armar({
      tiposExigidos: [APTO],
      documentos: [{ tipo_documento_id: 't-1', fecha_vencimiento: '2026-08-01' }],
    });
    assert.equal(papel(carpeta, 't-1').estado, ESTADO_PAPEL.VENCIDO);
  });

  it('cargado sin la fecha que su tipo exige queda a medio cargar, no vigente', () => {
    const carpeta = armar({
      tiposExigidos: [APTO],
      documentos: [{ tipo_documento_id: 't-1', fecha_vencimiento: null }],
    });
    assert.equal(papel(carpeta, 't-1').estado, ESTADO_PAPEL.FALTA_FECHA);
  });

  it('un tipo que no exige vencimiento está vigente con sólo estar cargado', () => {
    const carpeta = armar({
      tiposExigidos: [TITULO],
      documentos: [{ tipo_documento_id: 't-3', fecha_vencimiento: null }],
    });
    assert.equal(papel(carpeta, 't-3').estado, ESTADO_PAPEL.VIGENTE);
    assert.equal(papel(carpeta, 't-3').requiere_vencimiento, false);
  });

  it('sin exigencias la lista queda vacía y no hay nada que informar', () => {
    const carpeta = armar({ tiposExigidos: [], documentos: [] });
    assert.deepEqual(carpeta.papeles, []);
    assert.equal(carpeta.resumen, RESUMEN_DOCUMENTAL.SIN_EXIGENCIAS);
  });

  it('el resumen es exactamente el mismo que ve el otro lado del producto', () => {
    const datos = {
      tiposExigidos: [APTO, LIBRETA, TITULO],
      documentos: [
        { tipo_documento_id: 't-1', fecha_vencimiento: '2026-10-05' },
        { tipo_documento_id: 't-3', fecha_vencimiento: null },
      ],
    };
    const carpeta = armar(datos);
    const paraLaFamilia = estadoDocumentalParaLaFamilia({ diasAviso: 30, ahora: HOY, ...datos });
    assert.equal(carpeta.resumen, paraLaFamilia.resumen);
    assert.equal(carpeta.papelesExigidos, paraLaFamilia.papelesExigidos);
    assert.equal(carpeta.alDia, paraLaFamilia.alDia);
    assert.equal(carpeta.porVencer, paraLaFamilia.porVencer);
    assert.equal(carpeta.vencidos, paraLaFamilia.vencidos);
    assert.equal(carpeta.sinCargar, paraLaFamilia.sinCargar);
  });
});

describe('el Certificado de Aptitud', () => {
  const certificado = (extra) => estadoDelCertificado(extra, { diasAviso: 30, ahora: HOY });

  it('no tener ninguno no es tenerlo vencido', () => {
    assert.equal(certificado(null), null);
  });

  it('con la fecha lejos, está vigente', () => {
    assert.equal(certificado({ activo: true, fecha_vencimiento: '2027-01-01' }).estado, ESTADO_PAPEL.VIGENTE);
  });

  it('dentro de la ventana de aviso, está por vencer', () => {
    assert.equal(certificado({ activo: true, fecha_vencimiento: '2026-10-05' }).estado, ESTADO_PAPEL.POR_VENCER);
  });

  it('con la fecha pasada, está vencido', () => {
    assert.equal(certificado({ activo: true, fecha_vencimiento: '2026-08-01' }).estado, ESTADO_PAPEL.VENCIDO);
  });

  it('la baja de la Prestadora gana sobre el calendario', () => {
    const estado = certificado({ activo: false, fecha_vencimiento: '2027-01-01' });
    assert.equal(estado.estado, ESTADO_PAPEL.DADO_DE_BAJA);
  });

  it('uno sin fecha de vencimiento está vigente, y no dice días que no existen', () => {
    const estado = certificado({ activo: true, fecha_emision: '2026-01-10', fecha_vencimiento: null });
    assert.equal(estado.estado, ESTADO_PAPEL.VIGENTE);
    assert.equal(estado.dias, null);
    assert.equal(estado.fecha_emision, '2026-01-10');
  });
});
