import { useCatalogo } from './useCatalogo';

// Etapas del Proceso de Incorporación de Asistentes configuradas por cada Prestadora —
// pendiente #18 candidato 7 (docs/PLAN_HASTA_PRODUCCION.md). Reemplaza el arreglo fijo de 5 etapas
// que antes compartían todas las Prestadoras.
export function useEtapasIncorporacion(prestadoraId) {
  return useCatalogo('etapas_incorporacion_asistente', {
    filtros: { prestadora_id: prestadoraId },
    requiere: [prestadoraId],
  });
}
