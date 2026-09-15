/**
 * El estado documental que ve la Familia.
 *
 *   npm test --prefix backend
 *
 * QUÉ SE PRUEBA ACÁ, Y POR QUÉ ESTO. Lo que se equivoca fácil en una cuenta como ésta es
 * redondear para arriba: dar por "al día" un papel que nunca se cargó, o uno cargado a medias.
 * Ésa es exactamente la afirmación por la que sancionaron a Care.com, y es lo que primero
 * prueban las tres pruebas de abajo.
 *
 * Qué daría con el sistema roto: si alguien contara los papeles cargados en vez de los
 * exigidos, la prueba de la carpeta incompleta daría "al_dia"; si juntara la Matrícula
 * verificada con la que nadie miró, falla la última.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  ESTADO_MATRICULA,
  RESUMEN_DOCUMENTAL,
  estadoDocumentalParaLaFamilia,
} from '../estadoDocumentalParaLaFamilia.js';

const HOY = new Date('2026-09-15T10:00:00');

const TIPO_A = { id: 't-1', requiere_vencimiento: true };
const TIPO_B = { id: 't-2', requiere_vencimiento: true };
/** Uno que no vence: con estar cargado alcanza. */
const TIPO_SIN_VENCIMIENTO = { id: 't-3', requiere_vencimiento: false };

const armar = (extra) =>
  estadoDocumentalParaLaFamilia({ diasAviso: 30, ahora: HOY, ...extra });

describe('el estado documental agregado que ve la Familia', () => {
  it('sin exigencias no informa nada: la Prestadora no pide papeles', () => {
    const estado = armar({ tiposExigidos: [], documentos: [] });
    assert.equal(estado.resumen, RESUMEN_DOCUMENTAL.SIN_EXIGENCIAS);
    assert.equal(estado.papelesExigidos, 0);
  });

  it('todo cargado y lejos de vencer queda al día', () => {
    const estado = armar({
      tiposExigidos: [TIPO_A, TIPO_B],
      documentos: [
        { tipo_documento_id: 't-1', fecha_vencimiento: '2027-01-01' },
        { tipo_documento_id: 't-2', fecha_vencimiento: '2027-01-01' },
      ],
    });
    assert.equal(estado.resumen, RESUMEN_DOCUMENTAL.AL_DIA);
    assert.equal(estado.alDia, 2);
  });

  it('un papel que nunca se cargó deja la carpeta incompleta, no al día', () => {
    const estado = armar({
      tiposExigidos: [TIPO_A, TIPO_B],
      documentos: [{ tipo_documento_id: 't-1', fecha_vencimiento: '2027-01-01' }],
    });
    assert.equal(estado.resumen, RESUMEN_DOCUMENTAL.INCOMPLETA);
    assert.equal(estado.sinCargar, 1);
    assert.equal(estado.alDia, 1);
  });

  it('un papel cargado sin fecha, cuando su tipo exige vencimiento, tampoco está al día', () => {
    const estado = armar({
      tiposExigidos: [TIPO_A],
      documentos: [{ tipo_documento_id: 't-1', fecha_vencimiento: null }],
    });
    assert.equal(estado.resumen, RESUMEN_DOCUMENTAL.INCOMPLETA);
    assert.equal(estado.alDia, 0);
  });

  it('un tipo que no exige vencimiento está al día con sólo estar cargado', () => {
    const estado = armar({
      tiposExigidos: [TIPO_SIN_VENCIMIENTO],
      documentos: [{ tipo_documento_id: 't-3', fecha_vencimiento: null }],
    });
    assert.equal(estado.resumen, RESUMEN_DOCUMENTAL.AL_DIA);
    assert.equal(estado.alDia, 1);
  });

  it('lo que entra en la ventana de aviso se dice como por vencer', () => {
    const estado = armar({
      tiposExigidos: [TIPO_A],
      documentos: [{ tipo_documento_id: 't-1', fecha_vencimiento: '2026-10-05' }],
    });
    assert.equal(estado.resumen, RESUMEN_DOCUMENTAL.POR_VENCER);
    assert.equal(estado.porVencer, 1);
  });

  it('un vencido tapa a todo lo demás: es lo que hay que saber hoy', () => {
    const estado = armar({
      tiposExigidos: [TIPO_A, TIPO_B],
      documentos: [{ tipo_documento_id: 't-1', fecha_vencimiento: '2026-08-01' }],
    });
    assert.equal(estado.resumen, RESUMEN_DOCUMENTAL.VENCIDA);
    assert.equal(estado.vencidos, 1);
    assert.equal(estado.sinCargar, 1);
  });

  it('de acá no sale el nombre de ningún papel', () => {
    const estado = armar({
      tiposExigidos: [{ id: 't-1', requiere_vencimiento: true, nombre: 'Certificado psicofísico' }],
      documentos: [{ tipo_documento_id: 't-1', fecha_vencimiento: '2027-01-01' }],
    });
    assert.ok(!JSON.stringify(estado).includes('psicofísico'));
  });
});

describe('la Matrícula, dicha sin el número y sin el tipo', () => {
  it('si el tipo de Asistente no la exige, no corresponde: no es una falta', () => {
    const estado = armar({ matricula: { requiere_matricula: false } });
    assert.equal(estado.matricula, ESTADO_MATRICULA.NO_CORRESPONDE);
  });

  it('exigida y sin cargar es no vigente', () => {
    const estado = armar({ matricula: { requiere_matricula: true, matricula_id: null } });
    assert.equal(estado.matricula, ESTADO_MATRICULA.NO_VIGENTE);
  });

  it('exigida, cargada y con la fecha pasada es no vigente', () => {
    const estado = armar({
      matricula: { requiere_matricula: true, matricula_id: 'm-1', vigente_hasta: '2026-08-01' },
    });
    assert.equal(estado.matricula, ESTADO_MATRICULA.NO_VIGENTE);
  });

  it('una que no vence es vigente: hay matrículas sin fecha de vencimiento', () => {
    const estado = armar({
      matricula: { requiere_matricula: true, matricula_id: 'm-1', vigente_hasta: null },
    });
    assert.equal(estado.matricula, ESTADO_MATRICULA.VIGENTE_SIN_VERIFICAR);
  });

  it('vigente y comprobada no es lo mismo que vigente y nadie la miró', () => {
    const sinVerificar = armar({
      matricula: { requiere_matricula: true, matricula_id: 'm-1', vigente_hasta: '2027-01-01' },
    });
    const verificada = armar({
      matricula: {
        requiere_matricula: true,
        matricula_id: 'm-1',
        vigente_hasta: '2027-01-01',
        verificada_at: '2026-09-01T00:00:00Z',
      },
    });
    assert.equal(sinVerificar.matricula, ESTADO_MATRICULA.VIGENTE_SIN_VERIFICAR);
    assert.equal(verificada.matricula, ESTADO_MATRICULA.VIGENTE_VERIFICADA);
    assert.notEqual(sinVerificar.matricula, verificada.matricula);
  });
});
