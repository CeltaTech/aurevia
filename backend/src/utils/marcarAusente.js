import { supabase } from '../db/connection.js';
import { pacientesDeGuardia } from './pacientesDeGuardia.js';
import { finDeGuardia, inicioDeGuardia, sumarDias } from './horarios.js';

/* Marcar una guardia como ausente y abrir el incidente de relevo.
   ==========================================================================

   POR QUÉ ESTE ARCHIVO EXISTE. Hasta el 2026-09-05 esto estaba escrito dos veces: acá lo hacía
   la detección automática (`ausenciaAutomatica.js`) y del otro lado lo hacía a mano el Panel,
   con su propia consulta contra la base (`GuardiaAcciones.jsx`). Eran dos versiones distintas
   de la misma decisión, y no daban lo mismo:

     - La del Panel buscaba por `guardias.paciente_id`, o sea por un solo Paciente. Si el turno
       cubría a un matrimonio, la guardia anterior del otro no aparecía y el caso se anotaba como
       «Ausente sin relevo previo» —la alerta más grave del sistema— cuando en realidad había
       alguien esperando el relevo. La automática ya usaba la lista entera.
     - Las dos comparaban `hora_fin <= hora_inicio` como si las dos horas fueran del mismo día, y
       la guardia de noche no lo es: un turno `22:00 → 06:00` termina a la mañana siguiente. Ese
       error tenía dos caras. Contra un turno entrante de las `08:00` del mismo día, el de la
       noche anterior figuraba como «terminó antes» y se lo señalaba como saliente, cuando en
       realidad todavía estaba corriendo. Y al revés: contra el turno entrante de las `08:00` del
       día siguiente, el saliente verdadero ni siquiera se buscaba, porque la consulta sólo
       miraba el mismo día.

   Ahora la operación entera vive acá y la hacen los dos caminos —la detección automática y el
   botón del Panel, que pasó a pedírsela al motor por `routes/panelGuardias.js`—. La cuenta de
   cuándo termina un turno sale de `utils/horarios.js`, que es copia máquina de
   `panel/src/lib/horarios.js` y donde la regla de la medianoche está escrita una sola vez para
   todo el producto (CLAUDE.md §8, «ningún patrón repetido sin punto único de verdad»).

   Usa la llave de servicio, que se saltea la protección por fila: procesa guardias de cualquier
   Prestadora según su propia configuración y no hay ninguna sesión abierta en ese proceso. El
   aislamiento lo pone quien llama — la ruta del Panel acota a la Prestadora activa antes de
   traer la guardia. */

/**
 * Deja la guardia en `ausente` y le abre el incidente de relevo.
 *
 * `guardia` tiene que traer al menos `id`, `fecha`, `hora_inicio` y `paciente_id` (esta última
 * es la red de seguridad de `pacientesDeGuardia`).
 *
 * Devuelve `{ ok: true }`, o `{ ok: false, motivo }` con un texto para registrar. No levanta
 * excepciones: los dos caminos que la usan quieren seguir andando aunque una guardia falle.
 */
export async function marcarAusenteYCrearIncidente({ guardia, prestadoraId }) {
  const { error: errorUpdate } = await supabase
    .from('guardias')
    .update({ estado: 'ausente' })
    .eq('id', guardia.id);
  if (errorUpdate) return { ok: false, motivo: errorUpdate.message };

  const saliente = await buscarGuardiaSaliente({ guardia, prestadoraId });

  const { error: errorIncidente } = await supabase.from('incidentes_relevo').insert({
    prestadora_id: prestadoraId,
    guardia_saliente_id: saliente,
    guardia_entrante_id: guardia.id,
    nivel_actual: 1,
  });
  if (errorIncidente) return { ok: false, motivo: errorIncidente.message };

  return { ok: true };
}

/*
 * Quién estaba antes: el turno que terminó más cerca del que quedó vacío.
 *
 * Se busca por **todos** los Pacientes de este turno, no por uno. Si el Asistente venía a
 * atender a un matrimonio y no llegó, la persona que estuvo antes con cualquiera de los dos es
 * la que se quedó esperando el relevo, y es a la que hay que enganchar el incidente.
 *
 * Se miran dos días —el del turno y el anterior— porque el saliente de una guardia de la mañana
 * suele ser la guardia de noche, que empezó el día antes. Filtrar por un solo día dejaba a esa
 * afuera siempre.
 *
 * El más cercano se elige acá y no en la base: la base guarda dos horas de reloj y no sabe cuál
 * de las dos es del día siguiente, así que ordenar por `hora_fin` ordena mal justo en la guardia
 * de noche. Además, ordenar por una columna de la tabla de adentro no ordena las filas de afuera.
 */
async function buscarGuardiaSaliente({ guardia, prestadoraId }) {
  let pacienteIds;
  try {
    pacienteIds = (await pacientesDeGuardia(guardia, 'id')).map((p) => p.id);
  } catch (e) {
    console.error(`Error leyendo los Pacientes de la guardia ${guardia.id}:`, e.message);
    return null;
  }
  if (pacienteIds.length === 0) return null;

  const { data: candidatas, error } = await supabase
    .from('guardia_pacientes')
    .select('guardias!inner(id, fecha, hora_inicio, hora_fin)')
    .in('paciente_id', pacienteIds)
    .eq('prestadora_id', prestadoraId)
    .in('guardias.fecha', [sumarDias(guardia.fecha, -1), guardia.fecha])
    .neq('guardias.estado', 'cancelada')
    .neq('guardias.id', guardia.id);
  if (error) {
    console.error(`Error buscando guardia saliente (guardia ${guardia.id}):`, error.message);
    return null;
  }

  const filas = (candidatas ?? []).map((fila) => fila.guardias).filter(Boolean);
  return laQueTerminoJustoAntes(guardia, filas)?.id ?? null;
}

/**
 * De las candidatas, la que terminó lo más cerca posible del arranque del turno vacío, sin
 * pasarse.
 *
 * Se exporta para poder probarla sola: es la parte que decide, y no necesita base.
 *
 * Una que termina exactamente cuando la otra empieza sí cuenta: es el relevo normal, el caso
 * que este incidente viene a describir. Una que todavía está corriendo cuando el turno vacío
 * arranca no cuenta, porque no es un relevo que quedó esperando.
 */
export function laQueTerminoJustoAntes(entrante, candidatas) {
  const arranque = inicioDeGuardia(entrante);
  let elegida = null;
  let finElegido = null;

  for (const candidata of candidatas ?? []) {
    const fin = finDeGuardia(candidata);
    if (fin > arranque) continue;
    if (finElegido === null || fin > finElegido) {
      elegida = candidata;
      finElegido = fin;
    }
  }
  return elegida;
}
