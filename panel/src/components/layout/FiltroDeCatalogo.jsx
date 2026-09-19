import { useLocale } from '../../i18n/LocaleContext';

/* Un filtro desplegable que se alimenta de un catálogo, con los cuatro estados adentro.
 *
 * QUÉ PASABA. Las pantallas que filtran por un catálogo se quedaban con las filas y tiraban el
 * estado y el error: mientras cargaba, o si la consulta fallaba, el desplegable se veía
 * exactamente igual que si la Prestadora no tuviera ninguna opción cargada. Quien filtraba no
 * tenía cómo distinguir «todavía no llegó» de «falló» de «no hay ninguna», y las tres cosas piden
 * hacer algo distinto.
 *
 * QUÉ HACE. Muestra lo que está pasando adentro del mismo desplegable, que es donde la persona
 * está mirando, y deja el cartel rojo sólo para el error, que es lo único que necesita una
 * explicación y un reintento. Mientras carga o si no hay nada, el desplegable queda apagado: un
 * filtro que no puede filtrar no se ofrece.
 *
 * `opciones` son `{ valor, texto }` ya resueltas al idioma de quien mira. */
export function FiltroDeCatalogo({
  etiqueta,
  valor,
  onCambiar,
  opciones,
  estado,
  error,
  recargar,
}) {
  const { t } = useLocale();

  const sinOpciones = estado === 'vacio';
  const apagado = estado === 'cargando' || estado === 'error' || sinOpciones;

  const primerRenglon =
    estado === 'cargando'
      ? t.comun.cargando
      : sinOpciones
        ? t.comun.filtro_sin_opciones
        : etiqueta;

  return (
    <>
      <select
        value={valor}
        onChange={(e) => onCambiar(e.target.value)}
        aria-label={etiqueta}
        disabled={apagado}
      >
        <option value="">{primerRenglon}</option>
        {opciones.map((opcion) => (
          <option key={opcion.valor} value={opcion.valor}>
            {opcion.texto}
          </option>
        ))}
      </select>
      {estado === 'error' && (
        <span className="panel-filtro-error" role="status">
          {error || t.comun.error_generico}
          {recargar && (
            <button type="button" onClick={recargar}>
              {t.comun.reintentar}
            </button>
          )}
        </span>
      )}
    </>
  );
}
