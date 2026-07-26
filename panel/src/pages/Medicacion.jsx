import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { useAdvertenciaLegal } from '../context/AdvertenciaLegalContext';
import { supabase } from '../lib/supabaseClient';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Alert } from '../components/ui/Alert';
import { EstadoLista } from '../components/layout/EstadoLista';

const API_URL = import.meta.env.VITE_API_URL;

async function llamarApi(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/medicacion${path}`, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session?.access_token}`,
      ...opciones.headers,
    },
  });
  const resultado = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(resultado.error || 'Error de red');
  return resultado;
}

export function Medicacion() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const { verificarAntesDeActivar } = useAdvertenciaLegal();
  const [pendientes, setPendientes] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [accionEnCurso, setAccionEnCurso] = useState(null);
  const [rechazando, setRechazando] = useState(null);
  const [motivoRechazo, setMotivoRechazo] = useState('');

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { pendientes: filas } = await llamarApi('/pendientes');
      setPendientes(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function aceptar(fila) {
    if (fila.sinHabilitacion) {
      const confirmado = await verificarAntesDeActivar(usuario.prestadora_id, 'medicacion_via_sin_habilitacion');
      if (!confirmado) return;
    }
    setAccionEnCurso(fila.id);
    setError(null);
    try {
      await llamarApi(`/${fila.id}/aceptar`, { method: 'POST' });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setAccionEnCurso(null);
    }
  }

  async function confirmarRechazo(fila) {
    if (!motivoRechazo) return;
    setAccionEnCurso(fila.id);
    setError(null);
    try {
      await llamarApi(`/${fila.id}/rechazar`, { method: 'POST', body: JSON.stringify({ motivo_rechazo: motivoRechazo }) });
      setRechazando(null);
      setMotivoRechazo('');
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setAccionEnCurso(null);
    }
  }

  async function verArchivo(ruta) {
    try {
      const { url } = await llamarApi(`/archivo-url?ruta=${encodeURIComponent(ruta)}`);
      window.open(url, '_blank', 'noreferrer');
    } catch {
      setError(t.comun.error_generico);
    }
  }

  return (
    <div>
      <h1>{t.medicacion.titulo}</h1>
      <p className="panel-explicacion">{t.medicacion.explicacion}</p>
      {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}

      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && pendientes.length === 0} recargar={recargar} mensajeVacio={t.medicacion.sin_pendientes}>
        {pendientes.map((fila) => (
          <div key={fila.id} className="panel-card-verificacion" style={{ marginBottom: '1rem' }}>
            <p>
              <strong>{fila.pacientes?.nombre}</strong> — {fila.medicamento} · {fila.dosis} · {fila.frecuencia} ({fila.via_administracion})
            </p>
            <p>
              {t.medicacion.desde}: {fila.fecha_desde} {fila.fecha_hasta ? `— ${t.medicacion.hasta}: ${fila.fecha_hasta}` : ''}
            </p>
            {fila.prescripcion_archivo_url && (
              <p>
                <button onClick={() => verArchivo(fila.prescripcion_archivo_url)}>{t.medicacion.ver_prescripcion}</button>
              </p>
            )}
            {fila.sinHabilitacion && <Alert variant="info">{t.medicacion.sin_habilitacion_aviso}</Alert>}

            {rechazando === fila.id ? (
              <div>
                <FormField
                  label={t.medicacion.motivo_rechazo}
                  name={`motivo-${fila.id}`}
                  value={motivoRechazo}
                  onChange={(e) => setMotivoRechazo(e.target.value)}
                  required
                />
                <Button variant="secondary" onClick={() => { setRechazando(null); setMotivoRechazo(''); }} disabled={accionEnCurso === fila.id}>
                  {t.comun.cancelar}
                </Button>{' '}
                <Button onClick={() => confirmarRechazo(fila)} disabled={accionEnCurso === fila.id || !motivoRechazo}>
                  {accionEnCurso === fila.id ? t.comun.guardando : t.medicacion.confirmar_rechazo}
                </Button>
              </div>
            ) : (
              <div>
                <Button onClick={() => aceptar(fila)} disabled={accionEnCurso === fila.id}>
                  {accionEnCurso === fila.id ? t.comun.guardando : t.medicacion.aceptar}
                </Button>{' '}
                <Button variant="secondary" onClick={() => setRechazando(fila.id)} disabled={accionEnCurso === fila.id}>
                  {t.medicacion.rechazar}
                </Button>
              </div>
            )}
          </div>
        ))}
      </EstadoLista>
    </div>
  );
}
