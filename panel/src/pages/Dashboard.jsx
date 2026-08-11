import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { useTenantSession } from '../context/TenantSessionContext';
import { useModalidades } from '../context/ModalidadesContext';
import { esAdminOSuperior } from '../lib/roles';
import { useSupabaseTable } from '../hooks/useSupabaseTable';
import { EstadoLista } from '../components/layout/EstadoLista';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { supabase } from '../lib/supabaseClient';
import { mensajeDeError } from '../lib/errores';
import { fechaLimiteDeAviso } from '../lib/reglaVencimientos';
import { diasDeAvisoDeLaPrestadora } from '../lib/plazoDeAviso';

const API_URL = import.meta.env.VITE_API_URL;

// Reutiliza el mismo endpoint que ya usa UsuariosPanel.jsx (backend/src/routes/panelUsuarios.js)
// en vez de crear una ruta nueva solo para contar — es la única fuente de verdad de "quién es
// parte del equipo de esta Prestadora" (Regla 12).
async function obtenerUsuariosEquipo() {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/usuarios`, {
    headers: { Authorization: `Bearer ${data.session?.access_token}` },
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.error);
  return resultado.usuarios;
}

// Los nombres de las modalidades salen de un solo lado: los mismos textos que usa la
// solapa donde se activan y se desactivan, en Configuración → La Prestadora (Regla 12).
// Antes se tomaban prestados dos títulos del menú, que solo servían mientras el menú
// estuvo agrupado por modalidad; desde que se agrupa por lo que uno viene a hacer, ese
// préstamo dejó de tener sentido.
const NOMBRE_MODALIDAD = {
  directa: (t) => t.configuracion.modalidades_directa,
  marketplace: (t) => t.configuracion.modalidades_marketplace,
  subcontratacion: (t) => t.configuracion.modalidades_subcontratacion,
};

function esHoy(fechaIso) {
  const hoy = new Date();
  const fecha = new Date(fechaIso);
  return (
    fecha.getFullYear() === hoy.getFullYear() &&
    fecha.getMonth() === hoy.getMonth() &&
    fecha.getDate() === hoy.getDate()
  );
}

function esEstaSemana(fechaIso) {
  const fecha = new Date(fechaIso);
  const ahora = new Date();
  const inicioSemana = new Date(ahora);
  inicioSemana.setDate(ahora.getDate() - ahora.getDay());
  inicioSemana.setHours(0, 0, 0, 0);
  return fecha >= inicioSemana;
}

export function Dashboard() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const { sesion } = useTenantSession();
  const { tieneModalidad, modalidades, cargado: modalidadesCargadas } = useModalidades();
  const desgloseModalidadHabilitado = modalidades.length > 1;
  const esAdmin = esAdminOSuperior(usuario?.rol);
  // Sin Prestadora propia y sin sesión de soporte abierta no se está "dentro" de ninguna
  // Prestadora — no hay contexto de configuración inicial que mostrar (mismo criterio que
  // panelUsuarios.js). Admin_prestadora siempre tiene la suya, y superadmin normalmente la
  // Sandbox.
  const mostrarOnboarding = esAdmin && (Boolean(usuario?.prestadora_id) || sesion !== null);
  // Entrando por una sesión de soporte técnico, la configuración inicial es de la Prestadora
  // visitada, no de quien mira: se muestra solo para informar, sin invitar a completarla.
  const onboardingInformativo = sesion !== null;
  const postulaciones = useSupabaseTable('postulaciones');
  const solicitudes = useSupabaseTable('solicitudes');
  // Coordinador consulta la vista sin vínculo laboral/score de riesgo — ver schema_etapa2i.sql.
  const asistentes = useSupabaseTable(esAdmin ? 'asistentes' : 'asistentes_coordinador', { orderBy: 'created_at' });
  const familias = useSupabaseTable('familias', { orderBy: 'created_at' });
  const [ausentesSinRelevo, setAusentesSinRelevo] = useState(null);
  const [ausentesPorModalidad, setAusentesPorModalidad] = useState(null);
  const [documentosPorVencer, setDocumentosPorVencer] = useState(null);
  const [errorAlertas, setErrorAlertas] = useState(null);

  const cargarAlertas = useCallback(async () => {
    if (!usuario?.prestadora_id) return;
    setAusentesSinRelevo(null);
    setAusentesPorModalidad(null);
    setDocumentosPorVencer(null);
    setErrorAlertas(null);

    // Trae el canal (guardias.canal_modalidad) de cada incidente para poder desglosar por
    // modalidad cuando la Prestadora tiene más de una activa (pendiente #85 ítem 3) sin
    // repetir la consulta — un solo punto de verdad para el conteo total y el desglose.
    const { data: filasAusentes, error: errorAusentes } = await supabase
      .from('incidentes_relevo')
      .select('guardias!incidentes_relevo_entrante_tenant_fk(canal_modalidad)')
      .is('resuelto_at', null)
      .is('guardia_saliente_id', null);

    // El plazo de aviso y hasta qué día hay que mirar salen del mismo lugar que en el Estado
    // actual y en Documentación, así que los tres contadores dicen lo mismo (regla 12).
    const diasAviso = await diasDeAvisoDeLaPrestadora(usuario.prestadora_id);
    const { count: countDocumentos, error: errorDocumentos } = await supabase
      .from('documentos_asistente')
      .select('id', { count: 'exact', head: true })
      .not('fecha_vencimiento', 'is', null)
      .lte('fecha_vencimiento', fechaLimiteDeAviso(diasAviso));

    if (errorAusentes || errorDocumentos) {
      setErrorAlertas(t.comun.error_generico);
      return;
    }
    const porModalidad = { directa: 0, marketplace: 0, subcontratacion: 0 };
    for (const fila of filasAusentes ?? []) {
      const canal = fila.guardias?.canal_modalidad;
      if (canal && canal in porModalidad) porModalidad[canal] += 1;
    }
    setAusentesSinRelevo(filasAusentes?.length ?? 0);
    setAusentesPorModalidad(porModalidad);
    setDocumentosPorVencer(countDocumentos ?? 0);
  }, [usuario?.prestadora_id, t]);

  useEffect(() => {
    cargarAlertas();
  }, [cargarAlertas]);

  const [equipoEstado, setEquipoEstado] = useState('cargando');
  const [equipoTieneCoordinador, setEquipoTieneCoordinador] = useState(false);
  const [errorEquipo, setErrorEquipo] = useState(null);

  const cargarEquipo = useCallback(async () => {
    if (!mostrarOnboarding) return;
    setEquipoEstado('cargando');
    setErrorEquipo(null);
    try {
      const usuariosEquipo = await obtenerUsuariosEquipo();
      setEquipoTieneCoordinador(usuariosEquipo.some((u) => u.rol === 'coordinador'));
      setEquipoEstado('listo');
    } catch (err) {
      setErrorEquipo(mensajeDeError(err, t));
      setEquipoEstado('error');
    }
  }, [mostrarOnboarding, t]);

  useEffect(() => {
    cargarEquipo();
  }, [cargarEquipo]);

  const estados = [postulaciones.estado, solicitudes.estado, asistentes.estado, familias.estado];
  const estadoGeneral = estados.includes('error')
    ? 'error'
    : estados.includes('cargando')
      ? 'cargando'
      : 'listo';

  const postulacionesHoy = postulaciones.filas.filter((p) => esHoy(p.creado_en)).length;
  const postulacionesSemana = postulaciones.filas.filter((p) => esEstaSemana(p.creado_en)).length;
  const solicitudesPendientes = solicitudes.filas.filter((s) => s.estado === 'nueva').length;
  const asistentesDisponibles = asistentes.filas.filter((a) => a.estado === 'activo').length;
  const familiasActivas = familias.filas.filter((f) => !f.deleted_at).length;

  return (
    <div>
      <h1>{t.dashboard.titulo}</h1>

      {mostrarOnboarding && (
        <OnboardingChecklist
          informativo={onboardingInformativo}
          pasoModalidadHecho={tieneModalidad('directa') || tieneModalidad('marketplace')}
          modalidadesCargadas={modalidadesCargadas}
          pasoAsistenteHecho={asistentes.filas.length > 0}
          pasoFamiliaHecho={familias.filas.length > 0}
          equipoEstado={equipoEstado}
          errorEquipo={errorEquipo}
          pasoEquipoHecho={equipoTieneCoordinador}
          recargarEquipo={cargarEquipo}
        />
      )}

      <div className="dashboard-seccion">
        <div className="dashboard-seccion-header">
          <h2 className="dashboard-seccion-titulo">{t.dashboard.seccion_actividad_titulo}</h2>
          <p className="dashboard-seccion-subtitulo">{t.dashboard.seccion_actividad_subtitulo}</p>
        </div>
        <EstadoLista
          estado={estadoGeneral}
          error={postulaciones.error || solicitudes.error || asistentes.error || familias.error}
          vacio={false}
          recargar={() => {
            postulaciones.recargar();
            solicitudes.recargar();
            asistentes.recargar();
            familias.recargar();
          }}
        >
          <div className="dashboard-metricas">
            <div className="metrica-card">
              <span className="metrica-valor">{postulacionesHoy}</span>
              <span className="metrica-label">{t.dashboard.postulaciones_hoy}</span>
            </div>
            <div className="metrica-card">
              <span className="metrica-valor">{postulacionesSemana}</span>
              <span className="metrica-label">{t.dashboard.postulaciones_semana}</span>
            </div>
            <div className="metrica-card">
              <span className="metrica-valor">{solicitudesPendientes}</span>
              <span className="metrica-label">{t.dashboard.solicitudes_pendientes}</span>
            </div>
            <div className="metrica-card">
              <span className="metrica-valor">{asistentesDisponibles}</span>
              <span className="metrica-label">{t.dashboard.asistentes_disponibles}</span>
            </div>
            <div className="metrica-card">
              <span className="metrica-valor">{familiasActivas}</span>
              <span className="metrica-label">{t.dashboard.familias_activas}</span>
            </div>
          </div>
        </EstadoLista>
      </div>

      <div className="dashboard-seccion">
        <div className="dashboard-seccion-header">
          <h2 className="dashboard-seccion-titulo">{t.dashboard.seccion_alertas_titulo}</h2>
          <p className="dashboard-seccion-subtitulo">{t.dashboard.seccion_alertas_subtitulo}</p>
        </div>
        <EstadoLista
          estado={errorAlertas ? 'error' : ausentesSinRelevo === null ? 'cargando' : 'listo'}
          error={errorAlertas}
          vacio={false}
          recargar={cargarAlertas}
        >
          <div className="dashboard-metricas">
            <Link to="/continuidad" className={`metrica-card${ausentesSinRelevo > 0 ? ' metrica-card-alerta' : ''}`}>
              <span className="metrica-valor">{ausentesSinRelevo}</span>
              <span className="metrica-label">{t.dashboard.ausentes_sin_relevo}</span>
            </Link>
            <Link to="/asistentes" className={`metrica-card${documentosPorVencer > 0 ? ' metrica-card-alerta' : ''}`}>
              <span className="metrica-valor">{documentosPorVencer}</span>
              <span className="metrica-label">{t.dashboard.documentacion_por_vencer}</span>
            </Link>
          </div>
          {desgloseModalidadHabilitado && ausentesPorModalidad && (
            <div className="dashboard-metricas dashboard-metricas-desglose">
              {modalidades.map((modalidad) => (
                <div key={modalidad} className="metrica-card metrica-card-secundaria">
                  <span className="metrica-valor">{ausentesPorModalidad[modalidad] ?? 0}</span>
                  <span className="metrica-label">
                    {t.dashboard.ausentes_sin_relevo_por_modalidad.replace(
                      '{modalidad}',
                      NOMBRE_MODALIDAD[modalidad]?.(t) ?? modalidad,
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </EstadoLista>
      </div>
    </div>
  );
}

// Checklist de configuración inicial (Fase 8 del rediseño de frontend). Se deriva en vivo de
// datos que ya se cargan en otro lugar (Asistentes/Familias del propio Dashboard, usuarios del
// equipo vía el mismo endpoint que UsuariosPanel.jsx) — nunca de una tabla de "hitos" nueva,
// para no duplicar la fuente de verdad de "¿esta Prestadora ya cargó su primer X?" (Regla 12).
// Se oculta sola cuando los 3 pasos están completos, no tiene botón de "descartar" manual.
function OnboardingChecklist({
  informativo,
  pasoModalidadHecho,
  modalidadesCargadas,
  pasoAsistenteHecho,
  pasoFamiliaHecho,
  equipoEstado,
  errorEquipo,
  pasoEquipoHecho,
  recargarEquipo,
}) {
  const { t } = useLocale();

  if (equipoEstado === 'cargando' || !modalidadesCargadas) {
    return <p className="estado-cargando">{t.comun.cargando}</p>;
  }

  if (equipoEstado === 'error') {
    return (
      <Alert variant="error">
        {errorEquipo || t.comun.error_generico}{' '}
        <Button variant="secondary" onClick={recargarEquipo}>
          {t.comun.reintentar}
        </Button>
      </Alert>
    );
  }

  const pasos = [
    {
      key: 'modalidad',
      hecho: pasoModalidadHecho,
      ruta: '/configuracion',
      titulo: t.onboarding.paso_modalidad_titulo,
      explicacion: t.onboarding.paso_modalidad_explicacion,
      cta: t.onboarding.paso_modalidad_cta,
    },
    {
      key: 'asistente',
      hecho: pasoAsistenteHecho,
      ruta: '/asistentes',
      titulo: t.onboarding.paso_asistente_titulo,
      explicacion: t.onboarding.paso_asistente_explicacion,
      cta: t.onboarding.paso_asistente_cta,
    },
    {
      key: 'familia',
      hecho: pasoFamiliaHecho,
      ruta: '/familias',
      titulo: t.onboarding.paso_familia_titulo,
      explicacion: t.onboarding.paso_familia_explicacion,
      cta: t.onboarding.paso_familia_cta,
    },
    {
      key: 'equipo',
      hecho: pasoEquipoHecho,
      ruta: '/usuarios-panel',
      titulo: t.onboarding.paso_equipo_titulo,
      explicacion: t.onboarding.paso_equipo_explicacion,
      cta: t.onboarding.paso_equipo_cta,
    },
  ];

  const completados = pasos.filter((p) => p.hecho).length;
  if (completados === pasos.length) return null;

  const porcentaje = Math.round((completados / pasos.length) * 100);

  return (
    <div className="onboarding-checklist">
      <div className="onboarding-checklist-header">
        <h2>{informativo ? t.onboarding.titulo_informativo : t.onboarding.titulo}</h2>
        <span className="onboarding-checklist-fraccion">
          {t.onboarding.completados.replace('{n}', completados).replace('{total}', pasos.length)}
        </span>
      </div>
      <div className="onboarding-checklist-barra">
        <div className="onboarding-checklist-barra-relleno" style={{ width: `${porcentaje}%` }} />
      </div>
      <ul className="onboarding-checklist-pasos">
        {pasos.map((paso) => (
          <li key={paso.key} className={`onboarding-paso${paso.hecho ? ' onboarding-paso-hecho' : ''}`}>
            <div className="onboarding-paso-info">
              <span className="onboarding-paso-titulo">{paso.titulo}</span>
              <span className="onboarding-paso-explicacion">{paso.explicacion}</span>
            </div>
            {paso.hecho ? (
              <span className="badge badge-exito">{t.onboarding.paso_completado}</span>
            ) : (
              !informativo && (
                <Link to={paso.ruta} className="btn btn-secondary">
                  {paso.cta}
                </Link>
              )
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
