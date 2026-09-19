import { useCallback } from 'react';
import { useCatalogo } from './useCatalogo';
import { usePaisDeLaPrestadora } from './usePaisDeLaPrestadora';

// Trae únicamente las escalas legales de la jurisdicción de la Prestadora activa (resuelta
// vía prestadoras.pais, mismo patrón que AdvertenciaLegalContext.jsx:29-33) — pendiente #72.
// escalas_legales es contenido legal curado por CeltaTech por país, nunca una decisión de una
// Prestadora individual (CLAUDE.md §3), por eso el filtro es siempre por jurisdicción, no
// por prestadora_id. La resolución por fecha del hecho se hace después con
// resolverEscalasVigentes, nunca acá.
export function useEscalasLegales(prestadoraId) {
  const {
    pais,
    estado: estadoPais,
    error: errorPais,
    recargar: recargarPais,
  } = usePaisDeLaPrestadora(prestadoraId);

  const {
    filas,
    estado: estadoEscalas,
    error: errorEscalas,
    recargar: recargarEscalas,
  } = useCatalogo('escalas_legales', {
    filtros: { jurisdiccion: pais },
    orden: { columna: 'vigencia_desde', ascendente: false },
    requiere: [pais],
  });

  const recargar = useCallback(() => {
    recargarPais();
    recargarEscalas();
  }, [recargarPais, recargarEscalas]);

  // Sin jurisdicción no hay escala que buscar, así que lo que se muestra es lo que pasó al
  // resolverla, no una lista vacía sin explicación.
  const estado = estadoPais === 'listo' ? estadoEscalas : estadoPais;

  return {
    filas,
    estado,
    error: errorPais || errorEscalas,
    recargar,
    jurisdiccion: pais,
  };
}
