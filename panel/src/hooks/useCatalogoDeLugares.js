import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { llamarApiLugaresDeTrabajo } from '../lib/apiLugaresDeTrabajo';
import { mensajeDeError } from '../lib/errores';

/* La lista de lugares de la Prestadora y qué abarca cada zona, para cualquier pantalla donde se
   elijan lugares.

   Tres pantallas la necesitan —la de Configuración, la ficha de la Asistente y el alcance de una
   coordinadora— y las tres la piden acá, no cada una por su lado. Es el mismo punto único de
   verdad que del lado del motor: si la carga se escribiera tres veces, una mostraría los apagados
   y otra no, y nadie sabría cuál está bien.

   Devuelve los cuatro estados, para que la pantalla los muestre con `EstadoLista`. */
export function useCatalogoDeLugares() {
  const { t } = useLocale();
  const [lugares, setLugares] = useState([]);
  const [zonas, setZonas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const datos = await llamarApiLugaresDeTrabajo('/catalogo');
      setLugares(datos.lugares ?? []);
      setZonas(datos.zonas ?? []);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { lugares, zonas, estado, error, recargar };
}
