import { useCallback } from 'react';
import { useCatalogo } from './useCatalogo';
import { usePaisDeLaPrestadora } from './usePaisDeLaPrestadora';

// Análogo a useEscalasLegales.js — trae las fórmulas de cese (pendiente #72) de la
// jurisdicción de la Prestadora activa. Mismo criterio: contenido legal curado por CeltaTech
// por país, nunca decidido por una Prestadora individual (CLAUDE.md §3).
export function useFormulasCese(prestadoraId) {
  const {
    pais,
    estado: estadoPais,
    error: errorPais,
    recargar: recargarPais,
  } = usePaisDeLaPrestadora(prestadoraId);

  const {
    filas,
    estado: estadoFormulas,
    error: errorFormulas,
    recargar: recargarFormulas,
  } = useCatalogo('formulas_cese', {
    filtros: { jurisdiccion: pais },
    orden: { columna: 'vigencia_desde', ascendente: false },
    requiere: [pais],
  });

  const recargar = useCallback(() => {
    recargarPais();
    recargarFormulas();
  }, [recargarPais, recargarFormulas]);

  const estado = estadoPais === 'listo' ? estadoFormulas : estadoPais;

  return {
    filas,
    estado,
    error: errorPais || errorFormulas,
    recargar,
    jurisdiccion: pais,
  };
}
