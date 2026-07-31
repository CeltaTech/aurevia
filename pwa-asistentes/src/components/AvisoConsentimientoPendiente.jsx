import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';

// ============================================================================
// Pendiente #102 — aviso de que hay un consentimiento sin decidir.
//
// Es un aviso, no una puerta. Lleva a Mi Perfil, donde está el texto completo
// y los dos botones. Deliberadamente NO interrumpe ni tapa la pantalla: hacer
// que la persona tenga que decidir antes de poder trabajar convertiría el
// consentimiento en un peaje, y un consentimiento que hay que dar para poder
// trabajar no es libre.
//
// Si algo falla al consultarlo, no se muestra nada. Un aviso roto sería peor
// que ningún aviso.
// ============================================================================

export default function AvisoConsentimientoPendiente() {
  const { t, locale } = useLocale();
  const [hayPendiente, setHayPendiente] = useState(false);

  useEffect(() => {
    let activo = true;
    api
      .consentimientos(locale)
      .then(({ consentimientos }) => {
        if (activo) setHayPendiente((consentimientos || []).some((c) => c.pendiente));
      })
      .catch(() => {});
    return () => {
      activo = false;
    };
  }, [locale]);

  if (!hayPendiente) return null;

  return (
    <div className="alert alert-info">
      <Link to="/perfil">{t.consentimientos.pendiente_aviso}</Link>
    </div>
  );
}
