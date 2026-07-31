import { useLocale } from '../../i18n/LocaleContext';
import { LOCALES } from '../../i18n/translations';
import {
  TEMAS,
  DENSIDADES,
  usePreferenciasVista,
} from '../../context/PreferenciasVistaContext';

/* Los tres desplegables de preferencia personal: en qué idioma se lee la pantalla, con qué
   colores se ve y cuánto aire hay entre las filas.

   Vive en su propio archivo porque lo usan dos lugares —el encabezado del Panel y la
   pantalla de muestra del sistema de diseño— y la regla 12 de `CLAUDE.md` §7 no admite la
   misma lógica copiada en dos archivos. Si mañana se agrega una cuarta preferencia, se
   agrega acá una sola vez.

   Las etiquetas van con `solo-lectores-pantalla`: no se ven, pero un lector de pantalla las
   lee. Un desplegable sin etiqueta es un desplegable que alguien ciego no puede usar. */
export function SelectoresPreferencias() {
  const { t, locale, setLocale } = useLocale();
  const { tema, setTema, densidad, setDensidad } = usePreferenciasVista();

  return (
    <div className="panel-preferencias">
      <label className="solo-lectores-pantalla" htmlFor="pref-idioma">
        {t.preferencias.idioma}
      </label>
      <select id="pref-idioma" value={locale} onChange={(e) => setLocale(e.target.value)}>
        {LOCALES.map((l) => (
          <option key={l} value={l}>
            {l}
          </option>
        ))}
      </select>

      <label className="solo-lectores-pantalla" htmlFor="pref-tema">
        {t.preferencias.tema}
      </label>
      <select id="pref-tema" value={tema} onChange={(e) => setTema(e.target.value)}>
        {TEMAS.map((v) => (
          <option key={v} value={v}>
            {t.preferencias[`tema_${v}`]}
          </option>
        ))}
      </select>

      <label className="solo-lectores-pantalla" htmlFor="pref-densidad">
        {t.preferencias.densidad}
      </label>
      <select id="pref-densidad" value={densidad} onChange={(e) => setDensidad(e.target.value)}>
        {DENSIDADES.map((v) => (
          <option key={v} value={v}>
            {t.preferencias[`densidad_${v}`]}
          </option>
        ))}
      </select>
    </div>
  );
}
