import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LocaleProvider } from './i18n/LocaleContext';
import { PreferenciasVistaProvider } from './context/PreferenciasVistaContext';
import { AuthProvider } from './context/AuthContext';
import { EmpresaProvider } from './context/EmpresaContext';
import { PermisosProvider } from './context/PermisosContext';
import { ModalidadesProvider } from './context/ModalidadesContext';
import { TenantSessionProvider } from './context/TenantSessionContext';
import { AdvertenciaLegalProvider } from './context/AdvertenciaLegalContext';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { Layout } from './components/layout/Layout';
import { Login } from './pages/Login';
import { Mfa } from './pages/Mfa';
import { Muestra } from './pages/Muestra';
import { MuestraEstadoActual } from './pages/MuestraEstadoActual';
import { Dashboard } from './pages/Dashboard';
import { EstadoActual } from './pages/EstadoActual';
import { Postulaciones } from './pages/Postulaciones';
import { Solicitudes } from './pages/Solicitudes';
import { Asistentes } from './pages/Asistentes';
import { AsistenteDetalle } from './pages/asistentes/AsistenteDetalle';
import { Familias } from './pages/Familias';
import { FamiliaDetalle } from './pages/familias/FamiliaDetalle';
import { Guardias } from './pages/Guardias';
import { Reportes } from './pages/Reportes';
import { Alertas } from './pages/Alertas';
import { Comunicacion } from './pages/Comunicacion';
import { Evv } from './pages/Evv';
import { Facturacion } from './pages/Facturacion';
import { Documentacion } from './pages/Documentacion';
import { Continuidad } from './pages/Continuidad';
import { ListaPrecios } from './pages/ListaPrecios';
import { UsuariosPanel } from './pages/UsuariosPanel';
import { Prestadoras } from './pages/Prestadoras';
import { CostosIA } from './pages/CostosIA';
import { Configuracion } from './pages/Configuracion';
import { ConfiguracionPrestadora } from './pages/configuracion/LaPrestadora';
import { ConfiguracionAsistentes } from './pages/configuracion/Asistentes';
import { ConfiguracionCuidado } from './pages/configuracion/ElCuidado';
import { ConfiguracionAvisos } from './pages/configuracion/Avisos';
import { ConfiguracionAccesos } from './pages/configuracion/Accesos';
import { Medicacion } from './pages/Medicacion';
import { Importacion } from './pages/Importacion';
import { InformesObraSocial } from './pages/InformesObraSocial';
import { Auditoria } from './pages/Auditoria';
import { MarketplaceFamilias } from './pages/marketplace/Familias';
import { MarketplaceCalificaciones } from './pages/marketplace/Calificaciones';
import { MarketplaceAuditoriaLegal } from './pages/marketplace/AuditoriaLegal';

