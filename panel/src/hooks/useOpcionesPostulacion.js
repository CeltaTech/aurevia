import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { mensajeDeError } from '../lib/errores';
import { useLocale } from '../i18n/LocaleContext';

// Una de las listas de opciones del formulario de postulación, tal como la cargó esta Prestadora
// (tabla `opciones_postulacion`, una fila por opción y por grupo). Mismo molde que
// `useZonasCobertura`: sólo las activas, en el orden que ella les dio, y con el pase de quien
// mira, así que la protección por fila resuelve de qué Prestadora se trata.
//
// `labels` es el diccionario `código → etiqueta` que `traducirCodigos` necesita para mostrar lo
// que quedó guardado en una postulación. Un código sin opción cargada se muestra tal cual: lo que
// ya se escribió no depende de que el catálogo de hoy lo siga teniendo.
export function useOpcionesPostulacion(prestadoraId, grupo) {
  const { t } = useLocale();
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | error | listo
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    if (!prestadoraId || !grupo) return;
    setEstado('cargando');
    setError(null);

    const { data, error: errorConsulta } = await supabase
      .from('opciones_postulacion')
      .select('clave, etiqueta, orden')
      .eq('prestadora_id', prestadoraId)
      .eq('grupo', grupo)
      .eq('activo', true)
      .order('orden');

    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }

    setFilas(data ?? []);
    setEstado('listo');
  }, [prestadoraId, grupo, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const labels = useMemo(
    () => Object.fromEntries(filas.map((o) => [o.clave, o.etiqueta])),
    [filas],
  );

  return { filas, labels, estado, error, recargar };
}
