import { Navigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { usePuestaEnMarcha } from '../context/PuestaEnMarchaContext';
import { GuiaPrimerosPasos } from '../components/estado-actual/GuiaPrimerosPasos';

/* La pantalla donde una Prestadora nueva completa lo que le falta.
   ==========================================================================

   POR QUÉ ES UNA PANTALLA PROPIA. La guía ya existía, pero colgada arriba del Estado actual:
   quien entraba por primera vez la veía encima de una grilla de guardias vacía, que es
   exactamente el ruido del que hay que sacarlo. Acá está sola, que es lo único que esa
   Prestadora tiene para hacer todavía.

   A DÓNDE LLEVA. A ningún lado por sí sola: mientras falte algo, la entrada del Panel desvía
   acá (`App.jsx`). Completado el último paso, esta pantalla se vacía y devuelve a quien la
   abra al Estado actual, que es la entrada normal del Panel. No hace falta que nadie apague
   nada a mano, y no queda una dirección muerta reclamando algo que ya está hecho.

   NO BLOQUEA. Desde acá se llega a cualquier pantalla por el menú, como siempre. El producto
   avisa; no prohíbe (`celtatech/CLAUDE.md` §7). Lo que no lo deja olvidarse es la franja del
   Layout, que lo sigue a donde vaya mientras quede algo sin cargar. */

export function PuestaEnMarcha() {
  const { t } = useLocale();
  const { completos, estado } = usePuestaEnMarcha();

  // Ya no falta nada: esta dirección deja de tener sentido y devuelve a la entrada de siempre.
  // Se espera a saberlo, porque mientras carga el contexto contesta que no falta nada, y
  // redirigir con esa respuesta provisoria sacaría de acá a quien sí tiene pasos pendientes.
  if (estado === 'listo' && completos) return <Navigate to="/" replace />;

  return (
    <div>
      <h1>{t.puesta_en_marcha.titulo}</h1>
      <p className="panel-lateral-subtitulo">{t.puesta_en_marcha.subtitulo}</p>
      <GuiaPrimerosPasos />
    </div>
  );
}
