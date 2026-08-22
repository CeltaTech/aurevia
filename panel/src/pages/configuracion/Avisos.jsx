import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { supabase } from '../../lib/supabaseClient';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { ordenarTramosPremura } from '../../lib/tramosPremura';
import { traducirValor } from '../../i18n/valores';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { useModalAccesible } from '../../hooks/useModalAccesible';
import { usePrestadoraActual } from '../../hooks/usePrestadoraActual';
import { con } from '../../lib/textos';

/* A quién se le avisa y por dónde: los correos de cada evento, la casilla desde la
   que salen, el aviso de cese, la revisión con inteligencia artificial y todo lo de
   WhatsApp. */
export function ConfiguracionAvisos() {
  const { t } = useLocale();

  return (
    <>
      <h2>{t.configuracion.tab_notificaciones}</h2>
      <TabNotificaciones />
      <TabAlertasIA />
      <TabWhatsapp />
    </>
  );
}

const CATEGORIAS_PLANTILLA = ['utility', 'marketing', 'authentication'];

/* La lista de avisos que se pueden prender y apagar.
   ==========================================================================

   El servidor devuelve TODOS los avisos que el producto sabe mandar, tenga o no tenga
   guardada la elección de esta Prestadora. Antes devolvía solo los guardados, y un aviso sin
   fila era invisible: existía, salía igual y no había forma de apagarlo desde acá.

   El nombre de cada aviso sale de las traducciones, nunca de la columna `descripcion` de la
   base, que está escrita en español y sola (CLAUDE.md §7 regla 1). Esa columna queda de
   respaldo por si algún día llega un aviso que las traducciones todavía no conocen: es
   preferible un renglón en español antes que un renglón en blanco.

   Y las dos casillas —avisar por WhatsApp, avisar también a la Familia— se dibujan según lo
   que el propio aviso dice de sí mismo (`admite_whatsapp`, `admite_familia`), no según una
   comparación con un nombre de aviso escrita acá adentro. */
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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

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
      setError(mensajeDeError(err, t));
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
            {notificaciones.map((fila) => {
              /* El nombre del evento se resuelve una sola vez: además de la primera celda, lo
                 llevan los tres controles de la fila, que sueltos dirían solo "Activo". */
              const nombreEvento = t.configuracion[`notificaciones_evento_${fila.evento}`] || fila.descripcion;
              return (
                <tr key={fila.evento}>
                  <td>{nombreEvento}</td>
                  <td>
                    <input
                      type="text"
                      placeholder={t.configuracion.notificaciones_emails_placeholder}
                      value={(fila.emails || []).join(', ')}
                      onChange={(e) => set(fila.evento, 'emails', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                      aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.notificaciones_col_emails, nombre: nombreEvento })}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={fila.activo}
                      onChange={(e) => set(fila.evento, 'activo', e.target.checked)}
                      aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.notificaciones_col_activo, nombre: nombreEvento })}
                    />
                  </td>
                  <td>
                    {fila.admite_whatsapp
                      ? (
                        <input
                          type="checkbox"
                          checked={fila.whatsapp_activo || false}
                          onChange={(e) => set(fila.evento, 'whatsapp_activo', e.target.checked)}
                          aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.notificaciones_col_whatsapp_activo, nombre: nombreEvento })}
                        />
                      )
                      : <span className="panel-dato-vacio" title={t.configuracion.notificaciones_canal_no_disponible}>—</span>}
                  </td>
                  <td>
                    {fila.admite_familia
                      ? (
                        <input
                          type="checkbox"
                          checked={fila.notificar_familia || false}
                          title={t.configuracion.notificaciones_notificar_familia_ayuda}
                          onChange={(e) => set(fila.evento, 'notificar_familia', e.target.checked)}
                          aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.notificaciones_col_notificar_familia, nombre: nombreEvento })}
                        />
                      )
                      : <span className="panel-dato-vacio" title={t.configuracion.notificaciones_canal_no_disponible}>—</span>}
                  </td>
                  <td>
                    <button onClick={() => guardar(fila)} disabled={guardandoEvento === fila.evento}>
                      {guardandoEvento === fila.evento ? t.comun.guardando : t.comun.guardar}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </EstadoLista>
      <TabAvisoCese />
      <TabAvisoGuardiaSinCubrir />
      <TabAvisoPrevioGuardia />
      <TabEmailRemitente />
    </>
  );
}

