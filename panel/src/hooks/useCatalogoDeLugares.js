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

   Devuelve los cuatro estados, para que la pantalla los muestre con `EstadoLista`.

   `omitir` existe para el componente que recibe el catálogo ya cargado de quien lo llama: un hook
   no se puede llamar a veces sí y a veces no, así que se lo llama siempre y lo que cambia es si
   sale a buscar. Sin eso, una pantalla que ya tiene la lista la pediría dos veces. */
export function useCatalogoDeLugares({ omitir = false } = {}) {
  const { t } = useLocale();
  const [lugares, setLugares] = useState([]);
  const [zonas, setZonas] = useState([]);
  const [estado, setEstado] = useState(omitir ? 'listo' : 'cargando');
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    if (omitir) return;
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
  }, [t, omitir]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { lugares, zonas, estado, error, recargar };
}
