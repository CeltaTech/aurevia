import { NavLink, Outlet } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';

/* Configuración es una cáscara: el título, la barra de las cinco secciones y el
   hueco donde entra la que esté elegida.

   Antes era un solo archivo de 2.443 líneas con trece solapas guardadas en la
   memoria de la pantalla. Eso tenía dos problemas: no se podía guardar el enlace
   de una solapa ni mandárselo a nadie —todas vivían en la misma dirección—, y
   cualquier retoque obligaba a abrir el archivo entero.

   Ahora cada sección tiene su propia dirección (/configuracion/prestadora, y así)
   y su propio archivo en `pages/configuracion/`. Adentro de cada una los temas van
   uno abajo del otro con su título, que es como resuelven esto los programas que
   tienen muchas opciones: una lista de secciones arriba, y adentro de cada
   sección todo a la vista sin más clics. */
const SECCIONES = ['prestadora', 'asistentes', 'cuidado', 'avisos', 'accesos'];

export function Configuracion() {
  const { t } = useLocale();

  return (
    <div>
      <h1>{t.configuracion.titulo}</h1>
      <p className="panel-explicacion">{t.configuracion.explicacion}</p>

      <div className="panel-tabs">
        {SECCIONES.map((seccion) => (
          <NavLink
            key={seccion}
            to={seccion}
            className={({ isActive }) => `panel-tab ${isActive ? 'panel-tab-activo' : ''}`}
          >
            {t.configuracion[`seccion_${seccion}`]}
          </NavLink>
        ))}
      </div>

      <div className="panel-tab-contenido">
        <Outlet />
      </div>
    </div>
  );
}
