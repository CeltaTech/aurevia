import { useCatalogo } from './useCatalogo';

// Las causas de sustitución que la Prestadora tiene encendidas hoy: es la lista que se ofrece al
// mandar a otro a cubrir un turno. Nace con dos —emergencia y «otro»— y a partir de ahí la arma
// cada Prestadora, igual que los motivos de cierre.
export function useMotivosSustitucionGuardia(prestadoraId) {
  return useCatalogo('motivos_sustitucion_guardia', {
    filtros: { prestadora_id: prestadoraId, activo: true },
    requiere: [prestadoraId],
  });
}
