// ---------------------------------------------------------------------------
// carpetaDelAsistente.js — sus propios papeles, vistos por él.
//
// LA DIFERENCIA CON LO QUE VE LA FAMILIA ES EL NOMBRE DEL PAPEL, Y NO ES UN DETALLE.
// A la Familia se le cuentan cuentas y una palabra de resumen, nunca cuál papel
// es cuál, porque el nombre de un tipo de documento puede ser dato de salud y
// ella no contrató eso (`estadoDocumentalParaLaFamilia.js`). Acá el que mira es
// el dueño de esos papeles: decirle «le falta uno» sin decirle cuál sería
// pedirle que adivine qué tiene que ir a buscar.
//
// EL RESUMEN NO SE VUELVE A CALCULAR ACÁ. Si esta carpeta está al día, está
// incompleta o está vencida lo decide `estadoDocumentalParaLaFamilia`, que ya
// contesta esa pregunta para el otro lado del producto. Dos cuentas para lo
// mismo terminan siempre igual: el teléfono del Asistente diciendo que está todo
// bien y el Panel de la Prestadora diciendo que falta un papel.
//
// Y LO QUE FALTA TAMBIÉN ES UN RENGLÓN. Un papel exigido que nunca se cargó no
// aparece en `documentos_asistente`, así que una lista armada desde lo cargado
// lo dejaría afuera justo cuando más hace falta verlo. La lista se arma desde lo
// que la Prestadora exige, y lo cargado se le engancha al lado.
// ---------------------------------------------------------------------------

import { estadoDocumentalParaLaFamilia } from './estadoDocumentalParaLaFamilia.js';
import {
  DIAS_AVISO_POR_DEFECTO,
  ESTADO_VENCIMIENTO,
  diasParaVencer,
  estadoDeVencimiento,
} from './reglaVencimientos.js';

/**
 * Cómo está cada papel. Las tres primeras son las de `reglaVencimientos`, dichas igual que en
 * todas las listas del producto; las dos últimas son las formas de no estar.
 */
export const ESTADO_PAPEL = {
  VIGENTE: ESTADO_VENCIMIENTO.VIGENTE,
  POR_VENCER: ESTADO_VENCIMIENTO.POR_VENCER,
  VENCIDO: ESTADO_VENCIMIENTO.VENCIDO,
  /** Nunca se cargó. */
  SIN_CARGAR: 'sin_cargar',
  /** Cargado, pero sin la fecha que ese tipo exige. Queda a medio cargar, no vigente. */
  FALTA_FECHA: 'falta_fecha',
  /** Sólo del Certificado: lo dio de baja la Prestadora, sin importar la fecha. */
  DADO_DE_BAJA: 'dado_de_baja',
};

/**
 * Arma la carpeta del Asistente: un renglón por papel exigido, más el resumen de siempre.
 *
 * @param tiposExigidos  los tipos activos de la Prestadora: `[{ id, nombre, requiere_vencimiento }]`.
 * @param documentos     lo cargado de esta persona: `[{ tipo_documento_id, fecha_vencimiento }]`.
 * @param diasAviso      la ventana de aviso de la Prestadora.
 * @param ahora          desde cuándo se cuenta (la prueba manda una fecha fija).
 */
export function carpetaDelAsistente({
  tiposExigidos = [],
  documentos = [],
  diasAviso = DIAS_AVISO_POR_DEFECTO,
  ahora = new Date(),
} = {}) {
  const cargadoPorTipo = new Map();
  for (const doc of documentos) {
    if (doc?.tipo_documento_id) cargadoPorTipo.set(doc.tipo_documento_id, doc);
  }

  const papeles = tiposExigidos.map((tipo) => {
    const doc = cargadoPorTipo.get(tipo?.id) ?? null;
    return {
      tipo_documento_id: tipo?.id ?? null,
      nombre: tipo?.nombre ?? null,
      requiere_vencimiento: !!tipo?.requiere_vencimiento,
      fecha_vencimiento: doc?.fecha_vencimiento ?? null,
      dias: doc?.fecha_vencimiento ? diasParaVencer(doc.fecha_vencimiento, ahora) : null,
      estado: estadoDelPapel(tipo, doc, diasAviso, ahora),
    };
  });

  // El resumen sale de la misma función que usa el otro lado del producto, con los mismos
  // datos. No se recalcula acá ni se deduce de la lista de arriba.
  const { resumen, papelesExigidos, alDia, porVencer, vencidos, sinCargar } =
    estadoDocumentalParaLaFamilia({
      tiposExigidos,
      documentos,
      matricula: null,
      diasAviso,
      ahora,
    });

  return { papeles, resumen, papelesExigidos, alDia, porVencer, vencidos, sinCargar };
}

/**
 * Cómo está el papel de un tipo, mirando primero si está y después hasta cuándo.
 *
 * Un tipo que no exige vencimiento está vigente con sólo estar cargado, y uno que sí lo exige
 * pero llegó sin fecha no se da por vigente: eso es lo mismo que decide la carpeta de la
 * Familia, dicho acá con la palabra que le sirve al dueño para saber qué le falta.
 */
function estadoDelPapel(tipo, doc, diasAviso, ahora) {
  if (!doc) return ESTADO_PAPEL.SIN_CARGAR;
  if (!tipo?.requiere_vencimiento) return ESTADO_PAPEL.VIGENTE;
  if (!doc.fecha_vencimiento) return ESTADO_PAPEL.FALTA_FECHA;
  return estadoDeVencimiento(diasParaVencer(doc.fecha_vencimiento, ahora), diasAviso);
}

/**
 * El Certificado de Aptitud, con la misma regla de vencimiento que todo lo demás.
 *
 * Devuelve `null` si no hay ninguno: no tenerlo no es tenerlo vencido, y mostrarlo como vencido
 * haría creer que hubo uno que se dejó caer.
 */
export function estadoDelCertificado(certificado, { diasAviso = DIAS_AVISO_POR_DEFECTO, ahora = new Date() } = {}) {
  if (!certificado) return null;
  const dias = certificado.fecha_vencimiento
    ? diasParaVencer(certificado.fecha_vencimiento, ahora)
    : null;
  return {
    fecha_emision: certificado.fecha_emision ?? null,
    fecha_vencimiento: certificado.fecha_vencimiento ?? null,
    dias,
    // Un certificado dado de baja por la Prestadora no está vigente aunque la fecha no haya
    // llegado: la baja es una decisión de ella y gana sobre el calendario.
    estado: certificado.activo === false
      ? ESTADO_PAPEL.DADO_DE_BAJA
      : estadoDeVencimiento(dias, diasAviso),
  };
}
