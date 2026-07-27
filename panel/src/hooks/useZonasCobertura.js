import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Zonas de cobertura reales configuradas por cada Prestadora (tabla zonas_cobertura) —
// pendiente #18 candidatos 4 y 5 (docs/PENDIENTES.md). Reemplaza las 7 etiquetas fijas de
// AMBA que antes vivían en t.postulaciones.zonas_labels: cada Prestadora puede operar en
// cualquier región, sin geografía hardcodeada.
export function useZonasCobertura(prestadoraId) {
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | error | listo
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    if (!prestadoraId) return;
    setEstado('cargando');
    setError(null);

    const { data, error: errorConsulta } = await supabase
      .from('zonas_cobertura')
      .select('*')
      .eq('prestadora_id', prestadoraId)
      .eq('activa', true)
      .order('orden');

    if (errorConsulta) {
      setError(errorConsulta.message);
      setEstado('error');
      return;
    }

    setFilas(data ?? []);
    setEstado('listo');
  }, [prestadoraId]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { filas, estado, error, recargar };
}
