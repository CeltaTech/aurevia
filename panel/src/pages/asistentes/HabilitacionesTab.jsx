import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';

const API_URL = import.meta.env.VITE_API_URL;

async function llamarApi(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/medicacion${path}`, {
    ...opciones,
    headers: {
      ...(opciones.body && !(opciones.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${data.session?.access_token}`,
      ...opciones.headers,
    },
  });
  const resultado = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw new Error(resultado.error || 'Error de red');
  return resultado;
}

function estaVigente(fila) {
  const hoy = new Date().toISOString().slice(0, 10);
  return !fila.vigente_hasta || fila.vigente_hasta >= hoy;
}

export function HabilitacionesTab({ asistente }) {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const [habilitaciones, setHabilitaciones] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [mostrarNueva, setMostrarNueva] = useState(false);
  const [revocandoId, setRevocandoId] = useState(null);
  const [abriendoId, setAbriendoId] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from('habilitaciones_asistente')
      .select('*')
      .eq('asistente_id', asistente.id)
      .order('vigente_desde', { ascending: false });
    if (errorConsulta) {
      setError(errorConsulta.message);
      setEstado('error');
      return;
    }
    setHabilitaciones(data ?? []);
    setEstado('listo');
  }, [asistente.id]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function revocar(fila) {
    setRevocandoId(fila.id);
    setError(null);
    const { error: errorUpdate } = await supabase
      .from('habilitaciones_asistente')
      .update({ vigente_hasta: new Date().toISOString().slice(0, 10) })
      .eq('id', fila.id);
    setRevocandoId(null);
    if (errorUpdate) {
      setError(t.comun.error_generico);
      return;
    }
    recargar();
  }

  async function verArchivo(fila) {
    setAbriendoId(fila.id);
    setError(null);
    try {
      const { url } = await llamarApi(`/archivo-url?ruta=${encodeURIComponent(fila.archivo_url)}`);
      window.open(url, '_blank', 'noreferrer');
    } catch {
      setError(t.comun.error_generico);
    } finally {
      setAbriendoId(null);
    }
  }

  return (
    <div>
      <h2>{t.asistentes.habilitaciones.titulo}</h2>
      <p className="panel-explicacion">{t.asistentes.habilitaciones.explicacion}</p>
      {error && <Alert variant="error">{error}</Alert>}

      <div className="panel-filtros">
        <Button onClick={() => setMostrarNueva(true)}>{t.asistentes.habilitaciones.nueva}</Button>
      </div>

      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && habilitaciones.length === 0} recargar={recargar} mensajeVacio={t.asistentes.habilitaciones.sin_habilitaciones}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.asistentes.habilitaciones.col_tipo}</th>
              <th>{t.asistentes.habilitaciones.col_matricula}</th>
              <th>{t.asistentes.habilitaciones.col_desde}</th>
              <th>{t.asistentes.habilitaciones.col_hasta}</th>
              <th>{t.asistentes.habilitaciones.col_estado}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {habilitaciones.map((fila) => {
              const vigente = estaVigente(fila);
              return (
                <tr key={fila.id}>
                  <td>{fila.tipo}</td>
                  <td>{fila.numero_matricula || '—'}</td>
                  <td>{fila.vigente_desde}</td>
                  <td>{fila.vigente_hasta || '—'}</td>
                  <td>
                    <span className={`badge ${vigente ? 'badge-verde' : ''}`}>
                      {vigente ? t.asistentes.habilitaciones.estado_vigente : t.asistentes.habilitaciones.estado_historico}
                    </span>
                  </td>
                  <td>
                    {fila.archivo_url && (
                      <>
                        <button onClick={() => verArchivo(fila)} disabled={abriendoId === fila.id}>
                          {t.asistentes.habilitaciones.ver_archivo}
                        </button>{' '}
                      </>
                    )}
                    {vigente && (
                      <button onClick={() => revocar(fila)} disabled={revocandoId === fila.id}>
                        {revocandoId === fila.id ? t.comun.guardando : t.asistentes.habilitaciones.revocar}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </EstadoLista>

      {mostrarNueva && (
        <NuevaHabilitacionModal
          asistente={asistente}
          usuario={usuario}
          onClose={() => setMostrarNueva(false)}
          onCreada={() => {
            setMostrarNueva(false);
            recargar();
          }}
        />
      )}
    </div>
  );
}

function NuevaHabilitacionModal({ asistente, usuario, onClose, onCreada }) {
  const { t } = useLocale();
  const [tipo, setTipo] = useState('');
  const [numeroMatricula, setNumeroMatricula] = useState('');
  const [vigenteDesde, setVigenteDesde] = useState('');
  const [archivo, setArchivo] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function handleGuardar() {
    setGuardando(true);
    setError(null);
    try {
      let archivoUrl = null;
      if (archivo) {
        const formData = new FormData();
        formData.append('archivo', archivo);
        const resultado = await llamarApi(`/habilitaciones/${asistente.id}/archivo`, { method: 'POST', body: formData });
        archivoUrl = resultado.archivoUrl;
      }
      const { error: errorInsert } = await supabase.from('habilitaciones_asistente').insert({
        asistente_id: asistente.id,
        tipo,
        numero_matricula: numeroMatricula || null,
        vigente_desde: vigenteDesde,
        archivo_url: archivoUrl,
        registrado_por: usuario.id,
      });
      if (errorInsert) throw new Error(errorInsert.message);
      onCreada();
    } catch (err) {
      setError(err.message || t.comun.error_generico);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.asistentes.habilitaciones.nueva}</h2>
        {error && <Alert variant="error">{error}</Alert>}
        <FormField
          label={t.asistentes.habilitaciones.col_tipo}
          name="tipo"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
          placeholder={t.asistentes.habilitaciones.tipo_placeholder}
          required
        />
        <FormField label={t.asistentes.habilitaciones.col_matricula} name="numero_matricula" value={numeroMatricula} onChange={(e) => setNumeroMatricula(e.target.value)} />
        <FormField label={t.asistentes.habilitaciones.col_desde} name="vigente_desde" type="date" value={vigenteDesde} onChange={(e) => setVigenteDesde(e.target.value)} required />
        <label>{t.asistentes.habilitaciones.archivo}</label>
        <input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(e) => setArchivo(e.target.files?.[0] || null)} />
        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>{t.comun.cancelar}</Button>
          <Button onClick={handleGuardar} disabled={guardando || !tipo || !vigenteDesde}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}
