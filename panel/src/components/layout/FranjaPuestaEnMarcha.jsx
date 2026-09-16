import { Link, useLocation } from 'react-router-dom';
import { useLocale } from '../../i18n/LocaleContext';
import { usePuestaEnMarcha } from '../../context/PuestaEnMarchaContext';

export const RUTA_PUESTA_EN_MARCHA = '/puesta-en-marcha';

/* Lo que le falta a la Prestadora, reclamado desde cualquier pantalla.
   ==========================================================================

   POR QUÉ NO SE PUEDE CERRAR. Es el punto del pedido: la Prestadora tiene que terminar de
   cargar lo suyo, y un aviso que se cierra con una cruz se cierra la primera vez y no se ve
   nunca más. Esta franja no lleva cruz y no guarda ningún «ya lo vi»: se apaga sola, y sólo
   cuando el último paso está hecho. No hay nada que descartar mientras el trabajo siga sin
   hacer, y no hay nada que mostrar cuando ya está.

   POR QUÉ AVISA Y NO BLOQUEA. Desde acá se sigue llegando a cualquier pantalla. El producto
   avisa; no prohíbe (`celtatech/CLAUDE.md` §7). Una Prestadora que todavía no cargó sus precios
   igual puede necesitar mirar una guardia hoy.

   POR QUÉ NOMBRA UNA SOLA COSA. La franja dice cuántas faltan, pero desarrolla una: la primera
   de la lista, con lo que deja de funcionar mientras falte. Ocho consecuencias apiladas arriba
   de cada pantalla no se leen; una sí, y cuando se resuelve aparece la que sigue.

   DÓNDE NO APARECE. En la propia pantalla de puesta en marcha, donde sería el cartel que anuncia
   lo que se está mirando. Y con un Coordinador tampoco, porque el contexto contesta que no
   falta nada: ninguno de los pasos es cosa suya. */

export function FranjaPuestaEnMarcha() {
  const { t } = useLocale();
  const { pathname } = useLocation();
  const { faltan, completos, informativo } = usePuestaEnMarcha();

  if (completos) return null;
  if (pathname === RUTA_PUESTA_EN_MARCHA) return null;

  const primera = faltan[0];
  const textos = t.guia_primeros_pasos;

  return (
    // `role="status"` y no `alert`: un lector de pantalla lo anuncia al terminar de leer lo que
    // la persona vino a hacer, en vez de interrumpirla en mitad de otra pantalla. Es un
    // pendiente, no una emergencia.
    <div className="franja-puesta-en-marcha" role="status">
      <span>
        {/* Cuando queda uno solo el texto es otro, y no el plural con un «1» adentro: la franja
            aparece en todas las pantallas, y el último paso es justo el que más se va a leer. */}
        <strong>
          {faltan.length === 1
            ? t.puesta_en_marcha.franja_titulo_uno
            : t.puesta_en_marcha.franja_titulo.replace('{cantidad}', faltan.length)}
        </strong>
        {': '}
        {textos[`paso_${primera.clave}_titulo`]}
        {' — '}
        {textos[`paso_${primera.clave}_consecuencia`]}
      </span>
      {/* Un Superadmin de visita ve el estado de la Prestadora, pero completarlo no es trabajo
          suyo: no se le ofrece el botón. */}
      {!informativo && (
        <Link to={RUTA_PUESTA_EN_MARCHA} className="franja-puesta-en-marcha-accion">
          {t.puesta_en_marcha.franja_cta}
        </Link>
      )}
    </div>
  );
}