/* Cuánto antes se le recuerda a la Asistente su próxima guardia.
   ==========================================================================

   Estaba escrito fijo en una hora para todas las Prestadoras, y una hora no le sirve a todas:
   quien trabaja con guardias de doce horas quiere avisar la noche anterior. */
function TabAvisoPrevioGuardia() {
  const { t } = useLocale();
  const [minutos, setMinutos] = useState('');
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { minutos_aviso_previo_guardia } = await llamarApi('/aviso-previo-guardia');
      setMinutos(minutos_aviso_previo_guardia);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/aviso-previo-guardia', {
        method: 'PATCH',
        body: JSON.stringify({ minutos: Number(minutos) }),
      });
      setGuardado(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.aviso_previo_guardia_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.aviso_previo_guardia_explicacion}</p>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        <div>
          {error && <Alert variant="error">{error}</Alert>}
          {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
          <FormField
            label={t.configuracion.aviso_previo_guardia_minutos}
            name="minutos_aviso_previo_guardia"
            type="number"
            value={minutos}
            onChange={(e) => { setMinutos(e.target.value); setGuardado(false); }}
          />
          <Button onClick={guardar} disabled={guardando}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
        </div>
      </EstadoLista>
    </div>
  );
}

/* La revisión de los reportes con inteligencia artificial.
   ==========================================================================

   Todo esto estaba escrito fijo adentro del programa: cuántos reportes se miraban, y a quién
   le llegaba cada nivel de alerta. Las palabras clave existían en la base pero no tenían
   pantalla, así que la única forma de cambiarlas era entrar a la base a mano.

   Lo único que no se elige: una alerta roja siempre le llega al Coordinador. Si la revisión
   encontró algo urgente sobre un Paciente, alguien de la Prestadora tiene que enterarse. */
