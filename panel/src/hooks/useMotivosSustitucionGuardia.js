import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { mensajeDeError } from '../lib/errores';
import { useLocale } from '../i18n/LocaleContext';

// Las causas de sustitución que la Prestadora tiene encendidas hoy: es la lista que se ofrece al
// mandar a otro a cubrir un turno. Nace con dos —emergencia y «otro»— y a partir de ahí la arma
// cada Prestadora, igual que los motivos de cierre.
export function useMotivosSustitucionGuardia(prestadoraId) {
  const { t } = useLocale();
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | error | listo
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    if (!prestadoraId) return;
    setEstado('cargando');
    setError(null);

    const { data, error: errorConsulta } = await supabase
      .from('motivos_sustitucion_guardia')
      .select('*')
      .eq('prestadora_id', prestadoraId)
      .eq('activo', true)
      .order('orden');

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
