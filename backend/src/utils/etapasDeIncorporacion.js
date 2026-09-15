// Las etapas del Proceso de Incorporación de Asistentes, tal como las definió cada Prestadora.
// ============================================================================
//
// QUÉ RESUELVE. Un Asistente nuevo arranca con una fila por etapa en `verificaciones_asistente`,
// y hasta acá había dos maneras distintas de armar esa lista: la de una postulación aprobada la
// leía de `etapas_incorporacion_asistente` —la tabla que cada Prestadora edita en
// Configuración › El cuidado— y la de un alta directa o importada usaba cinco claves escritas en
// el código, iguales para todas.
//
// EL DAÑO NO ERA TEÓRICO. Una Prestadora que sacó «capacitación» de su proceso igual la veía
// aparecer en la ficha de cada Asistente que diera de alta a mano, sin ninguna forma de cerrarla;
// y una que agregó una etapa propia no la veía nunca. Peor todavía: las claves escritas acá no
// tenían por qué existir en la tabla de esa Prestadora, así que la ficha mostraba una etapa que
// la pantalla de configuración no podía nombrar.
//
// UNA SOLA PUERTA. Las dos maneras entran ahora por este archivo, que es el único lugar del motor
// que sabe de dónde salen las etapas y en qué orden van.
//
// SIN ETAPAS NO SE EMPIEZA. Una Prestadora sin ninguna etapa activa no tiene proceso de
// incorporación, y crear un Asistente sin una sola fila de verificación lo dejaría aprobado de
// hecho. Se corta con un motivo que la pantalla sabe explicar, en vez de inventarle un proceso.

import { supabase } from '../db/connection.js';
import { ErrorConMotivo } from './errorConMotivo.js';

/** Cuánto de lo que se arma queda ya cumplido. */
export const APROBADAS = {
  /** Nada: el proceso entero está por delante. */
  NINGUNA: 'ninguna',
  /**
   * Sólo la primera. Es el caso de una postulación aprobada: la primera etapa es la postulación
   * misma, que ya pasó, y dejarla pendiente obligaría a marcar a mano algo que ya ocurrió.
   */
  LA_PRIMERA: 'la_primera',
  /** Todas: la Prestadora eligió dar por cumplido el proceso al dar de alta. */
  TODAS: 'todas',
};

/**
 * Las claves de las etapas activas de una Prestadora, en el orden en que ella las puso.
 *
 * @throws ErrorConMotivo `sin_etapas_incorporacion` si no tiene ninguna activa.
 */
export async function etapasActivasDeLaPrestadora(prestadoraId) {
  const { data, error } = await supabase
    .from('etapas_incorporacion_asistente')
    .select('clave')
    .eq('prestadora_id', prestadoraId)
    .eq('activa', true)
    .order('orden');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new ErrorConMotivo(
      'sin_etapas_incorporacion',
      'La Prestadora no tiene etapas de incorporación activas',
    );
  }
  return data.map(({ clave }) => clave);
}

/**
 * Las filas de `verificaciones_asistente` con las que arranca un Asistente nuevo.
 *
 * Devuelve las filas y no las inserta: quien llama ya está adentro de su propia secuencia de
 * altas y decide qué hacer si algo falla.
 *
 * @param asistenteId  el Asistente recién creado
 * @param prestadoraId la Prestadora dueña del proceso
 * @param aprobadas    una de `APROBADAS`
 * @param revisadoPor  quién queda como responsable de lo que se da por cumplido. Hace falta
 *                     solamente cuando algo se aprueba.
 */
export async function filasDeIncorporacion(asistenteId, prestadoraId, { aprobadas, revisadoPor = null } = {}) {
  const claves = await etapasActivasDeLaPrestadora(prestadoraId);
  const momento = new Date().toISOString();

  return claves.map((clave, indice) => {
    const cumplida =
      aprobadas === APROBADAS.TODAS || (aprobadas === APROBADAS.LA_PRIMERA && indice === 0);
    return {
      asistente_id: asistenteId,
      etapa: clave,
      estado: cumplida ? 'aprobada' : 'pendiente',
      revisado_por: cumplida ? revisadoPor : null,
      completado_en: cumplida ? momento : null,
    };
  });
}
