import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useLocale } from '../../i18n/LocaleContext';
import { esAdminOSuperior, ROLES_PANEL } from '../../lib/roles';

export function ProtectedRoute({ children, soloAdmin = false, roles = null }) {
  const { session, usuario, cargando, mfaEstado } = useAuth();
  const { t } = useLocale();

  if (cargando) {
    return <div className="pantalla-cargando">{t.comun.cargando}</div>;
  }

  // Qué roles entran al Panel se decide en un solo lugar (lib/roles.js, CLAUDE.md §7.12) —
  // no se repite la lista acá.
  if (!session || !usuario || !ROLES_PANEL.includes(usuario.rol)) {
    return <Navigate to="/login" replace />;
  }

  // Ítem H del pendiente #30 — con el toggle de MFA en ON, superadmin no pasa de acá hasta
  // enrolar o verificar el segundo factor (AuthContext.evaluarMfa).
  if (mfaEstado === 'requiere_enrolamiento' || mfaEstado === 'requiere_challenge') {
    return <Navigate to="/mfa" replace />;
  }

  if (soloAdmin && !esAdminOSuperior(usuario.rol)) {
    return <Navigate to="/" replace />;
  }

  if (roles && !roles.includes(usuario.rol)) {
    return <Navigate to="/" replace />;
  }

  return children;
}
