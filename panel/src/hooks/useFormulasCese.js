import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Análogo a useEscalasLegales.js — trae las fórmulas de cese (pendiente #72) de la
// jurisdicción de la Prestadora activa. Mismo criterio: contenido legal curado por CeltaTech
// por país, nunca decidido por una Prestadora individual (CLAUDE.md §3).
export function useFormulasCese(prestadoraId) {
  const [filas, setFilas] = useState([]);
  const [jurisdiccion, setJurisdiccion] = useState(null);
  const [estado, setEstado] = useState('cargando'); // cargando | error | listo
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    if (!prestadoraId) return;
    setEstado('cargando');
    setError(null);

    const { data: prestadora, error: errorPrestadora } = await supabase
      .from('prestadoras')
      .select('pais')
      .eq('id', prestadoraId)
      .single();
    if (errorPrestadora || !prestadora) {
      setError(errorPrestadora?.message ?? 'No se pudo resolver el país de la Prestadora.');
      setEstado('error');
      return;
    }
    setJurisdiccion(prestadora.pais);

    const { data, error: errorFormulas } = await supabase
      .from('formulas_cese')
      .select('*')
      .eq('jurisdiccion', prestadora.pais)
      .order('vigencia_desde', { ascending: false });

    if (errorFormulas) {
      setError(errorFormulas.message);
      setEstado('error');
      return;
    }

    setFilas(data ?? []);
    setEstado('listo');
  }, [prestadoraId]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { filas, estado, error, recargar, jurisdiccion };
}
