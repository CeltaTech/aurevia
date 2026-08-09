import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { mensajeDeError } from '../lib/errores';
import { useLocale } from '../i18n/LocaleContext';

export function useSupabaseTable(tabla, { orderBy = 'creado_en', ascending = false } = {}) {
  const { t } = useLocale();
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | error | listo
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from(tabla)
      .select('*')
      .order(orderBy, { ascending });

    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }

    setFilas(data ?? []);
    setEstado('listo');
  }, [tabla, orderBy, ascending, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { filas, estado, error, recargar };
}
