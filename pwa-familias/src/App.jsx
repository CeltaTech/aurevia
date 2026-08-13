import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PerfilProvider, useSeVe } from './context/PerfilContext';
import { LocaleProvider } from './i18n/LocaleContext';
import { INTERRUPTOR_DE_LA_PANTALLA } from './lib/interruptorDeCadaPantalla';
import Layout from './components/Layout';
import Login from './pages/Login';
import ActivarCuenta from './pages/ActivarCuenta';
import MisPacientes from './pages/MisPacientes';
import PacienteDetalle from './pages/PacienteDetalle';
import Reportes from './pages/Reportes';
import ReporteDetalle from './pages/ReporteDetalle';
import Alertas from './pages/Alertas';
import AsistenteAsignado from './pages/AsistenteAsignado';
import EscanearAsistente from './pages/EscanearAsistente';
import SuscripcionMarketplace from './pages/SuscripcionMarketplace';
import Medicacion from './pages/Medicacion';
import MiPerfil from './pages/MiPerfil';

function RutaPrivada({ children }) {
  const { session, cargando } = useAuth();
  if (cargando) return <div className="pantalla-cargando estado-cargando">Cargando…</div>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

// Una pantalla que la Prestadora apagó no alcanza con sacarla del menú: quien escriba la
// dirección a mano tiene que terminar en el mismo lugar que quien no encuentra el botón.
// Mientras la respuesta del perfil no llegó, `seVe` contesta que sí a todo, así que nadie
// queda expulsado de una pantalla por un dato que todavía está viajando.
function PantallaSegunInterruptor({ pantalla, children }) {
  const seVe = useSeVe();
  if (!seVe(INTERRUPTOR_DE_LA_PANTALLA[pantalla])) return <Navigate to="/pacientes" replace />;
  return children;
}

function Rutas() {
  const { session, cargando } = useAuth();

  return (
    <Routes>
      <Route
        path="/login"
        element={cargando ? <div className="estado-cargando">Cargando…</div> : session ? <Navigate to="/pacientes" replace /> : <Login />}
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
        <Route index element={<Navigate to="/pacientes" replace />} />
        <Route path="pacientes" element={<MisPacientes />} />
        <Route path="pacientes/:id" element={<PacienteDetalle />} />
        <Route path="pacientes/:id/reportes" element={<Reportes />} />
        <Route path="pacientes/:id/reportes/:reporteId" element={<ReporteDetalle />} />
        <Route
          path="pacientes/:id/alertas"
          element={
            <PantallaSegunInterruptor pantalla="alertas">
              <Alertas />
            </PantallaSegunInterruptor>
          }
        />
        <Route path="pacientes/:id/asistente" element={<AsistenteAsignado />} />
        <Route
          path="pacientes/:id/escanear-asistente"
          element={
            <PantallaSegunInterruptor pantalla="escanearAsistente">
              <EscanearAsistente />
            </PantallaSegunInterruptor>
          }
        />
        <Route
          path="pacientes/:id/suscripcion"
          element={
            <PantallaSegunInterruptor pantalla="suscripcion">
              <SuscripcionMarketplace />
            </PantallaSegunInterruptor>
          }
        />
        <Route
          path="pacientes/:id/medicacion"
          element={
            <PantallaSegunInterruptor pantalla="medicacion">
              <Medicacion />
            </PantallaSegunInterruptor>
          }
        />
        <Route path="perfil" element={<MiPerfil />} />
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
