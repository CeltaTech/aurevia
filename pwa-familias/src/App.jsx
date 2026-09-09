import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { PerfilProvider, useSeVe } from './context/PerfilContext';
import { CirculoProvider, useCirculo } from './context/CirculoContext';
import { LocaleProvider, useLocale } from './i18n/LocaleContext';
import { pantallaPermitida } from './lib/interruptorDeCadaPantalla';
import Layout from './components/Layout';
import Login from './pages/Login';
import ActivarCuenta from './pages/ActivarCuenta';
import MisPacientes from './pages/MisPacientes';
import PacienteDetalle from './pages/PacienteDetalle';
import Guardias from './pages/Guardias';
import Reportes from './pages/Reportes';
import ReporteDetalle from './pages/ReporteDetalle';
import Alertas from './pages/Alertas';
import AsistenteAsignado from './pages/AsistenteAsignado';
import EscanearAsistente from './pages/EscanearAsistente';
import SuscripcionMarketplace from './pages/SuscripcionMarketplace';
import Medicacion from './pages/Medicacion';
import MiPerfil from './pages/MiPerfil';
import FirmarInstruccion from './pages/FirmarInstruccion';
import CodigoParaElAsistente from './pages/CodigoParaElAsistente';

function RutaPrivada({ children }) {
  const { session, cargando } = useAuth();
  const { t } = useLocale();
  if (cargando) return <div className="pantalla-cargando estado-cargando">{t.comun.cargando}</div>;
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

// Una pantalla apagada no alcanza con sacarla del menú: quien escriba la dirección a mano
// tiene que terminar en el mismo lugar que quien no encuentra el botón.
//
// Son dos decisiones distintas y las dos tienen que decir que sí: qué ofrece la Prestadora en
// toda su aplicación, y qué instruyó el titular de la cuenta para cada persona de su círculo.
// Una pantalla puede no tener ninguna de las dos, o tener una sola; lo que no está declarado no
// restringe nada, y las dos claves salen del mismo archivo.
//
// Mientras la respuesta del perfil no llegó, las dos preguntas contestan que sí a todo, así que
// nadie queda expulsado de una pantalla por un dato que todavía está viajando.
function PantallaPermitida({ pantalla, children }) {
  const seVe = useSeVe();
  const { puedeVer } = useCirculo();

  if (!pantallaPermitida(pantalla, seVe, puedeVer)) return <Navigate to="/pacientes" replace />;
  return children;
}

function Rutas() {
  const { session, cargando } = useAuth();
  const { t } = useLocale();

  return (
    <Routes>
      <Route
        path="/login"
        element={cargando ? <div className="estado-cargando" role="status">{t.comun.cargando}</div> : session ? <Navigate to="/pacientes" replace /> : <Login />}
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
        {/* La semana de guardias no va detrás de un interruptor de la Prestadora: saber quién
            viene y cuándo es para qué existe la aplicación de la Familia, no una función que una
            Prestadora elija ofrecer o no. El titular sí le puede negar la agenda a alguien de su
            círculo, que es otra decisión y de otro. */}
        <Route
          path="pacientes/:id/guardias"
          element={
            <PantallaPermitida pantalla="guardias">
              <Guardias />
            </PantallaPermitida>
          }
        />
        <Route
          path="pacientes/:id/reportes"
          element={
            <PantallaPermitida pantalla="reportes">
              <Reportes />
            </PantallaPermitida>
          }
        />
        {/* El detalle va detrás del mismo acceso que la lista: sin esto, quien no tiene los
            reportes no ve la lista pero abre uno escribiendo la dirección. */}
        <Route
          path="pacientes/:id/reportes/:reporteId"
          element={
            <PantallaPermitida pantalla="reportes">
              <ReporteDetalle />
            </PantallaPermitida>
          }
        />
        <Route
          path="pacientes/:id/alertas"
          element={
            <PantallaPermitida pantalla="alertas">
              <Alertas />
            </PantallaPermitida>
          }
        />
        <Route path="pacientes/:id/asistente" element={<AsistenteAsignado />} />
        <Route
          path="pacientes/:id/escanear-asistente"
          element={
            <PantallaPermitida pantalla="escanearAsistente">
              <EscanearAsistente />
            </PantallaPermitida>
          }
        />
        <Route
          path="pacientes/:id/suscripcion"
          element={
            <PantallaPermitida pantalla="suscripcion">
              <SuscripcionMarketplace />
            </PantallaPermitida>
          }
        />
        <Route
          path="pacientes/:id/medicacion"
          element={
            <PantallaPermitida pantalla="medicacion">
              <Medicacion />
            </PantallaPermitida>
          }
        />
        {/* El código que se le muestra al Asistente que llega (pendiente #113). No va colgado de
            un Paciente porque el código es del círculo familiar entero, y no lleva guardián
            porque cualquiera del círculo puede ser quien esté en la casa cuando toquen el
            timbre. El motor pide lo mismo: tener sesión de Familia y nada más. */}
        <Route path="codigo" element={<CodigoParaElAsistente />} />
        <Route path="perfil" element={<MiPerfil />} />
        {/* No lleva guardián: quién tiene una instrucción para firmar lo contesta el motor, y
            quien no tiene ninguna ve que no hay ninguna. Adivinarlo acá dejaría al titular
            afuera de su propia pantalla mientras el perfil todavía viaja. */}
        <Route path="instruccion" element={<FirmarInstruccion />} />
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
          <CirculoProvider>
            <BrowserRouter>
              <Rutas />
            </BrowserRouter>
          </CirculoProvider>
        </PerfilProvider>
      </AuthProvider>
    </LocaleProvider>
  );
}
