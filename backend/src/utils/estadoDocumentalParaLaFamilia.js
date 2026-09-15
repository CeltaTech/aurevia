// ---------------------------------------------------------------------------
// estadoDocumentalParaLaFamilia.js — qué se le puede contar a la Familia sobre
// los papeles del Asistente que tiene en su casa, y qué no.
//
// POR QUÉ EXISTE, Y POR QUÉ DEVUELVE NÚMEROS Y NO NOMBRES
//
// Quien paga un servicio sin recibirlo ve el cumplimiento, nunca el contenido
// (`celtatech/CLAUDE.md` §6). Acá eso se vuelve concreto: el nombre de un papel
// puede ser dato de salud —un apto médico, una vacuna, un estudio— y decir cuál
// le falta a una persona es contar algo de ella que la Familia no contrató. Así
// que de este archivo salen cuentas y una palabra de resumen; de acá no sale
// nunca el nombre de un tipo de documento ni el número de una Matrícula.
//
// Y LA OTRA MITAD: EXACTITUD LITERAL SOBRE QUÉ SE VERIFICÓ
//
// `docs/PRD_07_Modalidad_Marketplace.md:247` lo pide por su nombre, con el caso
// que lo motiva: a Care.com la sancionaron por afirmar una verificación que no
// hacía. De ahí salen dos decisiones que no son cosméticas:
//
//   · la Matrícula vigente y la Matrícula vigente **y verificada** son dos
//     estados distintos y no se juntan, porque son dos afirmaciones distintas:
//     una dice que la persona cargó un papel, la otra que alguien de la
//     Prestadora lo comprobó contra el registro;
//   · un papel que nunca se cargó no cuenta como "al día". Redondear para arriba
//     es justamente la afirmación que se sanciona.
//
// Lo que este archivo NO decide: cuántos días antes se avisa de un vencimiento.
// Esa es la misma pregunta que se hace el Panel, y vive una sola vez en
// `reglaVencimientos.js`. Acá se la usa, no se la repite.
// ---------------------------------------------------------------------------

import {
  DIAS_AVISO_POR_DEFECTO,
  ESTADO_VENCIMIENTO,
  diasParaVencer,
  estadoDeVencimiento,
} from './reglaVencimientos.js';

/** Cómo queda la carpeta entera, en una palabra. La pantalla arma la frase. */
export const RESUMEN_DOCUMENTAL = {
  /** Esta Prestadora no exige ningún papel: no hay nada que informar. */
  SIN_EXIGENCIAS: 'sin_exigencias',
  /** Todo lo que se exige está cargado y vigente. */
  AL_DIA: 'al_dia',
  /** Todo cargado y vigente, pero algo entra en la ventana de aviso. */
  POR_VENCER: 'por_vencer',
  /** Falta cargar alguno de los que se exigen. */
  INCOMPLETA: 'incompleta',
  /** Hay al menos uno vencido. */
  VENCIDA: 'vencida',
};

/** Cómo está la Matrícula, dicho sin el número y sin el tipo. */
export const ESTADO_MATRICULA = {
  /** El tipo de Asistente no exige Matrícula. No es una falta: no corresponde. */
  NO_CORRESPONDE: 'no_corresponde',
  /** Exigida, cargada, vigente, y alguien de la Prestadora la comprobó. */
  VIGENTE_VERIFICADA: 'vigente_verificada',
  /** Exigida, cargada y vigente, pero nadie la comprobó contra el registro. */
  VIGENTE_SIN_VERIFICAR: 'vigente_sin_verificar',
  /** Exigida y no vigente: vencida, o directamente sin cargar. */
  NO_VIGENTE: 'no_vigente',
};

/**
 * Arma el estado documental agregado.
 *
 * @param tiposExigidos   los tipos activos de la Prestadora: `[{ id, requiere_vencimiento }]`.
 * @param documentos      lo cargado de este Asistente: `[{ tipo_documento_id, fecha_vencimiento }]`.
 * @param matricula       una fila de `estado_matricula_asistente`, o `null`.
 * @param diasAviso       la ventana de aviso de la Prestadora.
 * @param ahora           desde cuándo se cuenta (la prueba manda una fecha fija).
 */
export function estadoDocumentalParaLaFamilia({
  tiposExigidos = [],
  documentos = [],
  matricula = null,
  diasAviso = DIAS_AVISO_POR_DEFECTO,
  ahora = new Date(),
} = {}) {
  const cargadoPorTipo = new Map();
  for (const doc of documentos) {
    if (doc?.tipo_documento_id) cargadoPorTipo.set(doc.tipo_documento_id, doc);
  }

  let alDia = 0;
  let porVencer = 0;
  let vencidos = 0;
  let sinCargar = 0;

  for (const tipo of tiposExigidos) {
    const doc = cargadoPorTipo.get(tipo?.id);
    if (!doc) {
      sinCargar += 1;
      continue;
    }
    // Un tipo que no exige vencimiento está al día con sólo estar cargado. Y uno que sí lo
    // exige pero llegó sin fecha no se da por bueno: es un papel a medio cargar, y contarlo
    // como vigente sería afirmar algo que nadie comprobó.
    if (!tipo?.requiere_vencimiento) {
      alDia += 1;
      continue;
    }
    if (!doc.fecha_vencimiento) {
      sinCargar += 1;
      continue;
    }
    const estado = estadoDeVencimiento(diasParaVencer(doc.fecha_vencimiento, ahora), diasAviso);
    if (estado === ESTADO_VENCIMIENTO.VENCIDO) vencidos += 1;
    else if (estado === ESTADO_VENCIMIENTO.POR_VENCER) porVencer += 1;
    else alDia += 1;
  }

  return {
    papelesExigidos: tiposExigidos.length,
    alDia,
    porVencer,
    vencidos,
    sinCargar,
    resumen: resumirCarpeta({ exigidos: tiposExigidos.length, porVencer, vencidos, sinCargar }),
    matricula: resumirMatricula(matricula, ahora),
  };
}

/**
 * El orden de precedencia es el de la mala noticia primero: lo vencido tapa lo faltante, y lo
 * faltante tapa lo que está por vencer. Quien lee esto quiere saber si hay un problema hoy.
 */
function resumirCarpeta({ exigidos, porVencer, vencidos, sinCargar }) {
  if (exigidos === 0) return RESUMEN_DOCUMENTAL.SIN_EXIGENCIAS;
  if (vencidos > 0) return RESUMEN_DOCUMENTAL.VENCIDA;
  if (sinCargar > 0) return RESUMEN_DOCUMENTAL.INCOMPLETA;
  if (porVencer > 0) return RESUMEN_DOCUMENTAL.POR_VENCER;
  return RESUMEN_DOCUMENTAL.AL_DIA;
}

/**
 * La Matrícula, sin número y sin tipo.
 *
 * `vigente_hasta` en blanco significa que no vence —hay matrículas que no vencen—, y eso es
 * vigente. Lo que no es vigente es no tener ninguna cargada.
 */
function resumirMatricula(matricula, ahora) {
  if (!matricula?.requiere_matricula) return ESTADO_MATRICULA.NO_CORRESPONDE;
  if (!matricula.matricula_id) return ESTADO_MATRICULA.NO_VIGENTE;
  if (matricula.vigente_hasta) {
    const dias = diasParaVencer(matricula.vigente_hasta, ahora);
    if (dias !== null && dias < 0) return ESTADO_MATRICULA.NO_VIGENTE;
  }
  return matricula.verificada_at
    ? ESTADO_MATRICULA.VIGENTE_VERIFICADA
    : ESTADO_MATRICULA.VIGENTE_SIN_VERIFICAR;
}
