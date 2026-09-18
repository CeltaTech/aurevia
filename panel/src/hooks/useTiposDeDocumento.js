import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { mensajeDeError } from '../lib/errores';
import { useLocale } from '../i18n/LocaleContext';

/* Con qué documentos se identifica una Persona en el país de la Prestadora.
   =========================================================================

   La lista sale de la base y no de la pantalla, porque qué documentos existen lo decide un Estado
   y cambia de país en país. Escribirla adentro del formulario obligaría a publicar una versión
   nueva del Panel cada vez que se vende en otro país.

   DEVUELVE LOS DE LAS DOS CLASES POR SEPARADO. A una persona física y a una jurídica no se les
   pide lo mismo, y el formulario cambia la lista cuando cambia la clase sin salir a preguntar de
   nuevo.

   SI EL PAÍS NO TIENE NINGUNO CARGADO, DEVUELVE VACÍO Y NO SE INVENTA NADA. La pantalla entonces
   no pide el documento: dejarlo como casillero libre haría que cada quien escriba lo que le
   parezca, y un documento tipeado mal crea una persona que no existe. */
export function useTiposDeDocumento(prestadoraId) {
  const { t } = useLocale();
  const [porClase, setPorClase] = useState({ fisica: [], juridica: [] });
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

    const { data, error: errorCatalogo } = await supabase
      .from('catalogo_documentos_de_identidad')
      .select('clase, codigo, sigla')
      .eq('pais', prestadora.pais)
      .eq('activo', true)
      .order('orden');

    if (errorCatalogo) {
      setError(mensajeDeError(errorCatalogo, t));
      setEstado('error');
      return;
    }

    setPorClase({
      fisica: (data ?? []).filter((uno) => uno.clase === 'fisica'),
      juridica: (data ?? []).filter((uno) => uno.clase === 'juridica'),
    });
    setEstado('listo');
  }, [prestadoraId, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { porClase, estado, error, recargar };
}