function App() {
  return (
    <LocaleProvider>
      {/* El tema y la densidad van bien afuera, envolviendo todo: valen también para la
          pantalla de ingreso, que está fuera del Layout. */}
      <PreferenciasVistaProvider>
      <EmpresaProvider>
        <AuthProvider>
          <PermisosProvider>
          <ModalidadesProvider>
          <TenantSessionProvider>
            <AdvertenciaLegalProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/mfa" element={<Mfa />} />
                  {/* La muestra del sistema de diseño existe SOLO mientras se desarrolla.
                      `import.meta.env.DEV` es falso al compilar para publicar, el
                      compilador borra esta línea y la pantalla no llega al servidor: no es
                      un interruptor que alguien pueda dejar mal puesto. No pide contraseña
                      porque no consulta la base — ver el encabezado de `pages/Muestra.jsx`. */}
                  {import.meta.env.DEV ? <Route path="/muestra" element={<Muestra />} /> : null}
                  {import.meta.env.DEV ? (
                    <Route path="/muestra-estado-actual" element={<MuestraEstadoActual />} />
                  ) : null}
                  <Route
                    path="/"
                    element={
                      <ProtectedRoute>
                        <Layout />
                      </ProtectedRoute>
                    }
                  >
                    {/* La pantalla de entrada es el Estado actual: lo primero que se ve al abrir el
                        Panel es lo que hay que resolver hoy, no el resumen del mes. El resumen
                        no se borró —sigue entero en su propia dirección—, solo dejó de ser lo
                        primero, porque nadie empieza el día leyendo un promedio. */}
                    <Route index element={<EstadoActual />} />
                    <Route path="resumen-del-mes" element={<Dashboard />} />
                    <Route path="postulaciones" element={<Postulaciones />} />
                    <Route path="solicitudes" element={<Solicitudes />} />
                    <Route path="asistentes" element={<Asistentes />} />
                    <Route path="asistentes/:id" element={<AsistenteDetalle />} />
                    <Route path="familias" element={<Familias />} />
                    <Route path="familias/:id" element={<FamiliaDetalle />} />
                    <Route path="medicacion" element={<Medicacion />} />
                    <Route path="guardias" element={<Guardias />} />
                    <Route path="reportes" element={<Reportes />} />
                    <Route path="alertas" element={<Alertas />} />
                    <Route path="comunicacion" element={<Comunicacion />} />
                    <Route path="verificacion-guardias" element={<Evv />} />
                    <Route path="facturacion" element={<Facturacion />} />
                    <Route path="documentacion" element={<Documentacion />} />
                    <Route path="continuidad" element={<Continuidad />} />
                    <Route path="lista-precios" element={<ListaPrecios />} />
                    <Route path="importacion" element={<Importacion />} />
                    <Route path="informes-obra-social" element={<InformesObraSocial />} />
                    <Route path="usuarios-panel" element={<ProtectedRoute soloAdmin><UsuariosPanel /></ProtectedRoute>} />
                    <Route path="prestadoras" element={<ProtectedRoute roles={['superadmin']}><Prestadoras /></ProtectedRoute>} />
                    <Route path="costos-ia" element={<ProtectedRoute roles={['superadmin']}><CostosIA /></ProtectedRoute>} />
                    {/* Configuración dejó de ser una pantalla sola con trece solapas: son cinco
                        secciones, cada una con su propia dirección, para poder entrar derecho a
                        la que uno busca y guardarse el enlace. El candado de administrador está
                        una sola vez, arriba: las cinco cuelgan de él. */}
                    <Route path="configuracion" element={<ProtectedRoute soloAdmin><Configuracion /></ProtectedRoute>}>
                      <Route index element={<Navigate to="prestadora" replace />} />
                      <Route path="prestadora" element={<ConfiguracionPrestadora />} />
                      <Route path="asistentes" element={<ConfiguracionAsistentes />} />
                      <Route path="cuidado" element={<ConfiguracionCuidado />} />
                      <Route path="avisos" element={<ConfiguracionAvisos />} />
                      <Route path="accesos" element={<ConfiguracionAccesos />} />
                    </Route>
                    <Route path="auditoria" element={<ProtectedRoute roles={['admin_prestadora', 'superadmin']}><Auditoria /></ProtectedRoute>} />
                    <Route
                      path="marketplace/familias"
                      element={
                        <ProtectedRoute roles={['admin_prestadora', 'coordinador', 'superadmin']}>
                          <MarketplaceFamilias />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="marketplace/calificaciones"
                      element={
                        <ProtectedRoute roles={['admin_prestadora', 'coordinador', 'superadmin']}>
                          <MarketplaceCalificaciones />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="marketplace/auditoria-legal"
                      element={
                        <ProtectedRoute roles={['admin_prestadora', 'coordinador', 'superadmin']}>
                          <MarketplaceAuditoriaLegal />
                        </ProtectedRoute>
                      }
                    />
                  </Route>
                </Routes>
              </BrowserRouter>
            </AdvertenciaLegalProvider>
          </TenantSessionProvider>
          </ModalidadesProvider>
          </PermisosProvider>
        </AuthProvider>
      </EmpresaProvider>
      </PreferenciasVistaProvider>
    </LocaleProvider>
  );
}

export default App;
