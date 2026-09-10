import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { usePermisos } from '../../context/PermisosContext';
import { useModalidades } from '../../context/ModalidadesContext';
import { useLocale } from '../../i18n/LocaleContext';
import { esAdminOSuperior, ROLES_PANEL } from '../../lib/roles';

export function ProtectedRoute({ children, soloAdmin = false, roles = null, permiso = null, modalidad = null }) {
  const { session, usuario, cargando, mfaEstado } = useAuth();
  const { puede, cargado: permisosCargados } = usePermisos();
  const { tieneModalidad, cargado: modalidadesCargadas } = useModalidades();
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

  // Candado por permiso configurable. El Admin entra siempre, sin esperar nada: para él la
  // respuesta ya se sabe. El Coordinador tiene que esperar a que lleguen sus permisos, y
  // mientras no llegan no entra — si algo falla, la pantalla no se abre, que es el lado
  // correcto para equivocarse.
  if (permiso && !esAdminOSuperior(usuario.rol)) {
    if (!permisosCargados) return <div className="pantalla-cargando">{t.comun.cargando}</div>;
    if (!puede(permiso)) return <Navigate to="/" replace />;
  }

  // Candado por modalidad de negocio. No es un candado por rol y no tiene excepción para el
  // Admin: una pantalla de Marketplace no existe en una Prestadora que trabaja solamente en
  // prestación directa, la mire quien la mire. El menú ya esconde estos enlaces
  // (`layout/Layout.jsx`), pero esconder un enlace no impide escribir la dirección a mano.
  //
  // Esto es para no mostrar lo que no corresponde. **El candado de verdad está en el motor**
  // (`backend/src/middleware/exigirModalidad.js`), que es lo único que no se puede saltear.
  //
  // Mismo criterio de espera que el permiso, y por el mismo motivo: mientras no se sepa qué
  // modalidades tiene la Prestadora, no se entra. Si algo falla, la pantalla no se abre, que
  // es el lado correcto para equivocarse.
  if (modalidad) {
    if (!modalidadesCargadas) return <div className="pantalla-cargando">{t.comun.cargando}</div>;
    if (!tieneModalidad(modalidad)) return <Navigate to="/" replace />;
  }

  return children;
}
