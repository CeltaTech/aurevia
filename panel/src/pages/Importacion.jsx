import { useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { usePermisos } from '../context/PermisosContext';
import { supabase } from '../lib/supabaseClient';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Alert } from '../components/ui/Alert';

const API_URL = import.meta.env.VITE_API_URL;

async function llamarApi(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/importacion${path}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${data.session?.access_token}`,
      ...opciones.headers,
    },
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.error);
  return resultado;
}

export function Importacion() {
  const { t } = useLocale();
  const { puede, cargado } = usePermisos();

  const [tipo, setTipo] = useState('asistente');
  const [archivo, setArchivo] = useState(null);
  const [paso, setPaso] = useState(1);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);

  const [analisis, setAnalisis] = useState(null);
  const [mapeo, setMapeo] = useState({});
  const [resultado, setResultado] = useState(null);
  const [revision, setRevision] = useState(null);
  const [revisionFinal, setRevisionFinal] = useState(null);
  const [confirmandoRechazo, setConfirmandoRechazo] = useState(false);

  if (cargado && !puede('importar_datos_masivos')) {
    return <Alert variant="error">{t.comun.sin_permiso || t.comun.error_generico}</Alert>;
  }

  async function handleAnalizar(e) {
    e.preventDefault();
    if (!archivo) {
      setError(t.importacion.falta_archivo);
      return;
    }
    setCargando(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('archivo', archivo);
      formData.append('tipo', tipo);
      const { data } = await supabase.auth.getSession();
      const respuesta = await fetch(`${API_URL}/api/panel/importacion/analizar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session?.access_token}` },
        body: formData,
      });
      const resultadoJson = await respuesta.json();
      if (!respuesta.ok) throw new Error(resultadoJson.error);
      setAnalisis(resultadoJson);
      setMapeo(resultadoJson.mapeoPropuesto);
      setPaso(2);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function handleConfirmar() {
    setCargando(true);
    setError(null);
    try {
      const resultadoJson = await llamarApi('/confirmar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tipo,
          filas: analisis.filas,
          mapeo,
          archivoNombre: analisis.archivoNombre,
        }),
      });
      setResultado(resultadoJson);
      setPaso(3);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function handleVerRevision() {
    setCargando(true);
    setError(null);
    try {
      const resultadoJson = await llamarApi(`/revision/${resultado.importacionId}`);
      setRevision(resultadoJson);
      setPaso(4);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function handleConformar() {
    setCargando(true);
    setError(null);
    try {
      await llamarApi(`/conformar/${resultado.importacionId}`, { method: 'POST' });
      setRevisionFinal('conformada');
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  async function handleRechazar() {
    setConfirmandoRechazo(false);
    setCargando(true);
    setError(null);
    try {
      await llamarApi(`/rechazar/${resultado.importacionId}`, { method: 'POST' });
      setRevisionFinal('rechazada');
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  }

  function handleReiniciar() {
    setPaso(1);
    setArchivo(null);
    setAnalisis(null);
    setMapeo({});
    setResultado(null);
    setRevision(null);
    setRevisionFinal(null);
    setError(null);
  }

  return (
    <div>
      <h1>{t.importacion.titulo}</h1>
      <p>{t.importacion.explicacion}</p>

      {error && <Alert variant="error">{error}</Alert>}

      {paso === 1 && (
        <form onSubmit={handleAnalizar}>
          <FormField label={t.importacion.paso1_tipo} name="tipo" type="select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="asistente">{t.importacion.tipo_asistente}</option>
            <option value="familia">{t.importacion.tipo_familia}</option>
          </FormField>
          <FormField
            label={t.importacion.paso1_archivo}
            name="archivo"
            type="file"
            onChange={(e) => setArchivo(e.target.files?.[0] || null)}
          />
          <Button type="submit" disabled={cargando}>
            {cargando ? t.importacion.analizando : t.importacion.analizar}
          </Button>
        </form>
      )}

      {paso === 2 && analisis && (
        <div>
          <h2>{t.importacion.paso2_titulo}</h2>
          <p>{t.importacion.paso2_explicacion}</p>

          {analisis.advertencias.length > 0 && (
            <Alert variant="info">
              <strong>{t.importacion.advertencias_titulo}</strong>
              <ul>
                {analisis.advertencias.map((adv, i) => (
                  <li key={i}>{adv}</li>
                ))}
              </ul>
            </Alert>
          )}

          <table>
            <thead>
              <tr>
                <th>{t.importacion.col_archivo}</th>
                <th>{t.importacion.col_campo}</th>
              </tr>
            </thead>
            <tbody>
              {analisis.headers.map((columna) => (
                <tr key={columna}>
                  <td>{columna}</td>
                  <td>
                    <select
                      value={mapeo[columna] || ''}
                      onChange={(e) => setMapeo({ ...mapeo, [columna]: e.target.value || null })}
                    >
                      <option value="">{t.importacion.campo_ninguno}</option>
                      {analisis.camposDisponibles.map((campo) => (
                        <option key={campo} value={campo}>
                          {t.importacion[`campo_${campo}`] || campo}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>{t.importacion.vista_previa_titulo}</h3>
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  {analisis.headers.map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {analisis.filas.slice(0, 5).map((fila, i) => (
                  <tr key={i}>
                    {analisis.headers.map((h) => (
                      <td key={h}>{String(fila[h])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <Button variant="secondary" onClick={handleReiniciar} disabled={cargando}>
            {t.importacion.volver}
          </Button>
          <Button onClick={handleConfirmar} disabled={cargando}>
            {cargando ? t.importacion.confirmando : t.importacion.confirmar}
          </Button>
        </div>
      )}

      {paso === 3 && resultado && (
        <div>
          <h2>{t.importacion.paso3_titulo}</h2>
          <Alert variant={resultado.filasError > 0 ? 'info' : 'success'}>
            {t.importacion.resumen
              .replace('{creadas}', resultado.filasCreadas)
              .replace('{total}', resultado.filasTotales)}
          </Alert>

          {resultado.errores.length > 0 && (
            <Alert variant="error">
              <strong>{t.importacion.filas_error_titulo}</strong>
              <ul>
                {resultado.errores.map((e) => (
                  <li key={e.fila}>
                    {t.importacion.fila_error.replace('{n}', e.fila).replace('{error}', e.error)}
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          <Button variant="secondary" onClick={handleReiniciar} disabled={cargando}>
            {t.importacion.nueva_importacion}
          </Button>
          {resultado.filasCreadas > 0 && (
            <Button onClick={handleVerRevision} disabled={cargando}>
              {cargando ? t.importacion.cargando_revision : t.importacion.revisar_resultado}
            </Button>
          )}
        </div>
      )}

      {paso === 4 && revision && (
        <div>
          <h2>{t.importacion.paso4_titulo}</h2>
          <p>{t.importacion.paso4_explicacion}</p>

          {revisionFinal === 'conformada' && <Alert variant="success">{t.importacion.conformidad_exito}</Alert>}
          {revisionFinal === 'rechazada' && <Alert variant="info">{t.importacion.rechazo_exito}</Alert>}

          {!revisionFinal && (
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    {revision.lote.tipo === 'asistente' ? (
                      <>
                        <th>{t.importacion.campo_nombre}</th>
                        <th>{t.importacion.campo_dni}</th>
                        <th>{t.importacion.campo_email}</th>
                        <th>{t.importacion.campo_telefono}</th>
                      </>
                    ) : (
                      <>
                        <th>{t.importacion.campo_nombrePaciente}</th>
                        <th>{t.importacion.campo_domicilioPaciente}</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {revision.filas.map((fila) => (
                    revision.lote.tipo === 'asistente' ? (
                      <tr key={fila.id}>
                        <td>{fila.nombre}</td>
                        <td>{fila.dni}</td>
                        <td>{fila.email}</td>
                        <td>{fila.telefono}</td>
                      </tr>
                    ) : (
                      (fila.pacientes || []).map((paciente) => (
                        <tr key={paciente.id}>
                          <td>{paciente.nombre}</td>
                          <td>{paciente.domicilio}</td>
                        </tr>
                      ))
                    )
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!revisionFinal && (
            <>
              <Button variant="secondary" onClick={() => setConfirmandoRechazo(true)} disabled={cargando}>
                {cargando ? t.importacion.rechazando : t.importacion.rechazar}
              </Button>
              <Button onClick={handleConformar} disabled={cargando}>
                {cargando ? t.importacion.conformando : t.importacion.conformar}
              </Button>
            </>
          )}
          {revisionFinal && (
            <Button onClick={handleReiniciar}>{t.importacion.nueva_importacion}</Button>
          )}

          {confirmandoRechazo && (
            <div className="panel-modal-fondo" onClick={() => setConfirmandoRechazo(false)}>
              <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
                <h2>{t.importacion.rechazar}</h2>
                <p>{t.importacion.confirmar_rechazo}</p>
                <div className="panel-modal-acciones">
                  <Button variant="secondary" onClick={() => setConfirmandoRechazo(false)} disabled={cargando}>
                    {t.comun.cancelar}
                  </Button>
                  <Button onClick={handleRechazar} disabled={cargando}>
                    {cargando ? t.importacion.rechazando : t.importacion.rechazar}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
