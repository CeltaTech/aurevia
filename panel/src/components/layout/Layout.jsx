import { NavLink, Outlet } from 'react-router-dom';
import { Fragment, useState } from 'react';
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

  const esAdmin = esAdminOSuperior(usuario?.rol);
  const esSuperadmin = usuario?.rol === 'superadmin';
  const directa = tieneModalidad('directa');
  const marketplace = tieneModalidad('marketplace');
  // Las pantallas del plantel valen igual con las dos modalidades: en las dos hay
  // Asistentes que se incorporan, tienen documentación y cubren guardias.
  const hayPlantel = directa || marketplace;

  /* El menú, como lista de datos y no como JSX suelto. El candado de cada enlace
     (`ver`) está escrito una sola vez, al lado del enlace, en vez de repetido
     alrededor de bloques enteros de JSX.

     El grupo "Marketplace" desapareció a propósito: el marketplace es un canal de
     venta, no un lugar del sistema. Sus pantallas se fueron a donde corresponde
     por tema, cada una conservando su candado. Lo mismo vale para la modalidad de
     subcontratación: tampoco es un lugar del menú.

     Los cuatro grupos del medio siguen el orden del negocio y, sobre todo, el
     orden en que el operador se pregunta las cosas (pendiente #116): a quién le
     vendemos (Clientes), quién lo cubre (Cobertura), si de verdad está pasando
     (Cumplimiento) y con qué gente contamos (Plantel). Antes estaban agrupados
     por cómo se fue construyendo el sistema: "Personas" juntaba a Familias con
     Asistentes, que son los dos extremos opuestos, y "Cuidado" era el cajón donde
     habían caído reportes, alertas y medicación sin contestar ninguna pregunta.

     Dos pantallas que suenan parecido y van a grupos distintos a propósito: las
     Solicitudes de Servicio las manda quien quiere contratar, así que son de
     "Clientes"; las Postulaciones las manda quien quiere trabajar, así que son
     de "Plantel".

     El Servicio va en "Clientes" y no en "Cobertura" porque es lo que la
     Prestadora vende, no la forma de cubrirlo: de él cuelgan las prestaciones y
     de algunas de ellas las Guardias (`docs/QUE_ES_UN_SERVICIO.md`). */
  const grupos = [
    {
      titulo: t.nav.grupo_clientes,
      enlaces: [
        { a: '/familias', texto: t.nav.familias, ver: directa },
        { a: '/marketplace/familias', texto: t.nav.marketplace_familias, ver: marketplace },
        { a: '/servicios', texto: t.nav.servicios, ver: true },
        { a: '/solicitudes', texto: t.nav.solicitudes, ver: hayPlantel },
      ],
    },
    {
      titulo: t.nav.grupo_cobertura,
      enlaces: [
        { a: '/guardias', texto: t.nav.guardias, ver: directa },
        { a: '/continuidad', texto: t.nav.continuidad, ver: hayPlantel },
      ],
    },
    {
      titulo: t.nav.grupo_cumplimiento,
      enlaces: [
        { a: '/verificacion-guardias', texto: t.nav.verificacion_guardias, ver: hayPlantel },
        { a: '/reportes', texto: t.nav.reportes, ver: directa },
        { a: '/medicacion', texto: t.nav.medicacion, ver: directa },
        { a: '/alertas', texto: t.nav.alertas, ver: directa },
      ],
    },
    {
      titulo: t.nav.grupo_plantel,
      enlaces: [
        { a: '/asistentes', texto: t.nav.asistentes, ver: hayPlantel },
        { a: '/documentacion', texto: t.nav.documentacion, ver: hayPlantel },
        { a: '/postulaciones', texto: t.nav.postulaciones, ver: hayPlantel },
        { a: '/marketplace/calificaciones', texto: t.nav.marketplace_calificaciones, ver: marketplace },
      ],
    },
    {
      titulo: t.nav.grupo_dinero,
      enlaces: [
        // Primero las tres de lo que se le COBRA a la Familia, y al final la de lo que se
        // le PAGA al Asistente, que es la otra mitad del dinero y hasta ahora no existía
        // (pendiente #116). Va con candado propio porque una remuneración es dato sensible
        // (CLAUDE.md §6): el Admin la ve siempre, el Coordinador solo si su Prestadora se
        // lo habilitó en Configuración > Accesos.
        { a: '/facturacion', texto: t.nav.facturacion, ver: directa },
        { a: '/lista-precios', texto: t.nav.lista_precios, ver: directa },
        { a: '/informes-obra-social', texto: t.nav.informes_obra_social, ver: directa },
        { a: '/pagos-asistentes', texto: t.nav.pagos_asistentes, ver: hayPlantel && (esAdmin || puede('ver_pagos_asistente')) },
      ],
    },
    {
      titulo: t.nav.grupo_ajustes,
      enlaces: [
        { a: '/configuracion', texto: t.nav.configuracion, ver: esAdmin },
        { a: '/usuarios-panel', texto: t.nav.usuarios_panel, ver: esAdmin },
        { a: '/auditoria', texto: t.nav.auditoria, ver: ['admin_prestadora', 'superadmin'].includes(usuario?.rol) },
        { a: '/marketplace/auditoria-legal', texto: t.nav.marketplace_auditoria_legal, ver: marketplace },
        { a: '/importacion', texto: t.nav.importacion, ver: esAdmin || puede('importar_datos_masivos') },
        { a: '/prestadoras', texto: t.nav.prestadoras, ver: esSuperadmin },
        { a: '/costos-ia', texto: t.nav.costos_ia, ver: esSuperadmin },
      ],
    },
  ];

  return (
    <div className="panel-layout">
      <aside className="panel-sidebar">
        <div className="panel-logo">{empresa?.nombre ?? ''}</div>
        <nav>
          {/* Arriba de todo, sin grupo: el Estado actual es el punto de partida del día, el
              resumen del mes queda justo debajo para el que quiera el número grande, y la
              bandeja de conversaciones sube acá porque se abre a cada rato y desde cualquier
              parte. Tenía un grupo entero para ella sola, que no agrupaba nada. */}
          <NavLink to="/" end>
            {t.nav.estado_actual}
          </NavLink>
          <NavLink to="/resumen-del-mes">{t.nav.resumen_del_mes}</NavLink>
          <NavLink to="/comunicacion">{t.nav.comunicacion}</NavLink>
          {/* Un grupo que se quedó sin ningún enlace visible no muestra su título: nadie
              tiene que leer un encabezado que no lleva a ninguna parte. */}
          {grupos.map((grupo) => {
            const visibles = grupo.enlaces.filter((enlace) => enlace.ver);
            if (visibles.length === 0) return null;
            return (
              <Fragment key={grupo.titulo}>
                <span className="panel-nav-grupo">{grupo.titulo}</span>
                {visibles.map((enlace) => (
                  <NavLink key={enlace.a} to={enlace.a}>{enlace.texto}</NavLink>
                ))}
              </Fragment>
            );
          })}
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
