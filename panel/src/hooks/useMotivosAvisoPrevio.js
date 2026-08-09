import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { mensajeDeError } from '../lib/errores';
import { useLocale } from '../i18n/LocaleContext';

// Catálogo de motivos de aviso previo de guardia, configurable por Prestadora —
// pendiente #18 candidato 3 (docs/PENDIENTES.md). Reemplaza los 4 valores fijos que
// antes tenía GuardiaAcciones.jsx (Salud/Transporte/Familiar/Otro).
export function useMotivosAvisoPrevio(prestadoraId) {
  const { t } = useLocale();
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | error | listo
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    if (!prestadoraId) return;
    setEstado('cargando');
    setError(null);

    const { data, error: errorConsulta } = await supabase
      .from('motivos_aviso_previo_guardia')
      .select('*')
      .eq('prestadora_id', prestadoraId)
      .order('nombre');

    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }

    setFilas(data ?? []);
    setEstado('listo');
  }, [prestadoraId, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { filas, estado, error, recargar };
}
