import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { supabase } from '../../lib/supabaseClient';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { traducirValor } from '../../i18n/valores';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';

/* A quién se le avisa y por dónde: los correos de cada evento, la casilla desde la
   que salen, el aviso de cese y todo lo de WhatsApp. */
export function ConfiguracionAvisos() {
  const { t } = useLocale();

  return (
    <>
      <h2>{t.configuracion.tab_notificaciones}</h2>
      <TabNotificaciones />
      <TabWhatsapp />
    </>
  );
}

const CATEGORIAS_PLANTILLA = ['utility', 'marketing', 'authentication'];

function TabNotificaciones() {
  const { t } = useLocale();
  const [notificaciones, setNotificaciones] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardandoEvento, setGuardandoEvento] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { notificaciones: filas } = await llamarApi('/notificaciones');
      setNotificaciones(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function set(evento, campo, valor) {
    setNotificaciones((filas) => filas.map((f) => (f.evento === evento ? { ...f, [campo]: valor } : f)));
  }

  async function guardar(fila) {
    setGuardandoEvento(fila.evento);
    setError(null);
    try {
      await llamarApi(`/notificaciones/${fila.evento}`, {
        method: 'PATCH',
        body: JSON.stringify({ emails: fila.emails, activo: fila.activo, whatsapp_activo: fila.whatsapp_activo, notificar_familia: fila.notificar_familia }),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoEvento(null);
    }
  }

  return (
    <>
      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && notificaciones.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.notificaciones_col_evento}</th>
              <th>{t.configuracion.notificaciones_col_emails}</th>
              <th>{t.configuracion.notificaciones_col_activo}</th>
              <th>{t.configuracion.notificaciones_col_whatsapp_activo}</th>
              <th>{t.configuracion.notificaciones_col_notificar_familia}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {notificaciones.map((fila) => (
              <tr key={fila.evento}>
                <td>{t.configuracion[`notificaciones_evento_${fila.evento}`] || fila.descripcion}</td>
                <td>
                  <input
                    type="text"
                    placeholder={t.configuracion.notificaciones_emails_placeholder}
                    value={(fila.emails || []).join(', ')}
                    onChange={(e) => set(fila.evento, 'emails', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                  />
                </td>
                <td>
                  <input type="checkbox" checked={fila.activo} onChange={(e) => set(fila.evento, 'activo', e.target.checked)} />
                </td>
                <td>
                  <input type="checkbox" checked={fila.whatsapp_activo || false} onChange={(e) => set(fila.evento, 'whatsapp_activo', e.target.checked)} />
                </td>
                <td>
                  {fila.evento === 'incidente_relevo_sin_resolver' && (
                    <input
                      type="checkbox"
                      checked={fila.notificar_familia || false}
                      title={t.configuracion.notificaciones_notificar_familia_ayuda}
                      onChange={(e) => set(fila.evento, 'notificar_familia', e.target.checked)}
                    />
                  )}
                </td>
                <td>
                  <button onClick={() => guardar(fila)} disabled={guardandoEvento === fila.evento}>
                    {guardandoEvento === fila.evento ? t.comun.guardando : t.comun.guardar}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>
      <TabAvisoCese />
      <TabAvisoGuardiaSinCubrir />
      <TabEmailRemitente />
    </>
  );
}

function TabEmailRemitente() {
  const { t } = useLocale();
  const [form, setForm] = useState(null);
  const [password, setPassword] = useState('');
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { emailRemitente } = await llamarApi('/email-remitente');
      setForm(emailRemitente);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function set(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setGuardado(false);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/email-remitente', {
        method: 'PATCH',
        body: JSON.stringify({
          activo: form.activo,
          direccion_remitente: form.direccion_remitente,
          usuario_smtp: form.usuario_smtp,
          host: form.host,
          puerto: form.puerto,
          password: password || undefined,
        }),
      });
      setPassword('');
      setGuardado(true);
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.email_remitente_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.email_remitente_explicacion}</p>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        {form && (
          <div>
            {error && <Alert variant="error">{error}</Alert>}
            {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
            <FormField
              label={t.configuracion.email_remitente_activo}
              name="activo"
              type="checkbox"
              checked={form.activo || false}
              onChange={(e) => set('activo', e.target.checked)}
            />
            <FormField label={t.configuracion.email_remitente_direccion} name="direccion_remitente" value={form.direccion_remitente || ''} onChange={(e) => set('direccion_remitente', e.target.value)} />
            <FormField label={t.configuracion.email_remitente_usuario_smtp} name="usuario_smtp" value={form.usuario_smtp || ''} onChange={(e) => set('usuario_smtp', e.target.value)} />
            <FormField label={t.configuracion.email_remitente_host} name="host" value={form.host || ''} onChange={(e) => set('host', e.target.value)} />
            <FormField label={t.configuracion.email_remitente_puerto} name="puerto" type="number" value={form.puerto || ''} onChange={(e) => set('puerto', Number(e.target.value))} />
            <FormField
              label={form.credencial_cargada ? t.configuracion.email_remitente_password_reemplazar : t.configuracion.email_remitente_password_cargar}
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button onClick={guardar} disabled={guardando}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
          </div>
        )}
      </EstadoLista>
    </div>
  );
}

function TabAvisoCese() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const [config, setConfig] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from('configuracion_aviso_cese_asistente')
      .select('*')
      .eq('prestadora_id', usuario.prestadora_id)
      .maybeSingle();
    if (errorConsulta) {
      setError(errorConsulta.message);
      setEstado('error');
      return;
    }
    setConfig(data ?? { activo: true, horas_plazo_aviso_verbal: 24 });
    setEstado('listo');
  }, [usuario.prestadora_id]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const { error: errorUpsert } = await supabase.from('configuracion_aviso_cese_asistente').upsert({
      prestadora_id: usuario.prestadora_id,
      activo: config.activo,
      horas_plazo_aviso_verbal: Number(config.horas_plazo_aviso_verbal),
    });
    setGuardando(false);
    if (errorUpsert) {
      setError(errorUpsert.message);
      return;
    }
    recargar();
  }

  return (
    <div>
      <h2>{t.configuracion.aviso_cese_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.aviso_cese_explicacion}</p>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        {config && (
          <div>
            {error && <Alert variant="error">{error}</Alert>}
            <FormField
              label={t.configuracion.aviso_cese_activo}
              name="aviso_cese_activo"
              type="checkbox"
              checked={config.activo}
              onChange={(e) => setConfig((c) => ({ ...c, activo: e.target.checked }))}
            />
            <FormField
              label={t.configuracion.aviso_cese_horas_plazo}
              name="aviso_cese_horas_plazo"
              type="number"
              value={config.horas_plazo_aviso_verbal}
              onChange={(e) => setConfig((c) => ({ ...c, horas_plazo_aviso_verbal: e.target.value }))}
            />
            <Button onClick={guardar} disabled={guardando}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
          </div>
        )}
      </EstadoLista>
    </div>
  );
}

// Los dos números del aviso de guardia sin cubrir (pendiente #106). Mismo camino que
// TabAvisoCese —el navegador escribe directo en la tabla y RLS decide si puede— en vez de
// una ruta nueva del backend: es la misma clase de dato y no hay motivo para dos caminos.
function TabAvisoGuardiaSinCubrir() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const [config, setConfig] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from('configuracion_aviso_guardia_sin_cubrir')
      .select('*')
      .eq('prestadora_id', usuario.prestadora_id)
      .maybeSingle();
    if (errorConsulta) {
      setError(errorConsulta.message);
      setEstado('error');
      return;
    }
    // Sin fila todavía, el formulario muestra los mismos valores de arranque que la base le
    // pone a una fila nueva. No es un número escrito acá: es lo que se va a guardar apenas
    // el usuario toque "Guardar", y el que manda sigue siendo el de la base.
    setConfig(data ?? { activo: true, horas_antes: 48, horas_entre_avisos: 12 });
    setEstado('listo');
  }, [usuario.prestadora_id]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const { error: errorUpsert } = await supabase.from('configuracion_aviso_guardia_sin_cubrir').upsert({
      prestadora_id: usuario.prestadora_id,
      activo: config.activo,
      horas_antes: Number(config.horas_antes),
      horas_entre_avisos: Number(config.horas_entre_avisos),
    });
    setGuardando(false);
    if (errorUpsert) {
      setError(errorUpsert.message);
      return;
    }
    recargar();
  }

  return (
    <div>
      <h2>{t.configuracion.aviso_guardia_sin_cubrir_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.aviso_guardia_sin_cubrir_explicacion}</p>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        {config && (
          <div>
            {error && <Alert variant="error">{error}</Alert>}
            <FormField
              label={t.configuracion.aviso_guardia_sin_cubrir_activo}
              name="aviso_guardia_sin_cubrir_activo"
              type="checkbox"
              checked={config.activo}
              onChange={(e) => setConfig((c) => ({ ...c, activo: e.target.checked }))}
            />
            <FormField
              label={t.configuracion.aviso_guardia_sin_cubrir_horas_antes}
              name="aviso_guardia_sin_cubrir_horas_antes"
              type="number"
              value={config.horas_antes}
              onChange={(e) => setConfig((c) => ({ ...c, horas_antes: e.target.value }))}
            />
            <FormField
              label={t.configuracion.aviso_guardia_sin_cubrir_horas_entre_avisos}
              name="aviso_guardia_sin_cubrir_horas_entre_avisos"
              type="number"
              value={config.horas_entre_avisos}
              onChange={(e) => setConfig((c) => ({ ...c, horas_entre_avisos: e.target.value }))}
            />
            <Button onClick={guardar} disabled={guardando}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
          </div>
        )}
      </EstadoLista>
    </div>
  );
}

