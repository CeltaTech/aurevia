import { useCatalogo } from './useCatalogo';

// Zonas de cobertura reales configuradas por cada Prestadora (tabla zonas_cobertura) —
// pendiente #18 candidatos 4 y 5 (docs/PLAN_HASTA_PRODUCCION.md). Reemplaza las 7 etiquetas fijas de
// AMBA que antes vivían en t.postulaciones.zonas_labels: cada Prestadora puede operar en
// cualquier región, sin geografía hardcodeada.
//
// La consulta y los cuatro estados salen de `useCatalogo`, que es la única pieza que trae una
// lista de la base. Acá queda sólo lo que distingue a este catálogo de los demás.
export function useZonasCobertura(prestadoraId) {
  return useCatalogo('zonas_cobertura', {
    filtros: { prestadora_id: prestadoraId, activa: true },
    requiere: [prestadoraId],
  });
}
