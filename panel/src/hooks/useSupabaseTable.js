import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { mensajeDeError } from '../lib/errores';
import { useLocale } from '../i18n/LocaleContext';

/**
 * `select` sirve para traer también una tabla adjunta —por ejemplo los datos que viven aparte
 * de la ficha del Asistente—. Por defecto trae las columnas de la tabla y nada más.
 */
export function useSupabaseTable(tabla, { orderBy = 'creado_en', ascending = false, select = '*' } = {}) {
  const { t } = useLocale();
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | error | listo
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from(tabla)
      .select(select)
      .order(orderBy, { ascending });

    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }

    setFilas(data ?? []);
    setEstado('listo');
  }, [tabla, orderBy, ascending, select, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { filas, estado, error, recargar };
}
