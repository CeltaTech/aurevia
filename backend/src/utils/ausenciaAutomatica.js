import { supabase } from '../db/connection.js';
import { pacientesDeGuardia } from './pacientesDeGuardia.js';

// Detección automática de ausencia (pendiente #20 de docs/PENDIENTES.md, diseñado con el
// Desarrollador el 2026-07-12): reemplaza al botón manual "marcar ausente" de
// GuardiaAcciones.jsx como mecanismo principal — el botón queda como excepción/override
// para casos que este proceso no haya detectado solo. Corre cada pocos minutos (ver
// server.js) porque, a diferencia de revisarVencimientos (una vez por día alcanza), acá el
// margen de tolerancia se mide en minutos.
//
// Usa el service role (bypassa RLS) porque procesa guardias de todas las prestadoras según
// su propia configuración — no hay un usuario de panel logueado en este proceso.
export async function revisarAusenciasAutomaticas() {
  const { data: configuraciones, error: errorConfig } = await supabase
    .from('configuracion_ausencia_automatica')
    .select('prestadora_id, minutos_tolerancia_checkin')
    .eq('activo', true);

  if (errorConfig) {
    console.error('Error consultando configuracion_ausencia_automatica:', errorConfig.message);
    return;
  }
  if (!configuraciones?.length) return;

  const ahora = new Date();

  for (const { prestadora_id: prestadoraId, minutos_tolerancia_checkin: minutosTolerancia } of configuraciones) {
    // `.not('asistente_id', 'is', null)` no es un detalle: una guardia sin cubrir también
    // llega a su hora sin que nadie marque llegada, pero eso no es una ausencia — no hay
    // nadie que haya faltado. Sin este filtro, cada hueco de la agenda se marcaría como
    // "Ausente sin relevo previo", que es la alerta más grave del sistema, contra nadie.
    const { data: guardias, error: errorGuardias } = await supabase
      .from('guardias')
      .select('id, paciente_id, fecha, hora_inicio')
      .eq('prestadora_id', prestadoraId)
      .eq('estado', 'programada')
      .not('asistente_id', 'is', null)
      .is('checkin_at', null);

    if (errorGuardias) {
      console.error(`Error consultando guardias vencidas (prestadora ${prestadoraId}):`, errorGuardias.message);
      continue;
    }

    for (const guardia of guardias ?? []) {
      const inicioEsperado = new Date(`${guardia.fecha}T${guardia.hora_inicio}`);
      const limiteAusencia = new Date(inicioEsperado.getTime() + minutosTolerancia * 60_000);
      if (ahora < limiteAusencia) continue;

      await marcarAusenteYCrearIncidente({ guardia, prestadoraId });
    }
  }
}

// Misma lógica que handleMarcarAusente en panel/src/pages/guardias/GuardiaAcciones.jsx:
// busca si había un Asistente de la prestadora cubriendo justo
// antes, el mismo día, para alguno de los Pacientes de este turno. Si no hay ninguna, es
// "Ausente sin relevo previo" (glosario de CLAUDE.md) y guardia_saliente_id queda NULL.
async function marcarAusenteYCrearIncidente({ guardia, prestadoraId }) {
  const { error: errorUpdate } = await supabase
    .from('guardias')
    .update({ estado: 'ausente' })
    .eq('id', guardia.id);
  if (errorUpdate) {
    console.error(`Error marcando ausente automático (guardia ${guardia.id}):`, errorUpdate.message);
    return;
  }

  const saliente = await buscarGuardiaSaliente({ guardia, prestadoraId });

  const { error: errorIncidente } = await supabase.from('incidentes_relevo').insert({
    prestadora_id: prestadoraId,
    guardia_saliente_id: saliente,
    guardia_entrante_id: guardia.id,
    nivel_actual: 1,
  });
  if (errorIncidente) {
    console.error(`Error creando incidente de relevo automático (guardia ${guardia.id}):`, errorIncidente.message);
  }
}

/*
 * Quién estaba antes: el turno que terminó más cerca del que quedó vacío.
 *
 * Se busca por **todos** los Pacientes de este turno, no por uno. Si el Asistente venía a
 * atender a un matrimonio y no llegó, la persona que estuvo antes con cualquiera de los dos
 * es la que se quedó esperando el relevo, y es a la que hay que enganchar el incidente.
 * Preguntando por un solo Paciente, el turno del otro no aparecía y el caso se marcaba como
 * "Ausente sin relevo previo" —la alerta más grave del sistema— cuando en realidad sí había
 * alguien.
 *
 * El más cercano se elige acá y no en la base: en un mismo día hay un puñado de turnos por
 * Paciente, y ordenar por una columna de la tabla de adentro no ordena las filas de afuera.
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
    .select('guardias!inner(id, hora_fin)')
    .in('paciente_id', pacienteIds)
    .eq('prestadora_id', prestadoraId)
    .eq('guardias.fecha', guardia.fecha)
    .neq('guardias.estado', 'cancelada')
    .neq('guardias.id', guardia.id)
    .lte('guardias.hora_fin', guardia.hora_inicio);
  if (error) {
    console.error(`Error buscando guardia saliente (guardia ${guardia.id}):`, error.message);
    return null;
  }

  const ordenadas = (candidatas ?? [])
    .map((fila) => fila.guardias)
    .filter(Boolean)
    .sort((a, b) => (b.hora_fin ?? '').localeCompare(a.hora_fin ?? ''));
  return ordenadas[0]?.id ?? null;
}
