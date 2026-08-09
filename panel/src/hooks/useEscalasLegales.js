import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { mensajeDeError } from '../lib/errores';
import { useLocale } from '../i18n/LocaleContext';

// Trae únicamente las escalas legales de la jurisdicción de la Prestadora activa (resuelta
// vía prestadoras.pais, mismo patrón que AdvertenciaLegalContext.jsx:29-33) — pendiente #72.
// escalas_legales es contenido legal curado por CeltaTech por país, nunca una decisión de una
// Prestadora individual (CLAUDE.md §3), por eso el filtro es siempre por jurisdicción, no
// por prestadora_id. La resolución por fecha del hecho se hace después con
// resolverEscalasVigentes, nunca acá.
export function useEscalasLegales(prestadoraId) {
  const { t } = useLocale();
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
      setError(mensajeDeError(errorPrestadora ?? { code: 'PGRST116' }, t));
      setEstado('error');
      return;
    }
    setJurisdiccion(prestadora.pais);

    const { data, error: errorEscalas } = await supabase
      .from('escalas_legales')
      .select('*')
      .eq('jurisdiccion', prestadora.pais)
      .order('vigencia_desde', { ascending: false });

    if (errorEscalas) {
      setError(mensajeDeError(errorEscalas, t));
      setEstado('error');
      return;
    }

    setFilas(data ?? []);
    setEstado('listo');
  }, [prestadoraId, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { filas, estado, error, recargar, jurisdiccion };
}
