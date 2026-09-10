import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { mensajeDeError } from '../lib/errores';
import { useLocale } from '../i18n/LocaleContext';

// Los motivos de cierre que la Prestadora tiene encendidos hoy: es la lista que se ofrece al
// cerrar la atención de un Paciente. Reemplaza los tres valores fijos que antes estaban escritos
// adentro de la pantalla —y adentro de una restricción de la base—. El catálogo completo, con los
// apagados, se administra desde Configuración y pasa por el motor.
export function useMotivosCierreServicio(prestadoraId) {
  const { t } = useLocale();
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | error | listo
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    if (!prestadoraId) return;
    setEstado('cargando');
    setError(null);

    const { data, error: errorConsulta } = await supabase
      .from('motivos_cierre_servicio')
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
