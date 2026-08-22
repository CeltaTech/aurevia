import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { useHaySeguimientoDeUbicacion } from '../lib/seguimientoDeUbicacion';

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
//
// Y si la Prestadora apagó el seguimiento de ubicación, tampoco: no hay nada
// que decidir, así que no hay de qué avisar.
// ============================================================================

export default function AvisoConsentimientoPendiente() {
  const { t, locale } = useLocale();
  const haySeguimiento = useHaySeguimientoDeUbicacion();
  const [hayPendiente, setHayPendiente] = useState(false);

  useEffect(() => {
    if (!haySeguimiento) return undefined;
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
  }, [locale, haySeguimiento]);

  // El aviso se retira aunque ya estuviera en pantalla: la respuesta de la Prestadora puede
  // llegar después de la consulta, y el enlace llevaría a una pantalla que ya no está.
  if (!haySeguimiento || !hayPendiente) return null;

  return (
    <div className="alert alert-info" role="status">
      <Link to="/perfil">{t.consentimientos.pendiente_aviso}</Link>
    </div>
  );
}
