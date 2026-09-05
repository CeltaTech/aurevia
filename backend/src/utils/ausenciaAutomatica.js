import { supabase } from '../db/connection.js';
import { marcarAusenteYCrearIncidente } from './marcarAusente.js';

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

      // Marcar la ausencia y abrir el incidente lo hace `utils/marcarAusente.js`, que es el
      // mismo que usa el botón del Panel. Acá queda sólo la decisión de *cuándo* — el reloj y la
      // tolerancia configurada—, que es lo propio de la detección automática.
      const resultado = await marcarAusenteYCrearIncidente({ guardia, prestadoraId });
      if (!resultado.ok) {
        console.error(`Error marcando ausente automático (guardia ${guardia.id}):`, resultado.motivo);
      }
    }
  }
}