function TabAlertasIA() {
  const { t } = useLocale();
  const [form, setForm] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { configuracion } = await llamarApi('/alertas-ia');
      setForm(configuracion);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

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
      await llamarApi('/alertas-ia', {
        method: 'PATCH',
        body: JSON.stringify({
          palabras_clave: form.palabras_clave ?? [],
          reportes_a_analizar: Number(form.reportes_a_analizar),
          roja_avisa_familia: form.roja_avisa_familia,
          amarilla_avisa_familia: form.amarilla_avisa_familia,
          amarilla_avisa_coordinador: form.amarilla_avisa_coordinador,
        }),
      });
      setGuardado(true);
      recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.alertas_ia_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.alertas_ia_explicacion}</p>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        {form && (
          <div>
            {error && <Alert variant="error">{error}</Alert>}
            {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
            <FormField
              label={t.configuracion.alertas_ia_palabras_clave}
              name="palabras_clave"
              value={(form.palabras_clave ?? []).join(', ')}
              placeholder={t.configuracion.alertas_ia_palabras_clave_placeholder}
              ayuda={t.configuracion.alertas_ia_palabras_clave_ayuda}
              onChange={(e) => set('palabras_clave', e.target.value.split(',').map((p) => p.trim()).filter(Boolean))}
            />
            <FormField
              label={t.configuracion.alertas_ia_reportes_a_analizar}
              name="reportes_a_analizar"
              type="number"
              value={form.reportes_a_analizar ?? ''}
              ayuda={t.configuracion.alertas_ia_reportes_a_analizar_ayuda}
              onChange={(e) => set('reportes_a_analizar', e.target.value)}
            />
            <p className="panel-explicacion">{t.configuracion.alertas_ia_roja_siempre_coordinador}</p>
            <FormField
              label={t.configuracion.alertas_ia_roja_avisa_familia}
              name="roja_avisa_familia"
              type="checkbox"
              checked={form.roja_avisa_familia || false}
              onChange={(e) => set('roja_avisa_familia', e.target.checked)}
            />
            <FormField
              label={t.configuracion.alertas_ia_amarilla_avisa_coordinador}
              name="amarilla_avisa_coordinador"
              type="checkbox"
              checked={form.amarilla_avisa_coordinador || false}
              onChange={(e) => set('amarilla_avisa_coordinador', e.target.checked)}
            />
            <FormField
              label={t.configuracion.alertas_ia_amarilla_avisa_familia}
              name="amarilla_avisa_familia"
              type="checkbox"
              checked={form.amarilla_avisa_familia || false}
              onChange={(e) => set('amarilla_avisa_familia', e.target.checked)}
            />
            <Button onClick={guardar} disabled={guardando}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
          </div>
        )}
      </EstadoLista>
    </div>
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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

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
      setError(mensajeDeError(err, t));
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
  const prestadoraId = usePrestadoraActual();
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
      .eq('prestadora_id', prestadoraId)
      .maybeSingle();
    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }
    setConfig(data ?? { activo: true, horas_plazo_aviso_verbal: 24 });
    setEstado('listo');
  }, [prestadoraId, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const { error: errorUpsert } = await supabase.from('configuracion_aviso_cese_asistente').upsert({
      prestadora_id: prestadoraId,
      activo: config.activo,
      horas_plazo_aviso_verbal: Number(config.horas_plazo_aviso_verbal),
    });
    setGuardando(false);
    if (errorUpsert) {
      setError(mensajeDeError(errorUpsert, t));
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
  const prestadoraId = usePrestadoraActual();
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
      .eq('prestadora_id', prestadoraId)
      .maybeSingle();
    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }
    // Sin fila todavía, el formulario muestra los mismos valores de arranque que la base le
    // pone a una fila nueva. No es un número escrito acá: es lo que se va a guardar apenas
    // el usuario toque "Guardar", y el que manda sigue siendo el de la base.
    setConfig(data ?? { activo: true, horas_antes: 48, horas_entre_avisos: 12 });
    setEstado('listo');
  }, [prestadoraId, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const { error: errorUpsert } = await supabase.from('configuracion_aviso_guardia_sin_cubrir').upsert({
      prestadora_id: prestadoraId,
      activo: config.activo,
      horas_antes: Number(config.horas_antes),
      horas_entre_avisos: Number(config.horas_entre_avisos),
    });
    setGuardando(false);
    if (errorUpsert) {
      setError(mensajeDeError(errorUpsert, t));
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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

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
      setError(mensajeDeError(err, t));
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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

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
      setError(mensajeDeError(err, t));
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
      setError(mensajeDeError(err, t));
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
  const modal = useModalAccesible(onClose);
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
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.configuracion.whatsapp_plantillas_nueva}</h2>
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

/* El tope de la espera del aviso de guardia sin cerrar: un día entero, escrito como lo que es.
   Más allá de un día el aviso deja de avisar —la guardia ya lleva una jornada abierta y nadie
   se enteró—, y la base rechaza igual cualquier número que se pase. Se comprueba también acá
   para que quien administra la Prestadora lea qué se esperaba en vez de una falla del sistema.
   El valor con el que arranca la espera no está escrito en ninguna parte del Panel: llega de
   la base con el resto de la configuración (`CLAUDE.md` §7, regla 1). */
const MINUTOS_DE_UN_DIA = 24 * 60;

const esperaGuardiaSinCerrarValida = (valor) => {
  const minutos = Number(valor);
  return Number.isInteger(minutos) && minutos > 0 && minutos <= MINUTOS_DE_UN_DIA;
};

/* El tope de la espera antes de que ese mismo aviso escale: tres días enteros. Más allá de
   ahí ya no hay nada que escalar, porque una guardia que lleva tres días abierta significa
   una Familia que hace tres días no sabe si a su Paciente lo cuidaron. La base rechaza igual
   cualquier número que se pase; se comprueba también acá por el mismo motivo que la espera de
   arriba, para que se lea qué se esperaba en vez de una falla del sistema. El valor con el
   que arranca llega de la base con el resto de la configuración (`CLAUDE.md` §7, regla 1). */
const HORAS_DE_TRES_DIAS = 72;

const escaladaGraveSinCerrarValida = (valor) => {
  const horas = Number(valor);
  return Number.isInteger(horas) && horas > 0 && horas <= HORAS_DE_TRES_DIAS;
};

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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function set(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setGuardado(false);
  }

  async function guardar() {
    // Nada se manda con una espera imposible: sin ella el aviso de guardia sin cerrar no
    // llegaría nunca, que es justo lo que no puede pasar.
    if (!esperaGuardiaSinCerrarValida(form.minutos_gracia_cierre_guardia)) {
      setGuardado(false);
      setError(con(t.configuracion.whatsapp_escalada_minutos_guardia_sin_cerrar_invalido, { maximo: MINUTOS_DE_UN_DIA }));
      return;
    }
    // Ni con una escalada imposible: pasado ese plazo el aviso sale una vez más, por el evento
    // `guardia_sin_cerrar_grave`, hacia quien la Prestadora haya puesto en su propia lista de
    // destinatarios — la gente con autoridad para resolverlo. Si el plazo no llega nunca, esa
    // segunda salida tampoco.
    if (!escaladaGraveSinCerrarValida(form.horas_antes_aviso_grave_sin_cerrar)) {
      setGuardado(false);
      setError(con(t.configuracion.whatsapp_escalada_horas_guardia_sin_cerrar_grave_invalido, { maximo: HORAS_DE_TRES_DIAS }));
      return;
    }
    setGuardando(true);
    setError(null);
    // Se ordenan antes de mandarlos: el motor lee la lista de arriba hacia abajo y se
    // queda con el primer tramo que le sirve, así que un tramo fuera de orden no se
    // alcanza nunca. Y el servidor además la rechaza si llega desordenada.
    const ordenados = ordenarTramosPremura(form.umbrales_premura);
    try {
      await llamarApi('/escalada-coordinador', {
        method: 'PATCH',
        body: JSON.stringify({
          coordinador_backup_id: form.coordinador_backup_id || null,
          minutos_antes_backup: Number(form.minutos_antes_backup),
          umbrales_premura: ordenados,
          fase_automatica_activa: form.fase_automatica_activa,
          minutos_antes_fase_automatica: Number(form.minutos_antes_fase_automatica),
          minutos_gracia_cierre_guardia: Number(form.minutos_gracia_cierre_guardia),
          horas_antes_aviso_grave_sin_cerrar: Number(form.horas_antes_aviso_grave_sin_cerrar),
        }),
      });
      // La pantalla se queda con la lista tal como quedó guardada, no como se tipeó: si
      // alguien puso un tramo fuera de lugar, lo ve en su sitio sin tener que recargar.
      setForm((f) => ({ ...f, umbrales_premura: ordenados }));
      setGuardado(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
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
            <EditorTramosPremura tramos={form.umbrales_premura ?? []} onCambiar={(tramos) => set('umbrales_premura', tramos)} />
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
            <FormField
              label={t.configuracion.whatsapp_escalada_minutos_guardia_sin_cerrar}
              name="minutos_gracia_cierre_guardia"
              type="number"
              value={form.minutos_gracia_cierre_guardia ?? ''}
              onChange={(e) => set('minutos_gracia_cierre_guardia', e.target.value)}
            />
            <FormField
              label={t.configuracion.whatsapp_escalada_horas_guardia_sin_cerrar_grave}
              name="horas_antes_aviso_grave_sin_cerrar"
              type="number"
              value={form.horas_antes_aviso_grave_sin_cerrar ?? ''}
              onChange={(e) => set('horas_antes_aviso_grave_sin_cerrar', e.target.value)}
            />
            <Button onClick={guardar} disabled={guardando}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
          </div>
        )}
      </EstadoLista>
    </div>
  );
}

