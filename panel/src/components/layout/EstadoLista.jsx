import { useLocale } from '../../i18n/LocaleContext';
import { Alert } from '../ui/Alert';
import { Button } from '../ui/Button';

/* Los cuatro estados de cualquier lista del Panel: cargando, error, vacío y listo
   (`CLAUDE.md` §7 regla 3). Este componente es el único lugar donde están escritos, para
   que las veinte pantallas que muestran listas no los resuelvan cada una a su manera
   (regla 12).

   EL VACÍO SON DOS SITUACIONES, NO UNA. Es el cambio de la Etapa 3:

     · No hay ni un dato cargado todavía  → lo que corresponde es crear el primero.
     · Hay datos, pero el filtro los tapó → lo que corresponde es sacar el filtro.

   Hasta acá el Panel mostraba el mismo cartel en los dos casos, y eso hace que alguien con
   un filtro puesto crea que perdió los datos. Ahora la pantalla le pasa `filtrado` y el
   cartel cambia, incluida la salida que ofrece.

   Cómo se usa desde una pantalla:

     <EstadoLista
       estado={estado}
       error={error}
       recargar={cargar}
       vacio={filtradas.length === 0}
       filtrado={hayFiltrosPuestos}
       onLimpiarFiltros={limpiarFiltros}
       accionVacio={<Button onClick={abrirAlta}>…</Button>}
     >
       …la tabla…
     </EstadoLista>

   `filtrado` y `onLimpiarFiltros` son opcionales: una pantalla que todavía no los pasa se
   sigue comportando como antes, mostrando el cartel de "todavía no hay nada". */
export function EstadoLista({
  estado,
  error,
  vacio,
  recargar,
  mensajeVacio,
  accionVacio,
  filtrado = false,
  onLimpiarFiltros,
  children,
}) {
  const { t } = useLocale();

  if (estado === 'cargando') {
    // `role="status"` para que el cambio de estado se anuncie solo: quien no ve la pantalla
    // tiene que enterarse de que está cargando, y después de que apareció la lista.
    return <p className="estado-cargando" role="status">{t.comun.cargando}</p>;
  }

  if (estado === 'error') {
    return (
      <Alert variant="error">
        {error || t.comun.error_generico}{' '}
        <Button variant="secondary" onClick={recargar}>
          {t.comun.reintentar}
        </Button>
      </Alert>
    );
  }

  if (vacio) {
    // Con filtros puestos: el filtro no encontró nada, y la salida es sacarlo.
    if (filtrado) {
      return (
        <div className="estado-vacio-bloque" role="status">
          <p className="estado-vacio-titulo">{t.comun.sin_resultados_titulo}</p>
          <p className="estado-vacio">{t.comun.sin_resultados_ayuda}</p>
          {onLimpiarFiltros && (
            <Button variant="secondary" onClick={onLimpiarFiltros}>
              {t.comun.limpiar_filtros}
            </Button>
          )}
        </div>
      );
    }

    // Sin filtros: no hay ni un dato todavía, y la salida es crear el primero.
    return (
      <div className="estado-vacio-bloque" role="status">
        <p className="estado-vacio-titulo">{mensajeVacio || t.comun.sin_datos_titulo}</p>
        <p className="estado-vacio">{t.comun.sin_datos_ayuda}</p>
        {accionVacio}
      </div>
    );
  }

  return children;
}
