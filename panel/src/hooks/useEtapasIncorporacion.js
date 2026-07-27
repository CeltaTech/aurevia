import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Etapas del Proceso de Incorporación de Asistentes configuradas por cada Prestadora —
// pendiente #18 candidato 7 (docs/PENDIENTES.md). Reemplaza el arreglo fijo de 5 etapas
// que antes compartían todas las Prestadoras.
export function useEtapasIncorporacion(prestadoraId) {
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | error | listo
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    if (!prestadoraId) return;
    setEstado('cargando');
    setError(null);

    const { data, error: errorConsulta } = await supabase
      .from('etapas_incorporacion_asistente')
      .select('*')
      .eq('prestadora_id', prestadoraId)
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
