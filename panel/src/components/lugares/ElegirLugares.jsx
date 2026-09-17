import { useLocale } from '../../i18n/LocaleContext';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { SelectorDeLugares } from './SelectorDeLugares';
import { useCatalogoDeLugares } from '../../hooks/useCatalogoDeLugares';

/* La lista de lugares, traída y mostrada, para cualquier pantalla que elija lugares de una persona.

   `SelectorDeLugares` no carga nada: recibe la lista y la muestra. Traerla, esperar, mostrar el
   error y ofrecer reintentar es lo mismo en todas las pantallas que eligen, así que está acá una
   sola vez. Sin esto, cada pantalla escribiría sus cuatro estados y una terminaría sin el
   reintento, o mostrando una lista vacía cuando lo que pasó fue que la carga falló.

   Las zonas se pasan tal como vienen, porque acá sí sirven para agrupar: quien elige dónde acepta
   trabajar una Asistente piensa por zona, y marca la zona entera antes de sacarle lo que no va.
   Lo que queda guardado siguen siendo los lugares. */
export function ElegirLugares({ valor, onChange, deshabilitado = false }) {
  const { t } = useLocale();
  const { lugares, zonas, estado, error, recargar } = useCatalogoDeLugares();

  return (
    <EstadoLista
      estado={estado}
      error={error}
      vacio={estado === 'listo' && lugares.length === 0}
      mensajeVacio={t.configuracion.lugares_sin_lista}
      recargar={recargar}
    >
      <SelectorDeLugares
        lugares={lugares}
        zonas={zonas}
        valor={valor}
        onChange={onChange}
        deshabilitado={deshabilitado}
      />
    </EstadoLista>
  );
}
