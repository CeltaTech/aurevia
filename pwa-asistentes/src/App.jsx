import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PerfilProvider, useOfreceMarketplace } from './context/PerfilContext';
import { LocaleProvider, useLocale } from './i18n/LocaleContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import ActivarCuenta from './pages/ActivarCuenta';
import MisGuardias from './pages/MisGuardias';
import OfertasDeGuardia from './pages/OfertasDeGuardia';
import GuardiaActiva from './pages/GuardiaActiva';
import ReporteDiario from './pages/ReporteDiario';
import MiPerfil from './pages/MiPerfil';
import MisCalificaciones from './pages/MisCalificaciones';
import Mensajes from './pages/Mensajes';
import Conversacion from './pages/Conversacion';

function RutaPrivada({ children }) {
  const { session, cargando } = useAuth();
  const { t } = useLocale();
  if (cargando) return <div className="pantalla-cargando estado-cargando">{t.comun.cargando}</div>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

// El chat con las Familias de la vidriera cuelga de la modalidad en la que trabaja la
// Prestadora, no de un interruptor que ella encienda: donde no hay Marketplace no hay con quién
// hablar. El candado de verdad está en el motor, que contesta que no ofrece esa modalidad; esto
// es para que no quede una dirección que lleve a una pantalla de error.
function SoloConMarketplace({ children }) {
  if (!useOfreceMarketplace()) return <Navigate to="/guardias" replace />;
  return children;
}

function Rutas() {
  const { session, cargando } = useAuth();
  const { t } = useLocale();

  return (
    <Routes>
      <Route
        path="/login"
        element={cargando ? <div className="estado-cargando" role="status">{t.comun.cargando}</div> : session ? <Navigate to="/guardias" replace /> : <Login />}
      />
      <Route path="/activar-cuenta" element={<ActivarCuenta />} />
      <Route
        path="/"
        element={
          <RutaPrivada>
            <Layout />
          </RutaPrivada>
        }
      >
        <Route index element={<Navigate to="/guardias" replace />} />
        <Route path="guardias" element={<MisGuardias />} />
        {/* Las guardias que le ofrecieron y todavía no contestó. Es una pantalla aparte de
            "Mis Guardias" a propósito: un turno que le ofrecieron no es un turno suyo. */}
        <Route path="ofertas" element={<OfertasDeGuardia />} />
        <Route path="guardias/:id" element={<GuardiaActiva />} />
        {/* El reporte lleva el Paciente en la dirección: un turno puede cubrir a varias
            personas y cada una tiene su propia hoja (tarea 93h). */}
        <Route path="guardias/:id/reporte/:pacienteId" element={<ReporteDiario />} />
        {/* El chat con una Familia de la vidriera. El hilo lo abre siempre ella: acá se
            contestan los que llegaron. */}
        <Route
          path="mensajes"
          element={
            <SoloConMarketplace>
              <Mensajes />
            </SoloConMarketplace>
          }
        />
        <Route
          path="mensajes/:id"
          element={
            <SoloConMarketplace>
              <Conversacion />
            </SoloConMarketplace>
          }
        />
        <Route path="perfil" element={<MiPerfil />} />
        {/* Las calificaciones que le pusieron y el descargo que puede dejar ante cada una
            (pendiente #85). Cuelga de Mi Perfil y no de la barra de abajo: la barra es para el
            trabajo del día, y esto se mira cada tanto. */}
        <Route path="calificaciones" element={<MisCalificaciones />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <LocaleProvider>
      <AuthProvider>
        <PerfilProvider>
          <BrowserRouter>
            <Rutas />
          </BrowserRouter>
        </PerfilProvider>
      </AuthProvider>
    </LocaleProvider>
  );
}