function TabWhatsapp() {
  return (
    <div>
      <TabWhatsappCredenciales />
      <TabWhatsappPlantillas />
      <TabWhatsappEscaladaCoordinador />
    </div>
  );
}

function TabWhatsappCredenciales() {
  const { t } = useLocale();
  const [form, setForm] = useState(null);
  const [token, setToken] = useState('');
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { whatsapp } = await llamarApi('/whatsapp');
      setForm(whatsapp);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function set(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setGuardado(false);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/whatsapp', {
        method: 'PATCH',
        body: JSON.stringify({
          activo: form.activo,
          numero_telefono: form.numero_telefono,
          waba_id: form.waba_id,
          phone_number_id: form.phone_number_id,
          token: token || undefined,
        }),
      });
      setToken('');
      setGuardado(true);
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.whatsapp_credenciales_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.whatsapp_credenciales_explicacion}</p>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        {form && (
          <div>
            {error && <Alert variant="error">{error}</Alert>}
            {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
            <FormField
              label={t.configuracion.whatsapp_activo}
              name="activo"
              type="checkbox"
              checked={form.activo || false}
              onChange={(e) => set('activo', e.target.checked)}
            />
            <FormField label={t.configuracion.whatsapp_numero} name="numero_telefono" value={form.numero_telefono || ''} onChange={(e) => set('numero_telefono', e.target.value)} />
            <FormField label={t.configuracion.whatsapp_waba_id} name="waba_id" value={form.waba_id || ''} onChange={(e) => set('waba_id', e.target.value)} />
            <FormField label={t.configuracion.whatsapp_phone_number_id} name="phone_number_id" value={form.phone_number_id || ''} onChange={(e) => set('phone_number_id', e.target.value)} />
            <FormField
              label={form.token_cargado ? t.configuracion.whatsapp_token_reemplazar : t.configuracion.whatsapp_token_cargar}
              name="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <Button onClick={guardar} disabled={guardando}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
          </div>
        )}
      </EstadoLista>
    </div>
  );
}

