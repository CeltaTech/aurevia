import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { mensajeDeError } from '../lib/errores';
import { useLocale } from '../i18n/LocaleContext';
import { finalesQueSeOfrecen } from '../lib/incidenteTurnoSinCubrir';

// Cómo puede terminar un turno que quedó sin nadie, según esta Prestadora. Nace con los que trae
// el producto y a partir de ahí la lista es de ella, igual que los motivos de cierre de servicio y
// las causas de sustitución.
//
// Se piden los encendidos y se descartan acá los dos que escribe el motor: son finales de verdad
// —quedan escritos en expedientes cerrados— pero no se eligen, porque la base ya los dice.
export function useFinalesTurnoSinCubrir(prestadoraId) {
  const { t } = useLocale();
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | error | listo
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    if (!prestadoraId) return;
    setEstado('cargando');
    setError(null);

    const { data, error: errorConsulta } = await supabase
      .from('finales_turno_sin_cubrir')
      .select('*')
      .eq('prestadora_id', prestadoraId)
      .eq('activo', true)
      .order('orden');

    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }

    setFilas(finalesQueSeOfrecen(data ?? []));
    setEstado('listo');
  }, [prestadoraId, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { filas, estado, error, recargar };
}
