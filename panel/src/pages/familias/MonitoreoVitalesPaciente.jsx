import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { mensajeDeError } from '../../lib/errores';

const API_URL = import.meta.env.VITE_API_URL;

async function llamarApi(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/vitales-autorizacion${path}`, {
    ...opciones,
    headers: { Authorization: `Bearer ${data.session?.access_token}`, ...opciones.headers },
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.error);
  return resultado;
}

export function MonitoreoVitalesPaciente({ paciente, onClose }) {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const [autorizacion, setAutorizacion] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [nombreAvala, setNombreAvala] = useState('');
  const [rolAvala, setRolAvala] = useState('profesional');
  const [tipoFirma, setTipoFirma] = useState('digital');
  const [fechaAutorizacion, setFechaAutorizacion] = useState('');
  const [archivo, setArchivo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState(null);

  const [urlArchivo, setUrlArchivo] = useState(null);
  const [cargandoUrl, setCargandoUrl] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    setUrlArchivo(null);
    const { data, error: errorConsulta } = await supabase
      .from('autorizaciones_monitoreo_paciente')
      .select('*')
      .eq('paciente_id', paciente.id)
      .eq('vigente', true)
      .maybeSingle();
    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }
    setAutorizacion(data);
    setEstado('listo');
  }, [paciente.id, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function verArchivo() {
    if (!autorizacion) return;
    setCargandoUrl(true);
    try {
      const { url } = await llamarApi(`/${paciente.id}/archivo-url?ruta=${encodeURIComponent(autorizacion.archivo_url)}`);
      setUrlArchivo(url);
      window.open(url, '_blank', 'noreferrer');
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setCargandoUrl(false);
    }
  }

  async function handleGuardar() {
    if (!nombreAvala || !fechaAutorizacion || !archivo) {
      setErrorForm(t.vitales_autorizacion.form_incompleto);
      return;
    }

    setGuardando(true);
    setErrorForm(null);

    try {
      const { data: sesion } = await supabase.auth.getSession();
      const formData = new FormData();
      formData.append('archivo', archivo);
      const respuestaSubida = await fetch(`${API_URL}/api/panel/vitales-autorizacion/${paciente.id}/archivo`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${sesion.session?.access_token}` },
        body: formData,
      });
      const resultadoSubida = await respuestaSubida.json();
      if (!respuestaSubida.ok) throw new Error(resultadoSubida.error);

      if (autorizacion) {
        await supabase.from('autorizaciones_monitoreo_paciente').update({ vigente: false }).eq('id', autorizacion.id);
      }

      const { error: errorInsert } = await supabase.from('autorizaciones_monitoreo_paciente').insert({
        prestadora_id: usuario.prestadora_id,
        paciente_id: paciente.id,
        nombre_avala: nombreAvala,
        rol_avala: rolAvala,
        tipo_firma: tipoFirma,
        archivo_url: resultadoSubida.archivoUrl,
        fecha_autorizacion: fechaAutorizacion,
        vigente: true,
        registrado_por: usuario.id,
      });
      if (errorInsert) throw errorInsert;

      setMostrandoForm(false);
      setNombreAvala('');
      setFechaAutorizacion('');
      setArchivo(null);
      recargar();
    } catch (err) {
      setErrorForm(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.vitales_autorizacion.titulo} — {paciente.nombre}</h2>
        <p className="panel-explicacion">{t.vitales_autorizacion.explicacion}</p>

        {estado === 'cargando' && <p className="estado-cargando">{t.comun.cargando}</p>}
        {estado === 'error' && <Alert variant="error">{error || t.comun.error_generico}</Alert>}

        {estado === 'listo' && (
          <>
            {autorizacion ? (
              <div className="panel-resultado-calculo">
                <Alert variant="info">{t.vitales_autorizacion.vigente}</Alert>
                <dl className="panel-detalle-lista">
                  <dt>{t.vitales_autorizacion.col_nombre_avala}</dt>
                  <dd>{autorizacion.nombre_avala}</dd>
                  <dt>{t.vitales_autorizacion.col_rol_avala}</dt>
                  <dd>{t.vitales_autorizacion[`rol_${autorizacion.rol_avala}`]}</dd>
                  <dt>{t.vitales_autorizacion.col_tipo_firma}</dt>
                  <dd>{t.vitales_autorizacion[`firma_${autorizacion.tipo_firma}`]}</dd>
                  <dt>{t.vitales_autorizacion.col_fecha}</dt>
                  <dd>{autorizacion.fecha_autorizacion}</dd>
                </dl>
                <Button variant="secondary" onClick={verArchivo} disabled={cargandoUrl}>
                  {cargandoUrl ? t.comun.cargando : t.vitales_autorizacion.ver_archivo}
                </Button>
              </div>
            ) : (
              <Alert variant="error">{t.vitales_autorizacion.sin_autorizacion}</Alert>
            )}

            {!mostrandoForm && (
              <div className="panel-modal-acciones">
                <Button onClick={() => setMostrandoForm(true)}>
                  {autorizacion ? t.vitales_autorizacion.renovar : t.vitales_autorizacion.cargar}
                </Button>
              </div>
            )}

            {mostrandoForm && (
              <div className="panel-resultado-calculo">
                <h3>{t.vitales_autorizacion.cargar}</h3>
                {errorForm && <Alert variant="error">{errorForm}</Alert>}
                <FormField label={t.vitales_autorizacion.col_nombre_avala} name="nombre_avala" value={nombreAvala} onChange={(e) => setNombreAvala(e.target.value)} required />
                <FormField label={t.vitales_autorizacion.col_rol_avala} name="rol_avala" type="select" value={rolAvala} onChange={(e) => setRolAvala(e.target.value)}>
                  <option value="profesional">{t.vitales_autorizacion.rol_profesional}</option>
                  <option value="familiar">{t.vitales_autorizacion.rol_familiar}</option>
                </FormField>
                <FormField label={t.vitales_autorizacion.col_tipo_firma} name="tipo_firma" type="select" value={tipoFirma} onChange={(e) => setTipoFirma(e.target.value)}>
                  <option value="digital">{t.vitales_autorizacion.firma_digital}</option>
                  <option value="fisica">{t.vitales_autorizacion.firma_fisica}</option>
                </FormField>
                <FormField label={t.vitales_autorizacion.col_fecha} name="fecha_autorizacion" type="date" value={fechaAutorizacion} onChange={(e) => setFechaAutorizacion(e.target.value)} required />
                <FormField
                  label={t.vitales_autorizacion.archivo_label}
                  name="archivo"
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  onChange={(e) => setArchivo(e.target.files?.[0] || null)}
                  required
                />
                <div className="panel-modal-acciones">
                  <Button variant="secondary" onClick={() => setMostrandoForm(false)} disabled={guardando}>
                    {t.comun.cancelar}
                  </Button>
                  <Button onClick={handleGuardar} disabled={guardando}>
                    {guardando ? t.comun.guardando : t.comun.guardar}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose}>
            {t.comun.cerrar}
          </Button>
        </div>
      </div>
    </div>
  );
}