function TabWhatsappPlantillas() {
  const { t } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();
  const [plantillas, setPlantillas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [creandoNueva, setCreandoNueva] = useState(false);
  const [actualizandoId, setActualizandoId] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { plantillas: filas } = await llamarApi('/whatsapp/plantillas');
      setPlantillas(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function marcarEnviadaMeta(fila) {
    setActualizandoId(fila.id);
    try {
      await llamarApi(`/whatsapp/plantillas/${fila.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: 'enviada_meta' }),
      });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoId(null);
    }
  }

  async function borrar(fila) {
    if (!(await confirmarDestructivo(t.configuracion.whatsapp_plantillas_confirmar_borrar))) return;
    setActualizandoId(fila.id);
    try {
      await llamarApi(`/whatsapp/plantillas/${fila.id}`, { method: 'DELETE' });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoId(null);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.whatsapp_plantillas_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.whatsapp_plantillas_explicacion}</p>
      {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}
      <div className="panel-filtros">
        <Button onClick={() => setCreandoNueva(true)}>{t.configuracion.whatsapp_plantillas_nueva}</Button>
      </div>
      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && plantillas.length === 0}
        recargar={recargar}
        mensajeVacio={t.configuracion.whatsapp_plantillas_vacio}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.whatsapp_plantillas_col_nombre}</th>
              <th>{t.configuracion.whatsapp_plantillas_col_categoria}</th>
              <th>{t.configuracion.whatsapp_plantillas_col_estado}</th>
              <th>{t.configuracion.whatsapp_plantillas_col_cuerpo}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {plantillas.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre_interno}</td>
                <td>{traducirValor(t.configuracion, `whatsapp_plantillas_categoria_${p.categoria}`)}</td>
                <td>{traducirValor(t.configuracion, `whatsapp_plantillas_estado_${p.estado}`)}</td>
                <td>{p.cuerpo_texto}</td>
                <td>
                  {p.estado === 'borrador' && (
                    <button onClick={() => marcarEnviadaMeta(p)} disabled={actualizandoId === p.id}>
                      {t.configuracion.whatsapp_plantillas_enviar_meta}
                    </button>
                  )}
                  <button onClick={() => borrar(p)} disabled={actualizandoId === p.id}>{t.comun.borrar}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {creandoNueva && (
        <NuevaPlantillaWhatsapp onClose={() => setCreandoNueva(false)} onCreada={() => { setCreandoNueva(false); recargar(); }} />
      )}
    </div>
  );
}

function NuevaPlantillaWhatsapp({ onClose, onCreada }) {
  const { t } = useLocale();
  const [nombreInterno, setNombreInterno] = useState('');
  const [categoria, setCategoria] = useState('utility');
  const [cuerpoTexto, setCuerpoTexto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function handleGuardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/whatsapp/plantillas', {
        method: 'POST',
        body: JSON.stringify({ nombre_interno: nombreInterno, categoria, cuerpo_texto: cuerpoTexto }),
      });
      onCreada();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.configuracion.whatsapp_plantillas_nueva}</h2>
        {error && <Alert variant="error">{error}</Alert>}
        <FormField label={t.configuracion.whatsapp_plantillas_col_nombre} name="nombre_interno" value={nombreInterno} onChange={(e) => setNombreInterno(e.target.value)} required />
        <FormField label={t.configuracion.whatsapp_plantillas_col_categoria} name="categoria" type="select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          {CATEGORIAS_PLANTILLA.map((c) => (
            <option key={c} value={c}>{traducirValor(t.configuracion, `whatsapp_plantillas_categoria_${c}`)}</option>
          ))}
        </FormField>
        <FormField label={t.configuracion.whatsapp_plantillas_col_cuerpo} name="cuerpo_texto" type="textarea" value={cuerpoTexto} onChange={(e) => setCuerpoTexto(e.target.value)} required />
        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>{t.comun.cancelar}</Button>
          <Button onClick={handleGuardar} disabled={guardando || !nombreInterno || !cuerpoTexto}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabWhatsappEscaladaCoordinador() {
  const { t } = useLocale();
  const [form, setForm] = useState(null);
  const [coordinadores, setCoordinadores] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const [{ escalada }, { data: usuariosData, error: errorUsuarios }] = await Promise.all([
        llamarApi('/escalada-coordinador'),
        supabase.from('usuarios').select('id, nombre').eq('rol', 'coordinador').order('nombre'),
      ]);
      if (errorUsuarios) throw errorUsuarios;
      setForm(escalada);
      setCoordinadores(usuariosData ?? []);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function set(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setGuardado(false);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/escalada-coordinador', {
        method: 'PATCH',
        body: JSON.stringify({
          coordinador_backup_id: form.coordinador_backup_id || null,
          minutos_antes_backup: Number(form.minutos_antes_backup),
          umbrales_premura: form.umbrales_premura,
          fase_automatica_activa: form.fase_automatica_activa,
          minutos_antes_fase_automatica: Number(form.minutos_antes_fase_automatica),
        }),
      });
      setGuardado(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.whatsapp_escalada_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.whatsapp_escalada_explicacion}</p>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        {form && (
          <div>
            {error && <Alert variant="error">{error}</Alert>}
            {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
            <FormField
              label={t.configuracion.whatsapp_escalada_backup}
              name="coordinador_backup_id"
              type="select"
              value={form.coordinador_backup_id || ''}
              onChange={(e) => set('coordinador_backup_id', e.target.value)}
            >
              <option value="">{t.configuracion.escalada_prioridad_vacio}</option>
              {coordinadores.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </FormField>
            <FormField
              label={t.configuracion.whatsapp_escalada_minutos_backup}
              name="minutos_antes_backup"
              type="number"
              value={form.minutos_antes_backup ?? ''}
              onChange={(e) => set('minutos_antes_backup', e.target.value)}
            />
            <FormField
              label={t.configuracion.whatsapp_escalada_fase_automatica}
              name="fase_automatica_activa"
              type="checkbox"
              checked={form.fase_automatica_activa || false}
              onChange={(e) => set('fase_automatica_activa', e.target.checked)}
            />
            <FormField
              label={t.configuracion.whatsapp_escalada_minutos_fase_automatica}
              name="minutos_antes_fase_automatica"
              type="number"
              value={form.minutos_antes_fase_automatica ?? ''}
              onChange={(e) => set('minutos_antes_fase_automatica', e.target.value)}
            />
            <Button onClick={guardar} disabled={guardando}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
          </div>
        )}
      </EstadoLista>
    </div>
  );
}
