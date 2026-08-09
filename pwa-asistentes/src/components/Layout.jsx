import { useEffect } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import { iniciarSincronizacionAutomatica } from '../lib/sincronizarCola';
import { useMarca } from '../context/MarcaContext';

export default function Layout() {
  const { logout } = useAuth();
  const { t } = useLocale();
  const marca = useMarca();

  // Reintento de check-in/reporte guardados sin señal — solo con sesión activa (Fase 9).
  useEffect(() => {
    iniciarSincronizacionAutomatica();
  }, []);

  return (
    <div className="app-layout">
      {/* Arriba va la Prestadora, que es para quien el Asistente trabaja. Si cargó su logo
          se muestra el logo; si no, su nombre escrito. Mientras el nombre viaja queda el
          espacio vacío: es preferible a mostrar un nombre que después cambia. */}
      <header className="app-header">
        {marca.logoUrl ? (
          <img className="logo-prestadora" src={marca.logoUrl} alt={marca.nombre || ''} />
        ) : (
          <h1>{marca.nombre || ''}</h1>
        )}
        <button className="btn btn-secondary" onClick={logout} style={{ padding: '0.4rem 1rem', fontSize: '0.8rem' }}>
          {t.nav.cerrar_sesion}
        </button>
      </header>
      <main className="app-content">
        <Outlet />
        {/* La única mención del producto en toda la aplicación, y al pie. Se apaga si la
            Prestadora tiene contratada esa función (`CLAUDE.md` §7, regla 1). */}
        {marca.mostrarMarcaProducto && <p className="marca-del-producto">{t.marca.con_tecnologia_de}</p>}
      </main>
      <nav className="app-nav-inferior">
        <NavLink to="/guardias" className={({ isActive }) => (isActive ? 'active' : '')}>
          {t.nav.guardias}
        </NavLink>
        <NavLink to="/perfil" className={({ isActive }) => (isActive ? 'active' : '')}>
          {t.nav.perfil}
        </NavLink>
      </nav>
    </div>
  );
}
