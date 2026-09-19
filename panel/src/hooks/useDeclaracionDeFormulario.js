// La declaración de un formulario, traída una sola vez y con sus cuatro estados.
//
// Cargando, error, vacío y listo. El vacío acá es un formulario declarado sin ninguna sección
// encendida: existe, pero no hay nada que dibujar, y eso no es lo mismo que una falla.

import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { mensajeDeError } from '../lib/errores';
import { traerDeclaracion } from '../lib/apiFormularios';

export function useDeclaracionDeFormulario(clave) {
  const { t } = useLocale();
  const [declaracion, setDeclaracion] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState('');

  const cargar = useCallback(async () => {
    if (!clave) {
      setDeclaracion(null);
      setEstado('vacio');
      return;
    }
    setEstado('cargando');
    setError('');
    try {
      const traida = await traerDeclaracion(clave);
      setDeclaracion(traida ?? null);
      const secciones = traida?.secciones ?? [];
      setEstado(secciones.length === 0 ? 'vacio' : 'listo');
    } catch (errorConsulta) {
      setDeclaracion(null);
      setError(mensajeDeError(errorConsulta, t, 'declaración del formulario'));
      setEstado('error');
    }
  }, [clave, t]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  return { declaracion, estado, error, recargar: cargar };
}
