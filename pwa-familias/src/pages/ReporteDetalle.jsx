import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { useSeVe } from '../context/PerfilContext';

const CAMPOS_TEXTO = ['incidentes', 'observaciones'];

const CLAVES_SIGNOS_VITALES_LEGADO = ['presion', 'temperatura', 'saturacion', 'glucemia'];
const CLAVES_SIGNOS_VITALES = ['presion_sistolica', 'presion_diastolica', 'temperatura', 'saturacion', 'glucemia'];

const CARAS_ANIMO = { muy_bien: '😄', bien: '🙂', regular: '😐', mal: '🙁', muy_mal: '😣' };

function colorSigno(valor, rango) {
  if (!rango || valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  if (Number.isNaN(numero)) return null;
  return numero >= rango.min && numero <= rango.max ? 'normal' : 'alerta';
}

export default function ReporteDetalle() {
  const { id, reporteId } = useParams();
  const { t } = useLocale();
  const seVe = useSeVe();
  const [reporte, setReporte] = useState(null);
  const [rangosVitales, setRangosVitales] = useState({});
  const [error, setError] = useState('');

  // Se pide este reporte y nada más. Antes se pedía la lista entera —hasta 60 reportes con
  // todo adentro— para quedarse con uno: el resto era información de salud de esa persona
  // viajando al teléfono para descartarse en el acto.
  useEffect(() => {
    let activo = true;
    api
      .reporteDelPaciente(id, reporteId)
      .then(({ reporte: uno, rangosVitales: rangos }) => {
        if (!activo) return;
        setReporte(uno || false);
        setRangosVitales(rangos || {});
      })
      .catch((e) => {
        if (!activo) return;
        // Un reporte que no está no es una falla: la pantalla lo muestra como vacío.
        if (e?.status === 404) setReporte(false);
        else setError(t.comun.error_generico);
      });
    return () => {
      activo = false;
    };
  }, [id, reporteId]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (reporte === null) return <div className="estado-cargando">{t.comun.cargando}</div>;
  if (reporte === false) return <div className="estado-vacio">{t.comun.vacio}</div>;

  return (
    <div>
      <Link to={`/pacientes/${id}/reportes`} className="btn btn-secondary" style={{ marginBottom: '1rem', fontSize: '0.8rem', padding: '0.4rem 1rem' }}>
        <span aria-hidden="true">←</span> {t.comun.volver}
      </Link>
      <h1>{t.reporte_detalle.titulo}</h1>
      <p className="guardia-card-detalle">
        {reporte.guardias?.fecha} · {t.reporte_detalle.asistente}: {reporte.guardias?.asistentes?.nombre}
      </p>

      <div className="reporte-preview-campo">
        <label>{t.reporte_detalle.campo_alimentacion}</label>
        <div>{reporte.alimentacion?.descripcion || t.reporte_detalle.sin_datos}</div>
      </div>

      {/* Mismo motivo que los signos vitales: la Prestadora que no muestra la medicación
          tampoco la muestra adentro del reporte del día. Sin esta condición el motor deja de
          mandarla pero el título queda igual, con un "sin datos" debajo que hace creer que ese
          día no se le dio nada. */}
      {seVe('familia_medicacion_del_paciente') && (
        <div className="reporte-preview-campo">
          <label>{t.reporte_detalle.campo_medicacion}</label>
          {Array.isArray(reporte.medicacion) && reporte.medicacion.length > 0 ? (
            reporte.medicacion.map((m, i) => (
              <div key={i}>
                {[m.nombre, m.hora, m.via].filter(Boolean).join(' · ')}
              </div>
            ))
          ) : (
            <div>{t.reporte_detalle.sin_datos}</div>
          )}
        </div>
      )}

      {/* La Prestadora que no hace enfermería no toma estos valores. Sin esta condición el
          motor deja de mandarlos pero el título queda igual, con un "sin datos" debajo que
          hace creer que alguien los está controlando y ese día no los cargó. */}
      {seVe('familia_signos_vitales') && (
        <div className="reporte-preview-campo">
          <label>{t.reporte_detalle.campo_signos_vitales}</label>
          {reporte.signos_vitales && CLAVES_SIGNOS_VITALES.some((clave) => reporte.signos_vitales[clave]) ? (
            CLAVES_SIGNOS_VITALES.filter((clave) => reporte.signos_vitales[clave]).map((clave) => {
              const color = colorSigno(reporte.signos_vitales[clave], rangosVitales[clave]);
              return (
                <div key={clave} className={color ? `signo-vital-${color}` : ''}>
                  {t.reporte_detalle[`signo_${clave}`]}: {reporte.signos_vitales[clave]}
                  {rangosVitales[clave] ? ` ${rangosVitales[clave].unidad}` : ''}
                  {color === 'alerta' && <span className="signo-vital-aviso"> — {t.reporte_detalle.signo_fuera_de_rango}</span>}
                </div>
              );
            })
          ) : reporte.signos_vitales && CLAVES_SIGNOS_VITALES_LEGADO.some((clave) => reporte.signos_vitales[clave]) ? (
            CLAVES_SIGNOS_VITALES_LEGADO.filter((clave) => reporte.signos_vitales[clave]).map((clave) => (
              <div key={clave}>
                {t.reporte_detalle[`signo_${clave}`]}: {reporte.signos_vitales[clave]}
              </div>
            ))
          ) : (
            <div>{t.reporte_detalle.sin_datos}</div>
          )}
        </div>
      )}

      <div className="reporte-preview-campo">
        <label>{t.reporte_detalle.campo_estado_animo}</label>
        {reporte.estado_animo && CARAS_ANIMO[reporte.estado_animo] ? (
          <div className="escala-animo-lectura">
            <span aria-hidden="true">{CARAS_ANIMO[reporte.estado_animo]}</span>
            <span>{t.reporte_detalle[`animo_${reporte.estado_animo}`]}</span>
          </div>
        ) : (
          <div>{t.reporte_detalle.sin_datos}</div>
        )}
      </div>

      {CAMPOS_TEXTO.map((campo) => (
        <div key={campo} className="reporte-preview-campo">
          <label>{t.reporte_detalle[`campo_${campo}`]}</label>
          <div>{reporte[campo] || t.reporte_detalle.sin_datos}</div>
        </div>
      ))}

      {reporte.foto_url && (
        <div className="reporte-preview-campo">
          <img src={reporte.foto_url} alt="" style={{ width: '100%', borderRadius: '12px' }} />
        </div>
      )}
    </div>
  );
}
