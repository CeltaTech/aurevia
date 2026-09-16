import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LocaleProvider } from './i18n/LocaleContext';
import { PreferenciasVistaProvider } from './context/PreferenciasVistaContext';
import { AuthProvider } from './context/AuthContext';
import { EmpresaProvider } from './context/EmpresaContext';
import { UmbralesProvider } from './context/UmbralesContext';
import { PermisosProvider } from './context/PermisosContext';
import { ModalidadesProvider } from './context/ModalidadesContext';
import { TenantSessionProvider } from './context/TenantSessionContext';
import { AdvertenciaLegalProvider } from './context/AdvertenciaLegalContext';
import { PedidosDeCodigoProvider } from './context/PedidosDeCodigoContext';
import { PuestaEnMarchaProvider, usePuestaEnMarcha } from './context/PuestaEnMarchaContext';
import { RUTA_PUESTA_EN_MARCHA } from './components/layout/FranjaPuestaEnMarcha';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { ROLES_ADMINISTRACION, ROLES_PANEL } from './lib/roles';
import { MODALIDAD } from './lib/modalidades';
import { Layout } from './components/layout/Layout';
import { Login } from './pages/Login';
import { Mfa } from './pages/Mfa';
import { EntrevistaPublica } from './pages/EntrevistaPublica';
import { ActivarCuenta } from './pages/ActivarCuenta';
import { Muestra } from './pages/Muestra';
import { MuestraEstadoActual } from './pages/MuestraEstadoActual';
import { Dashboard } from './pages/Dashboard';
import { EstadoActual } from './pages/EstadoActual';
import { PuestaEnMarcha } from './pages/PuestaEnMarcha';
import { Postulaciones } from './pages/Postulaciones';
import { Solicitudes } from './pages/Solicitudes';
import { Asistentes } from './pages/Asistentes';
import { AsistenteDetalle } from './pages/asistentes/AsistenteDetalle';
import { Familias } from './pages/Familias';
import { FamiliaDetalle } from './pages/familias/FamiliaDetalle';
import { Servicios } from './pages/Servicios';
import { ServicioDetalle } from './pages/servicios/ServicioDetalle';
import { Guardias } from './pages/Guardias';
import { Reportes } from './pages/Reportes';
import { Alertas } from './pages/Alertas';
import { EmergenciasEnGuardia } from './pages/EmergenciasEnGuardia';
import { Comunicacion } from './pages/Comunicacion';
import { Evv } from './pages/Evv';
import { PaseDeGuardia } from './pages/PaseDeGuardia';
import { Facturacion } from './pages/Facturacion';
import { PagosAsistentes } from './pages/PagosAsistentes';
import { Documentacion } from './pages/Documentacion';
import { Continuidad } from './pages/Continuidad';
import { ListaPrecios } from './pages/ListaPrecios';
import { UsuariosPanel } from './pages/UsuariosPanel';
import { Prestadoras } from './pages/Prestadoras';
import { Configuracion } from './pages/Configuracion';
import { ConfiguracionPrestadora } from './pages/configuracion/LaPrestadora';
import { ConfiguracionAsistentes } from './pages/configuracion/Asistentes';
import { ConfiguracionCuidado } from './pages/configuracion/ElCuidado';
import { ConfiguracionAvisos } from './pages/configuracion/Avisos';
import { ConfiguracionAplicaciones } from './pages/configuracion/LasAplicaciones';
import { ConfiguracionAccesos } from './pages/configuracion/Accesos';
import { Medicacion } from './pages/Medicacion';
import { Importacion } from './pages/Importacion';
import { InformesObraSocial } from './pages/InformesObraSocial';
import { Auditoria } from './pages/Auditoria';
import { ContenidoParaFamilias } from './pages/contenidos/ContenidoParaFamilias';
import { MarketplaceFamilias } from './pages/marketplace/Familias';
import { FormasDeCobro } from './pages/marketplace/FormasDeCobro';
import { MarketplaceCalificaciones } from './pages/marketplace/Calificaciones';
import { MarketplaceAuditoriaLegal } from './pages/marketplace/AuditoriaLegal';

/* Con qué pantalla abre el Panel.
   ==========================================================================

   Casi siempre con el Estado actual, que es lo que hay que resolver hoy. La excepción dura lo
   que dure la puesta en marcha: mientras a la Prestadora le falte cargar algo de lo suyo, entrar
   la deja donde puede completarlo, y no frente a una grilla de guardias vacía que todavía no le
   dice nada. Resuelto el último paso, esto deja de desviar y la entrada vuelve a ser la de
   siempre, sin que nadie apague nada.

   Se espera a saber: mientras el contexto todavía está preguntando contesta que no falta nada
   —el sentido seguro—, así que desviar con esa respuesta provisoria sería desviar a todos. */
