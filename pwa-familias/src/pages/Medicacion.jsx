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

// Los cinco que hay que completar sí o sí. Están acá y no repartidos por el formulario para
// que el aviso general de arriba y el que se cuelga de cada campo digan siempre lo mismo.
const CAMPOS_OBLIGATORIOS = ['medicamento', 'dosis', 'frecuencia', 'via', 'fecha_desde'];

// Un campo del formulario, con su etiqueta atada al control (`htmlFor`/`id`) y, cuando falta
// completarlo, el aviso colgado del propio campo (`aria-describedby` + `aria-invalid`). Sin
// esto un lector de pantalla anuncia siete cajas sin nombre, y el motivo del rechazo queda
// arriba de todo, suelto, sin decir de cuál de las siete cajas está hablando.
function Campo({ nombre, etiqueta, tipo = 'text', valor, alCambiar, placeholder, accept, error }) {
  const idCampo = `medicacion-${nombre}`;
  const idError = `${idCampo}-error`;
  return (
    <div className="form-field">
      <label htmlFor={idCampo}>{etiqueta}</label>
      <input
        id={idCampo}
        type={tipo}
        placeholder={placeholder}
        accept={accept}
        // El campo de archivo no lleva valor escrito: lo maneja el navegador.
        value={tipo === 'file' ? undefined : valor}
        onChange={alCambiar}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? idError : undefined}
      />
      {error && <span className="form-error" id={idError}>{error}</span>}
    </div>
  );
}

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
  // Cuáles quedaron sin completar, no solo que quedó alguno: es lo que permite colgar el
  // aviso del campo vacío en vez de dejarlo suelto arriba.
  const [faltantes, setFaltantes] = useState([]);

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

  // Qué aviso le toca a este campo: el mismo texto para todos, colgado de cada uno.
  const faltaEn = (campo) => (faltantes.includes(campo) ? t.comun.campo_obligatorio : undefined);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setExito(false);
    const valores = { medicamento, dosis, frecuencia, via, fecha_desde: fechaDesde };
    const sinCompletar = CAMPOS_OBLIGATORIOS.filter((campo) => !valores[campo]);
    setFaltantes(sinCompletar);
    if (sinCompletar.length > 0) {
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
      setFaltantes([]);
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

      {error && <div className="alert alert-error" role="alert">{error}</div>}

      {indicaciones === undefined && <div className="estado-cargando" role="status">{t.comun.cargando}</div>}

      {indicaciones !== undefined && (
        <>
          {indicaciones.length === 0 && <div className="estado-vacio" role="status">{t.medicacion.sin_indicaciones}</div>}
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

          {soloLectura && <div className="alert alert-error" role="alert">{t.medicacion.solo_lectura}</div>}

          {!soloLectura && (
            <form onSubmit={handleSubmit}>
              <Campo
                nombre="medicamento"
                etiqueta={t.medicacion.campo_medicamento}
                valor={medicamento}
                alCambiar={(e) => setMedicamento(e.target.value)}
                error={faltaEn('medicamento')}
              />
              <Campo
                nombre="dosis"
                etiqueta={t.medicacion.campo_dosis}
                valor={dosis}
                alCambiar={(e) => setDosis(e.target.value)}
                error={faltaEn('dosis')}
              />
              <Campo
                nombre="frecuencia"
                etiqueta={t.medicacion.campo_frecuencia}
                valor={frecuencia}
                alCambiar={(e) => setFrecuencia(e.target.value)}
                error={faltaEn('frecuencia')}
              />
              <Campo
                nombre="via"
                etiqueta={t.medicacion.campo_via}
                placeholder={t.medicacion.campo_via_placeholder}
                valor={via}
                alCambiar={(e) => setVia(e.target.value)}
                error={faltaEn('via')}
              />
              <Campo
                nombre="fecha_desde"
                etiqueta={t.medicacion.campo_fecha_desde}
                tipo="date"
                valor={fechaDesde}
                alCambiar={(e) => setFechaDesde(e.target.value)}
                error={faltaEn('fecha_desde')}
              />
              <Campo
                nombre="fecha_hasta"
                etiqueta={t.medicacion.campo_fecha_hasta}
                tipo="date"
                valor={fechaHasta}
                alCambiar={(e) => setFechaHasta(e.target.value)}
              />
              <Campo
                nombre="prescripcion"
                etiqueta={t.medicacion.campo_prescripcion}
                tipo="file"
                accept="application/pdf,image/jpeg,image/png"
                alCambiar={(e) => setArchivo(e.target.files?.[0] || null)}
              />

              {exito && <div className="alert alert-success" role="status">{t.medicacion.enviada_exito}</div>}

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
