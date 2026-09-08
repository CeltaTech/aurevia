// El renglón que le recuerda al titular que quedó una instrucción sin firmar.
//
// NO BLOQUEA NI INTERRUMPE, A PROPÓSITO. Lo que el titular pidió ya rige desde que la Prestadora
// lo cargó: lo que falta es la constancia firmada. Un cartel que tape la pantalla, o que obligue a
// firmar para seguir, estaría mintiendo sobre qué pasa si no se firma.
//
// SÓLO LO VE EL TITULAR, y sólo cuando hay algo pendiente. Para el resto del círculo no existe: la
// instrucción no es suya y no hay nada que puedan hacer con ella.
//
// Se dibuja en la pantalla principal y en Mi Perfil. La lista de Pacientes se saltea sola cuando
// hay uno solo, así que las dos son «la pantalla principal» según la Familia, y el aviso tiene que
// aparecer igual en las dos.

import { Link, useLocation } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useCirculo } from '../context/CirculoContext';

export default function AvisoInstruccionPendiente() {
  const { t } = useLocale();
  const { esTitular, instruccionPendiente } = useCirculo();
  const location = useLocation();

  if (!esTitular || !instruccionPendiente) return null;

  return (
    <div className="alert alert-info aviso-instruccion" role="status">
      <span>{t.instruccion.aviso}</span>
      {/* De qué pantalla se salió, para volver a esa después de firmar y no a un lugar fijo. */}
      <Link
        to="/instruccion"
        state={{ desde: location.pathname }}
        className="btn btn-secondary"
        style={{ fontSize: '0.8rem', padding: '0.4rem 1rem' }}
      >
        {t.instruccion.aviso_enlace}
      </Link>
    </div>
  );
}
