import { useCallback, useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { useSeVe } from '../context/PerfilContext';
import { mensajeDeError } from '../lib/errores';

const ESTADO_CLASE = {
  pendiente: 'badge-amarilla',
  aceptada: 'badge-verde',
  rechazada: 'badge-roja',
  finalizada: '',
};

export default function Medicacion() {
  const { id } = useParams();
  const { t } = useLocale();
  const seVe = useSeVe();
  // Ver la medicación y pedir una son dos decisiones distintas de la Prestadora: hay quien
  // muestra la lista pero no deja que la Familia cargue nada. Que se vea la lista ya lo
  // decidió la ruta antes de llegar acá.
  const puedePedirMedicacion = seVe('familia_pide_medicacion');
  const [rolCirculo, setRolCirculo] = useState(null);
  const [indicaciones, setIndicaciones] = useState(undefined);
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [exito, setExito] = useState(false);
  const [medicamento, setMedicamento] = useState('');
  const [dosis, setDosis] = useState('');
  const [frecuencia, setFrecuencia] = useState('');
  const [via, setVia] = useState('');
  const [fechaDesde, setFechaDesde] = useState('');
  const [fechaHasta, setFechaHasta] = useState('');
  const [archivo, setArchivo] = useState(null);

  const soloLectura = rolCirculo === 'solo_lectura';

  const cargar = useCallback(() => {
    api
      .indicacionesMedicacion(id)
      .then((data) => setIndicaciones(data.indicaciones))
      .catch((e) => setError(mensajeDeError(e, t, 'indicaciones de medicación')));
  }, [id]);

  useEffect(() => {
    setIndicaciones(undefined);
    cargar();
  }, [cargar]);

  useEffect(() => {
    api
      .perfil()
      .then(({ perfil }) => setRolCirculo(perfil.rolCirculo))
      .catch(() => {});
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setExito(false);
    if (!medicamento || !dosis || !frecuencia || !via || !fechaDesde) {
      setError(t.medicacion.error_campos_obligatorios);
      return;
    }
    setEnviando(true);
    try {
      const formData = new FormData();
      formData.append('medicamento', medicamento);
      formData.append('dosis', dosis);
      formData.append('frecuencia', frecuencia);
      formData.append('via_administracion', via);
      formData.append('fecha_desde', fechaDesde);
      if (fechaHasta) formData.append('fecha_hasta', fechaHasta);
      if (archivo) formData.append('prescripcion', archivo);
      await api.crearIndicacionMedicacion(id, formData);
      setMedicamento('');
      setDosis('');
      setFrecuencia('');
      setVia('');
      setFechaDesde('');
      setFechaHasta('');
      setArchivo(null);
      setExito(true);
      cargar();
    } catch (fallo) {
      setError(mensajeDeError(fallo, t, 'pedir medicación'));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div>
      <Link to={`/pacientes/${id}`} className="btn btn-secondary" style={{ marginBottom: '1rem', fontSize: '0.8rem', padding: '0.4rem 1rem' }}>
        {t.comun.volver}
      </Link>

      <h1>{t.medicacion.titulo}</h1>

      {error && <div className="alert alert-error">{error}</div>}

      {indicaciones === undefined && <div className="estado-cargando">{t.comun.cargando}</div>}

      {indicaciones !== undefined && (
        <>
          {indicaciones.length === 0 && <div className="estado-vacio">{t.medicacion.sin_indicaciones}</div>}
          {indicaciones.map((ind) => (
            <div key={ind.id} className="guardia-card-detalle" style={{ marginBottom: '0.6rem' }}>
              <div>
                <strong>{ind.medicamento}</strong> — {ind.dosis} — {ind.frecuencia} ({ind.via_administracion})
              </div>
              <div>
                <span className={`badge ${ESTADO_CLASE[ind.estado] || ''}`}>{t.medicacion[`estado_${ind.estado}`]}</span>
              </div>
              <div>
                {t.medicacion.desde}: {ind.fecha_desde} {ind.fecha_hasta ? `— ${t.medicacion.hasta}: ${ind.fecha_hasta}` : ''}
              </div>
              {ind.estado === 'rechazada' && ind.motivo_rechazo && (
                <div>{t.medicacion.motivo_rechazo}: {ind.motivo_rechazo}</div>
              )}
            </div>
          ))}
        </>
      )}

      {puedePedirMedicacion && (
        <>
          <h2 style={{ marginTop: '1.5rem' }}>{t.medicacion.nueva_titulo}</h2>

          {soloLectura && <div className="alert alert-error">{t.medicacion.solo_lectura}</div>}

          {!soloLectura && (
            <form onSubmit={handleSubmit}>
              <label>{t.medicacion.campo_medicamento}</label>
              <input type="text" value={medicamento} onChange={(e) => setMedicamento(e.target.value)} />

              <label>{t.medicacion.campo_dosis}</label>
              <input type="text" value={dosis} onChange={(e) => setDosis(e.target.value)} />

              <label>{t.medicacion.campo_frecuencia}</label>
              <input type="text" value={frecuencia} onChange={(e) => setFrecuencia(e.target.value)} />

              <label>{t.medicacion.campo_via}</label>
              <input type="text" placeholder={t.medicacion.campo_via_placeholder} value={via} onChange={(e) => setVia(e.target.value)} />

              <label>{t.medicacion.campo_fecha_desde}</label>
              <input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />

              <label>{t.medicacion.campo_fecha_hasta}</label>
              <input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />

              <label>{t.medicacion.campo_prescripcion}</label>
              <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />

              {exito && <div className="alert alert-success">{t.medicacion.enviada_exito}</div>}

              <button type="submit" className="btn btn-primary btn-full" disabled={enviando} style={{ marginTop: '1rem' }}>
                {enviando ? t.medicacion.enviando : t.medicacion.enviar}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
