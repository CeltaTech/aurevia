import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import { useMarca } from '../context/PerfilContext';

export default function Layout() {
  const { logout } = useAuth();
  const { t } = useLocale();
  const marca = useMarca();

  return (
    <div className="app-layout">
      {/* Arriba va la Prestadora, que es a quien la Familia llamó. Si cargó su logo se
          muestra el logo; si no, su nombre escrito. Mientras el nombre viaja queda el
          espacio vacío: es preferible a mostrar un nombre que después cambia.
          El nombre no va como `h1`: el `h1` es el título de la pantalla que se está mirando,
          y hay uno solo por pantalla. */}
      <header className="app-header">
        {marca.logoUrl ? (
          <img className="logo-prestadora" src={marca.logoUrl} alt={marca.nombre || ''} />
        ) : (
          <p className="nombre-prestadora">{marca.nombre || ''}</p>
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
      {/* La zona de navegación lleva nombre: sin él, un lector de pantalla anuncia "navegación"
          a secas, y si mañana hay dos zonas de navegación en la misma pantalla no hay forma de
          distinguirlas. */}
      <nav className="app-nav-inferior" aria-label={t.nav.menu_principal}>
        <NavLink to="/pacientes" className={({ isActive }) => (isActive ? 'active' : '')}>
          {t.nav.pacientes}
        </NavLink>
        <NavLink to="/perfil" className={({ isActive }) => (isActive ? 'active' : '')}>
          {t.nav.perfil}
        </NavLink>
      </nav>
    </div>
  );
}
