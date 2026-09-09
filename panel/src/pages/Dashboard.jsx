import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { useModalidades } from '../context/ModalidadesContext';
import { esAdminOSuperior } from '../lib/roles';
import { useSupabaseTable } from '../hooks/useSupabaseTable';
import { usePrestadoraActual } from '../hooks/usePrestadoraActual';
import { EstadoLista } from '../components/layout/EstadoLista';
import { supabase } from '../lib/supabaseClient';
import { fechaLimiteDeAviso } from '../lib/reglaVencimientos';
import { diasDeAvisoDeLaPrestadora } from '../lib/plazoDeAviso';

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
  const prestadoraId = usePrestadoraActual();
  const { modalidades } = useModalidades();
  const desgloseModalidadHabilitado = modalidades.length > 1;
  const esAdmin = esAdminOSuperior(usuario?.rol);
  // La guía de primeros pasos vivía acá hasta el 2026-09-09, con cuatro pasos propios, y en el
  // Estado actual había otra con cinco: dos listas distintas de «primeros pasos» para la misma
  // Prestadora según en qué pantalla estuviera. Quedó una sola, en la pantalla de entrada —
  // `components/estado-actual/GuiaPrimerosPasos.jsx` (pendiente #139).
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
    if (!prestadoraId) return;
    setAusentesSinRelevo(null);
    setAusentesPorModalidad(null);
    setDocumentosPorVencer(null);
    setErrorAlertas(null);

    // Trae la modalidad de trabajo de cada incidente —columna `guardias.canal_modalidad`, un
    // nombre viejo que no se renombra (regla 13)— para poder desglosar por
    // modalidad cuando la Prestadora tiene más de una activa (pendiente #85 ítem 3) sin
    // repetir la consulta — un solo punto de verdad para el conteo total y el desglose.
    const { data: filasAusentes, error: errorAusentes } = await supabase
      .from('incidentes_relevo')
      .select('guardias!incidentes_relevo_entrante_tenant_fk(canal_modalidad)')
      .is('resuelto_at', null)
      .is('guardia_saliente_id', null);

    // El plazo de aviso y hasta qué día hay que mirar salen del mismo lugar que en el Estado
    // actual y en Documentación, así que los tres contadores dicen lo mismo (regla 12).
    const diasAviso = await diasDeAvisoDeLaPrestadora(prestadoraId);
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
      const modalidad = fila.guardias?.canal_modalidad;
      if (modalidad && modalidad in porModalidad) porModalidad[modalidad] += 1;
    }
    setAusentesSinRelevo(filasAusentes?.length ?? 0);
    setAusentesPorModalidad(porModalidad);
    setDocumentosPorVencer(countDocumentos ?? 0);
  }, [prestadoraId, t]);

  useEffect(() => {
    cargarAlertas();
  }, [cargarAlertas]);

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
