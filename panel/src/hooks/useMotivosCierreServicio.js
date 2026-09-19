import { useCatalogo } from './useCatalogo';

// Los motivos de cierre que la Prestadora tiene encendidos hoy: es la lista que se ofrece al
// cerrar la atención de un Paciente. Reemplaza los tres valores fijos que antes estaban escritos
// adentro de la pantalla —y adentro de una restricción de la base—. El catálogo completo, con los
// apagados, se administra desde Configuración y pasa por el motor.
export function useMotivosCierreServicio(prestadoraId) {
  return useCatalogo('motivos_cierre_servicio', {
    filtros: { prestadora_id: prestadoraId, activo: true },
    requiere: [prestadoraId],
  });
}