function EntradaDelPanel() {
  const { estado, completos } = usePuestaEnMarcha();
  if (estado === 'listo' && !completos) return <Navigate to={RUTA_PUESTA_EN_MARCHA} replace />;
  return <EstadoActual />;
}

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
            {/* Va adentro de la sesión de soporte porque los pedidos que trae son los de la
                Prestadora que se está mirando ahora, y esa la decide esa sesión. Y va afuera del
                enrutador porque el menú lo consulta desde cualquier pantalla: un Asistente parado
                en una puerta tiene que aparecer aunque nadie esté mirando la lista. */}
            <PedidosDeCodigoProvider>
            {/* Los umbrales del semáforo de guardia. Van acá por el mismo motivo que los pedidos:
                son los de la Prestadora que se está mirando ahora, y esa la decide la sesión de
                soporte. */}
            <UmbralesProvider>
            {/* Qué le falta cargar a la Prestadora para poder trabajar. Va acá por el mismo
                motivo que los dos de arriba: es de la Prestadora que se está mirando ahora, y
                esa la decide la sesión de soporte. Y afuera del enrutador porque lo consultan
                tres cosas a la vez — la entrada, la franja del menú y la propia guía. */}
            <PuestaEnMarchaProvider>
            <AdvertenciaLegalProvider>
              <BrowserRouter>
                <Routes>
                  <Route path="/login" element={<Login />} />
                  <Route path="/mfa" element={<Mfa />} />
                  {/* La entrevista del postulante. Va acá afuera, con la entrada y el segundo
                      factor, porque quien la abre no tiene ninguna cuenta con la que entrar: trae
                      la llave que le llegó por correo, y esa llave es toda su credencial. */}
                  <Route path="/entrevista/:llave" element={<EntrevistaPublica />} />
                  {/* Donde el administrador de una Prestadora recién dada de alta elige su
                      contraseña. Va acá afuera por lo mismo: la llave le llegó por correo y
                      todavía no tiene ninguna cuenta con la que entrar. */}
                  <Route path="/activar-cuenta" element={<ActivarCuenta />} />
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
                    <Route index element={<EntradaDelPanel />} />
                    {/* Donde la Prestadora nueva completa lo que le falta. Tiene dirección propia
                        —y no es sólo un pedazo del Estado actual— porque es a donde lleva la
                        entrada mientras quede algo sin cargar, y a donde vuelve la franja desde
                        cualquier pantalla. Completado todo, se vacía y devuelve a la entrada. */}
                    <Route path="puesta-en-marcha" element={<PuestaEnMarcha />} />
                    <Route path="resumen-del-mes" element={<Dashboard />} />
                    <Route path="postulaciones" element={<Postulaciones />} />
                    <Route path="solicitudes" element={<Solicitudes />} />
                    <Route path="asistentes" element={<Asistentes />} />
                    <Route path="asistentes/:id" element={<AsistenteDetalle />} />
                    <Route path="familias" element={<Familias />} />
                    <Route path="familias/:id" element={<FamiliaDetalle />} />
                    <Route path="servicios" element={<Servicios />} />
                    {/* La biblioteca que la Prestadora escribe para quien cuida en su casa. Sin
                        candado de modalidad: una Familia de prestación directa cuida en su casa
                        igual que una de marketplace. Verla la ve cualquiera del Panel —un
                        borrador hay que poder revisarlo—; escribirla es un permiso, y quien lo
                        niega de verdad es el motor. */}
                    <Route path="contenidos" element={<ContenidoParaFamilias />} />
                    <Route path="servicios/:id" element={<ServicioDetalle />} />
                    <Route path="medicacion" element={<Medicacion />} />
                    <Route path="guardias" element={<Guardias />} />
                    <Route path="reportes" element={<Reportes />} />
                    <Route path="alertas" element={<Alertas />} />
                    {/* Lo que un Asistente avisó apretando el botón de emergencia de su guardia.
                        Sin candado propio, igual que sus vecinas de Cumplimiento: quien está de
                        turno cuando entra una es el Coordinador, y el motor pide lo mismo. */}
                    <Route path="emergencias" element={<EmergenciasEnGuardia />} />
                    <Route path="comunicacion" element={<Comunicacion />} />
                    {/* El pase de guardia (pendiente #113) va al lado de la verificación de
                        guardias y no adentro: aquélla audita hacia atrás con un rango de fechas,
                        ésta se atiende ahora. Sin candado propio, igual que sus vecinas de
                        Cumplimiento: quien está de turno cuando entra un pedido es el
                        Coordinador, y el motor pide exactamente lo mismo. */}
                    <Route path="pase-de-guardia" element={<PaseDeGuardia />} />
                    <Route path="verificacion-guardias" element={<Evv />} />
                    <Route path="facturacion" element={<Facturacion />} />
                    {/* Lo que se le paga al Asistente es dato sensible (CLAUDE.md §6), así que
                        además de estar en el menú tiene candado propio en la dirección: sin el
                        permiso no se entra ni escribiéndola a mano. */}
                    <Route
                      path="pagos-asistentes"
                      element={<ProtectedRoute permiso="ver_pagos_asistente"><PagosAsistentes /></ProtectedRoute>}
                    />
                    <Route path="documentacion" element={<Documentacion />} />
                    <Route path="continuidad" element={<Continuidad />} />
                    <Route path="lista-precios" element={<ListaPrecios />} />
                    <Route path="importacion" element={<Importacion />} />
                    <Route path="informes-obra-social" element={<InformesObraSocial />} />
                    <Route path="usuarios-panel" element={<ProtectedRoute soloAdmin><UsuariosPanel /></ProtectedRoute>} />
                    <Route path="prestadoras" element={<ProtectedRoute roles={['superadmin']}><Prestadoras /></ProtectedRoute>} />
                    {/* Configuración dejó de ser una pantalla sola con trece solapas: son
                        secciones, cada una con su propia dirección, para poder entrar derecho a
                        la que uno busca y guardarse el enlace. El candado de administrador está
                        una sola vez, arriba: todas cuelgan de él. */}
                    <Route path="configuracion" element={<ProtectedRoute soloAdmin><Configuracion /></ProtectedRoute>}>
                      <Route index element={<Navigate to="prestadora" replace />} />
                      <Route path="prestadora" element={<ConfiguracionPrestadora />} />
                      <Route path="asistentes" element={<ConfiguracionAsistentes />} />
                      <Route path="cuidado" element={<ConfiguracionCuidado />} />
                      <Route path="avisos" element={<ConfiguracionAvisos />} />
                      <Route path="aplicaciones" element={<ConfiguracionAplicaciones />} />
                      <Route path="accesos" element={<ConfiguracionAccesos />} />
                    </Route>
                    <Route path="auditoria" element={<ProtectedRoute roles={ROLES_ADMINISTRACION}><Auditoria /></ProtectedRoute>} />
                    {/* Las pantallas del Marketplace llevan dos candados y no uno: el rol,
                        que dice quién de la Prestadora entra, y la modalidad, que dice si esa
                        Prestadora tiene Marketplace. Hasta ahora sólo tenían el primero, así que
                        una Prestadora de prestación directa entraba escribiendo la dirección a
                        mano. El de acá es para no mostrar lo que no corresponde; el que niega de
                        verdad es el del motor (backend/src/middleware/exigirModalidad.js). */}
                    <Route
                      path="marketplace/familias"
                      element={
                        /* La pantalla de Familias del Marketplace es la de la plata: importes de
                           suscripción, historial de cobros, carga de efectivo en mano y canje del
                           QR. Va con el mismo candado que Configuración y Auditoría, no con el de
                           las pantallas operativas (Desarrollador, 2026-09-04). */
                        <ProtectedRoute roles={ROLES_ADMINISTRACION} modalidad={MODALIDAD.MARKETPLACE}>
                          <MarketplaceFamilias />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="marketplace/formas-de-cobro"
                      element={
                        /* Con qué números cobra la Prestadora. Mismo candado que la pantalla de
                           la plata: es configuración de dinero, no operación. El Superadmin entra
                           y mira, para poder dar soporte, pero no cambia nada: eso lo niega el
                           motor, que es donde el permiso niega de verdad. */
                        <ProtectedRoute roles={ROLES_ADMINISTRACION} modalidad={MODALIDAD.MARKETPLACE}>
                          <FormasDeCobro />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="marketplace/calificaciones"
                      element={
                        <ProtectedRoute roles={ROLES_PANEL} modalidad={MODALIDAD.MARKETPLACE}>
                          <MarketplaceCalificaciones />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="marketplace/auditoria-legal"
                      element={
                        <ProtectedRoute roles={ROLES_PANEL} modalidad={MODALIDAD.MARKETPLACE}>
                          <MarketplaceAuditoriaLegal />
                        </ProtectedRoute>
                      }
                    />
                  </Route>
                </Routes>
              </BrowserRouter>
            </AdvertenciaLegalProvider>
            </PuestaEnMarchaProvider>
            </UmbralesProvider>
            </PedidosDeCodigoProvider>
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
