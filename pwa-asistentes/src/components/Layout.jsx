import { useEffect, useState } from 'react';
import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import { iniciarSincronizacionAutomatica } from '../lib/sincronizarCola';
import { useMarca } from '../context/PerfilContext';
import { con } from '../lib/textos';
import { api } from '../lib/api';

export default function Layout() {
  const { logout } = useAuth();
  const { t } = useLocale();
  const marca = useMarca();

  // Cuántas guardias le ofrecieron y todavía no contestó. El número va en la pestaña de abajo
  // porque una oferta con fecha límite que nadie mira es una oferta perdida: si hubiera que
  // entrar a la pantalla para enterarse de que hay algo, la pantalla no serviría de nada.
  //
  // Se pregunta una sola vez, cuando la aplicación arranca. Después lo mantiene al día la
  // propia pantalla de ofertas, que es la única que lo puede cambiar.
  const [ofertasAbiertas, setOfertasAbiertas] = useState(0);

  // Reintento de check-in/reporte guardados sin señal — solo con sesión activa (Fase 9).
  useEffect(() => {
    iniciarSincronizacionAutomatica();
  }, []);

  useEffect(() => {
    let activo = true;
    api
      .ofertas()
      .then(({ ofertas }) => {
        if (activo) setOfertasAbiertas((ofertas ?? []).length);
      })
      .catch(() => {
        // Sin señal o con el motor caído no se muestra ningún número. Un cero inventado sería
        // peor que no decir nada: haría creer que no hay nada esperando.
      });
    return () => {
      activo = false;
    };
  }, []);

  return (
    <div className="app-layout">
      {/* Arriba va la Prestadora, que es para quien el Asistente trabaja. Si cargó su logo
          se muestra el logo; si no, su nombre escrito. Mientras el nombre viaja queda el
          espacio vacío: es preferible a mostrar un nombre que después cambia.
          El nombre no es un encabezado: el único título de la pantalla es el de la pantalla
          que se está mirando, y dos `h1` seguidos dejan a un lector de pantalla sin saber
          cuál de los dos es el título. */}
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
        <Outlet context={{ avisarOfertas: setOfertasAbiertas }} />
        {/* La única mención del producto en toda la aplicación, y al pie. Se apaga si la
            Prestadora tiene contratada esa función (`CLAUDE.md` §7, regla 1). */}
        {marca.mostrarMarcaProducto && <p className="marca-del-producto">{t.marca.con_tecnologia_de}</p>}
      </main>
      {/* La barra de abajo lleva nombre: sin él, un lector de pantalla anuncia tres enlaces
          sueltos en vez de una zona por la que se puede saltar de una vez. */}
      <nav className="app-nav-inferior" aria-label={t.nav.menu_principal}>
        <NavLink to="/guardias" className={({ isActive }) => (isActive ? 'active' : '')}>
          {t.nav.guardias}
        </NavLink>
        <NavLink to="/ofertas" className={({ isActive }) => (isActive ? 'active' : '')}>
          {t.nav.ofertas}
          {/* El número se ve y se entiende por dónde está. Dicho en voz alta, un "3" pegado a
              "Ofrecidas" no dice de qué es, así que el número dibujado no se lee y al lado va
              la frase entera, que no se ve. */}
          {ofertasAbiertas > 0 && (
            <>
              <span className="nav-cuenta" aria-hidden="true">{ofertasAbiertas}</span>
              <span className="solo-lectores-pantalla">
                {ofertasAbiertas === 1
                  ? t.nav.ofertas_sin_contestar_una
                  : con(t.nav.ofertas_sin_contestar, { n: ofertasAbiertas })}
              </span>
            </>
          )}
        </NavLink>
        <NavLink to="/perfil" className={({ isActive }) => (isActive ? 'active' : '')}>
          {t.nav.perfil}
        </NavLink>
      </nav>
    </div>
  );
}
