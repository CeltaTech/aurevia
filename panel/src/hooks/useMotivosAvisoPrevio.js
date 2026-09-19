import { useCatalogo } from './useCatalogo';

// Catálogo de motivos de aviso previo de guardia, configurable por Prestadora. Reemplaza los
// cuatro valores fijos que antes tenía GuardiaAcciones.jsx (Salud/Transporte/Familiar/Otro).
export function useMotivosAvisoPrevio(prestadoraId) {
  return useCatalogo('motivos_aviso_previo_guardia', {
    filtros: { prestadora_id: prestadoraId },
    orden: 'nombre',
    requiere: [prestadoraId],
  });
}