/* Los tramos con los que se le insiste al Coordinador.
   ==========================================================================

   Cada tramo dice una frase: "mientras no pasen más de X minutos desde que se detectó el
   problema, volvé a avisarle cada Y minutos". El último no lleva un "hasta": vale de ahí en
   adelante, y es el que evita que un incidente viejo se quede sin ningún intervalo.

   Estos números ya se guardaban, pero no había forma de escribirlos desde el Panel: llegaban
   del servidor, viajaban de vuelta sin que nadie los mirara y solo se podían cambiar entrando
   a la base a mano.

   El renglón de abajo es siempre el abierto. Agregar un tramo lo mete arriba de ese; quitar
   el último convierte en abierto al que queda de última. */
function EditorTramosPremura({ tramos, onCambiar }) {
  const { t } = useLocale();
  const lista = tramos.length > 0 ? tramos : [{ maximo_minutos: null, intervalo_minutos: 60 }];

  function cambiar(indice, campo, valor) {
    onCambiar(lista.map((tramo, i) => (i === indice ? { ...tramo, [campo]: valor } : tramo)));
  }

  function agregar() {
    const anteUltimo = lista.length >= 2 ? lista[lista.length - 2] : null;
    const nuevoMaximo = Number(anteUltimo?.maximo_minutos ?? 0) + 60;
    const nuevo = { maximo_minutos: nuevoMaximo, intervalo_minutos: 30 };
    onCambiar([...lista.slice(0, -1), nuevo, lista[lista.length - 1]]);
  }

  function quitar(indice) {
    const quedan = lista.filter((_, i) => i !== indice);
    if (quedan.length === 0) return;
    // El de abajo siempre es el abierto: si se fue el que estaba abierto, se abre el nuevo último.
    return onCambiar(quedan.map((tramo, i) => (i === quedan.length - 1 ? { ...tramo, maximo_minutos: null } : tramo)));
  }

  return (
    <div>
      <h3>{t.configuracion.premura_titulo}</h3>
      <p className="panel-explicacion">{t.configuracion.premura_explicacion}</p>
      <div className="panel-tramos">
        {lista.map((tramo, indice) => {
          const esUltimo = indice === lista.length - 1;
          return (
            <div className="panel-tramo" key={indice}>
              {esUltimo
                ? <span>{t.configuracion.premura_de_ahi_en_adelante}</span>
                : (
                  <>
                    <span>{t.configuracion.premura_hasta}</span>
                    <input
                      type="number"
                      aria-label={t.configuracion.premura_hasta}
                      value={tramo.maximo_minutos ?? ''}
                      onChange={(e) => cambiar(indice, 'maximo_minutos', e.target.value)}
                    />
                    <span>{t.configuracion.premura_minutos}</span>
                  </>
                )}
              <span>{t.configuracion.premura_avisar_cada}</span>
              <input
                type="number"
                aria-label={t.configuracion.premura_avisar_cada}
                value={tramo.intervalo_minutos ?? ''}
                onChange={(e) => cambiar(indice, 'intervalo_minutos', e.target.value)}
              />
              <span>{t.configuracion.premura_minutos}</span>
              {lista.length > 1 && (
                <Button variant="secondary" onClick={() => quitar(indice)}>{t.comun.borrar}</Button>
              )}
            </div>
          );
        })}
      </div>
      <Button variant="secondary" onClick={agregar}>{t.configuracion.premura_agregar_tramo}</Button>
    </div>
  );
}
