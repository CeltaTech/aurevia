import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { esAdminOSuperior } from '../../lib/roles';
import { pestanasDe } from '../../lib/pestanasDelAsistente';
import { supabase } from '../../lib/supabaseClient';
import { PerfilTab } from './PerfilTab';
import { VerificacionTab } from './VerificacionTab';
import { CertificadoTab } from './CertificadoTab';
import { MatriculasTab } from './MatriculasTab';
import { VinculoCeseTab } from './VinculoCeseTab';
import { SimuladorVinculoTab } from './SimuladorVinculoTab';
import { ScoreRiesgoTab } from './ScoreRiesgoTab';
import { GuardiasTab } from './GuardiasTab';
import { AusenciasCoberturaTab } from './AusenciasCoberturaTab';
import { ComunicacionTab } from './ComunicacionTab';
import { mensajeDeError } from '../../lib/errores';
import { CAMPOS_PAGO, CAMPOS_RESERVADOS, conDatosAparte } from '../../lib/fichaAsistente';

export function AsistenteDetalle() {
  const { t } = useLocale();
  const { id } = useParams();
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const [asistente, setAsistente] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('perfil');

  const esAdmin = esAdminOSuperior(usuario?.rol);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    // Coordinador consulta la vista restringida (sin vínculo laboral) — ver schema_etapa2i.sql.
    // Los datos delicados son el caso aparte: viven en sus propias tablas y los piden
    // `CAMPOS_PAGO` y `CAMPOS_RESERVADOS`, donde la base exige el permiso correspondiente para
    // contestar. Ahí la restricción no depende de qué consulte la pantalla: las reglas de
    // acceso filtran filas y no columnas, así que separar la tabla es lo único que impide leer
    // el dato preguntando por fuera del Panel.
    const tabla = esAdmin ? 'asistentes' : 'asistentes_coordinador';
    const columnas = esAdmin ? `*, ${CAMPOS_PAGO}, ${CAMPOS_RESERVADOS}` : '*';
    const { data, error: errorConsulta } = await supabase.from(tabla).select(columnas).eq('id', id).single();
    if (errorConsulta) {
      setError(errorConsulta.code === 'PGRST116' ? null : mensajeDeError(errorConsulta, t));
      setEstado(errorConsulta.code === 'PGRST116' ? 'no_encontrado' : 'error');
      return;
    }
    setAsistente(conDatosAparte(data));
    setEstado('listo');
  }, [id, esAdmin, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  if (estado === 'cargando') return <p className="estado-cargando">{t.comun.cargando}</p>;
  if (estado === 'no_encontrado') return <p className="estado-vacio">{t.comun.no_encontrado}</p>;
  if (estado === 'error') return <p className="estado-vacio">{error || t.comun.error_generico}</p>;

  return (
    <div>
      <button className="link-volver" onClick={() => navigate('/asistentes')}><span aria-hidden="true">←</span> {t.asistentes.volver_al_plantel}</button>
      <h1>{asistente.nombre}</h1>

      <div className="panel-tabs">
        {pestanasDe(esAdmin).map((tabId) => (
          <button
            key={tabId}
            className={`panel-tab ${tab === tabId ? 'panel-tab-activo' : ''}`}
            onClick={() => setTab(tabId)}
          >
            {t.asistentes.tabs[tabId]}
          </button>
        ))}
      </div>

      <div className="panel-tab-contenido">
        {tab === 'perfil' && <PerfilTab asistente={asistente} onActualizado={recargar} />}
        {tab === 'verificacion' && <VerificacionTab asistente={asistente} />}
        {tab === 'certificado' && <CertificadoTab asistente={asistente} />}
        {tab === 'matriculas' && esAdmin && <MatriculasTab asistente={asistente} />}
        {tab === 'vinculo_cese' && esAdmin && <VinculoCeseTab asistente={asistente} onActualizado={recargar} />}
        {tab === 'simulador' && esAdmin && <SimuladorVinculoTab asistente={asistente} />}
        {tab === 'score_riesgo' && esAdmin && <ScoreRiesgoTab asistente={asistente} onActualizado={recargar} />}
        {tab === 'guardias' && <GuardiasTab asistente={asistente} />}
        {tab === 'ausencias' && <AusenciasCoberturaTab asistente={asistente} />}
        {tab === 'comunicacion' && <ComunicacionTab asistente={asistente} />}
      </div>
    </div>
  );
}
