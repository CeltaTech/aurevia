import { NavLink, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { useEmpresa } from '../../context/EmpresaContext';
import { useTenantSession } from '../../context/TenantSessionContext';
import { usePermisos } from '../../context/PermisosContext';
import { useModalidades } from '../../context/ModalidadesContext';
import { esAdminOSuperior } from '../../lib/roles';
import { SelectoresPreferencias } from './SelectoresPreferencias';

const AVISO_MINUTOS_RESTANTES = 10; // aviso "a los 50 minutos" de una sesión de 60

function BannerSesionTenant() {
  const { t } = useLocale();
  const { sesion, salir, renovar } = useTenantSession();
  const [saliendo, setSaliendo] = useState(false);
  const [renovando, setRenovando] = useState(false);

  if (!sesion) return null;

  const minutosRestantes = (new Date(sesion.expira_at).getTime() - Date.now()) / 60000;
  const porVencer = minutosRestantes <= AVISO_MINUTOS_RESTANTES;
  const horaExpiracion = new Date(sesion.expira_at).toLocaleTimeString();

  async function handleSalir() {
    setSaliendo(true);
    try {
      await salir();
    } finally {
      setSaliendo(false);
    }
  }

  async function handleRenovar() {
    setRenovando(true);
    try {
      await renovar();
    } finally {
      setRenovando(false);
    }
  }

  return (
    <div className={porVencer ? 'banner-sesion-tenant banner-sesion-tenant-advertencia' : 'banner-sesion-tenant'}>
      <span>
        <strong>{porVencer ? t.prestadoras.sesion_advertencia.replace('{hora}', horaExpiracion) : t.prestadoras.sesion_activa_titulo}</strong>
        {!porVencer && (
          <>
            {': '}
            {sesion.prestadoras?.nombre_fantasia}
            {' — '}
            {t.prestadoras.sesion_activa_expira.replace('{hora}', horaExpiracion)}
          </>
        )}
      </span>
      <span className="banner-sesion-tenant-acciones">
        {porVencer && (
          <button className="banner-sesion-tenant-salir" onClick={handleRenovar} disabled={renovando}>
            {renovando ? t.prestadoras.renovando : t.prestadoras.seguir_trabajando}
          </button>
        )}
        <button className="banner-sesion-tenant-salir" onClick={handleSalir} disabled={saliendo}>
          {saliendo ? t.prestadoras.saliendo : t.prestadoras.salir}
        </button>
      </span>
    </div>
  );
}

export function Layout() {
  const { t } = useLocale();
  const { usuario, logout } = useAuth();
  const { empresa } = useEmpresa();
  const { puede } = usePermisos();
  const { tieneModalidad } = useModalidades();

  return (
    <div className="panel-layout">
      <aside className="panel-sidebar">
        <div className="panel-logo">{empresa?.nombre ?? ''}</div>
        <nav>
          {/* Arriba de todo, sin grupo: el Estado actual es el punto de partida del día, y el
              resumen del mes queda justo debajo para el que quiera el número grande. */}
          <NavLink to="/" end>
            {t.nav.estado_actual}
          </NavLink>
          <NavLink to="/resumen-del-mes">{t.nav.resumen_del_mes}</NavLink>
          {(tieneModalidad('directa') || tieneModalidad('marketplace')) && (
            <>
              <span className="panel-nav-grupo">{t.nav.grupo_plantel_asistentes}</span>
              <NavLink to="/postulaciones">{t.nav.postulaciones}</NavLink>
              <NavLink to="/solicitudes">{t.nav.solicitudes}</NavLink>
              <NavLink to="/asistentes">{t.nav.asistentes}</NavLink>
              <NavLink to="/documentacion">{t.nav.documentacion}</NavLink>
              <NavLink to="/continuidad">{t.nav.continuidad}</NavLink>
              <NavLink to="/verificacion-guardias">{t.nav.verificacion_guardias}</NavLink>
            </>
          )}
          {tieneModalidad('directa') && (
            <>
              <span className="panel-nav-grupo">{t.nav.grupo_prestacion_directa}</span>
              <NavLink to="/familias">{t.nav.familias}</NavLink>
              <NavLink to="/medicacion">{t.nav.medicacion}</NavLink>
              <NavLink to="/guardias">{t.nav.guardias}</NavLink>
              <NavLink to="/reportes">{t.nav.reportes}</NavLink>
              <NavLink to="/alertas">{t.nav.alertas}</NavLink>
              <NavLink to="/facturacion">{t.nav.facturacion}</NavLink>
              <NavLink to="/lista-precios">{t.nav.lista_precios}</NavLink>
              <NavLink to="/informes-obra-social">{t.nav.informes_obra_social}</NavLink>
            </>
          )}
          {tieneModalidad('marketplace') && (
            <>
              <span className="panel-nav-grupo">{t.nav.grupo_marketplace}</span>
              <NavLink to="/marketplace/familias">{t.nav.marketplace_familias}</NavLink>
              <NavLink to="/marketplace/calificaciones">{t.nav.marketplace_calificaciones}</NavLink>
              <NavLink to="/marketplace/auditoria-legal">{t.nav.marketplace_auditoria_legal}</NavLink>
            </>
          )}
          <NavLink to="/comunicacion">{t.nav.comunicacion}</NavLink>
          {(esAdminOSuperior(usuario?.rol) || puede('importar_datos_masivos')) && (
            <NavLink to="/importacion">{t.nav.importacion}</NavLink>
          )}
          {esAdminOSuperior(usuario?.rol) && <NavLink to="/usuarios-panel">{t.nav.usuarios_panel}</NavLink>}
          {['superadmin'].includes(usuario?.rol) && <NavLink to="/prestadoras">{t.nav.prestadoras}</NavLink>}
          {usuario?.rol === 'superadmin' && <NavLink to="/costos-ia">{t.nav.costos_ia}</NavLink>}
          {esAdminOSuperior(usuario?.rol) && <NavLink to="/configuracion">{t.nav.configuracion}</NavLink>}
          {['admin_prestadora', 'superadmin'].includes(usuario?.rol) && <NavLink to="/auditoria">{t.nav.auditoria}</NavLink>}
        </nav>
      </aside>
      <div className="panel-main">
        <BannerSesionTenant />
        <header className="panel-header">
          <span className="panel-usuario">{usuario?.nombre}</span>
          {/* Idioma, tema y densidad. Están en su propio archivo porque la pantalla de
              muestra del sistema de diseño usa exactamente los mismos tres desplegables. */}
          <SelectoresPreferencias />
          <button className="panel-logout" onClick={logout}>
            {t.nav.cerrar_sesion}
          </button>
        </header>
        <main className="panel-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
