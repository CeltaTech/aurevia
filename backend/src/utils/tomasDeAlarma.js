import { supabase } from '../db/connection.js';
import { alarmasTomadas, reglaDeLaTomaDe } from './alarmasTomadas.js';

/* DE QUÉ ALARMAS YA SE HIZO CARGO ALGUIEN, PARA NO INSISTIRLE
   ===========================================================

   El proceso de fondo recorre las alarmas abiertas de cada Prestadora y le insiste a quien
   coordina. Esta es la pregunta que se hace antes de insistir: «¿alguien ya dijo que la está
   atendiendo?». Si la respuesta es que sí, esa vuelta la saltea.

   NO SILENCIA NADA PARA SIEMPRE. La toma vence, y quién decide cuánto dura es la Prestadora. El
   rato se vuelve a medir acá contra su configuración, y no se cree lo que trae la fila: la hora de
   vencimiento la escribe el navegador de una persona, y una fecha de dentro de un año dejaría muda
   la alarma un año. La cuenta vive en `alarmasTomadas.js`, que es el mismo archivo que usa el
   Panel.

   UNA CONSULTA POR PRESTADORA Y POR CLASE DE ALARMA, no una por alarma. Las tomas en pie de una
   Prestadora son pocas —una por alarma que alguien esté atendiendo— y preguntarlas de a una
   multiplicaría por cien las consultas para saber casi siempre que no hay ninguna. */

/** Los números de esta Prestadora para la duración de una toma. */
export async function reglaDeLaToma(prestadoraId) {
  const { data, error } = await supabase
    .from('configuracion_alarmas_tomadas')
    .select('regla')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  if (error) {
    console.error(`Error leyendo la configuracion de tomas de alarma (prestadora ${prestadoraId}):`, error.message);
  }
  return reglaDeLaTomaDe(data?.regla);
}

/**
 * Los identificadores de las alarmas de esa clase que alguien está atendiendo en este momento.
 *
 * Ante un error de consulta devuelve el conjunto vacío, que es insistir: una alarma que insiste de
 * más molesta, una que se calla porque falló una consulta deja a alguien sin atender.
 */
export async function tomadasAhora({ prestadoraId, tipo, ahora = new Date(), regla }) {
  const { data, error } = await supabase
    .from('alarmas_tomadas')
    .select('referencia_id, tomada_at, vence_at, soltada_at')
    .eq('prestadora_id', prestadoraId)
    .eq('tipo', tipo)
    .is('soltada_at', null)
    .gt('vence_at', ahora.toISOString());

  if (error) {
    console.error(`Error consultando alarmas tomadas (prestadora ${prestadoraId}, ${tipo}):`, error.message);
    return new Set();
  }

  return alarmasTomadas(data ?? [], ahora, regla ?? (await reglaDeLaToma(prestadoraId)));
}
