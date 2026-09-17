import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { useAuth } from '../../context/AuthContext';
import { esAdminDePrestadora } from '../../lib/roles';
import { supabase } from '../../lib/supabaseClient';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { DIRECCION_DEL_MOTOR } from '../../lib/apiPanel';
import { ordenarTramosPremura } from '../../lib/tramosPremura';
import { MINUTOS_QUE_SE_PUEDEN_TOCAR, ordenDeLaEscalada } from '../../lib/ordenDeLaEscalada';
import { traducirValor } from '../../i18n/valores';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { useModalAccesible } from '../../hooks/useModalAccesible';
import { usePrestadoraActual } from '../../hooks/usePrestadoraActual';
import { con } from '../../lib/textos';
import { REGLA_QUE_SE_PUEDE_TOCAR } from '../../lib/alarmasTomadas';

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
  const [plantillas, setPlantillas] = useState([]);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { notificaciones: filas } = await llamarApi('/notificaciones');
      setNotificaciones(filas);
      /* Las plantillas aprobadas son las que se pueden elegir. Un aviso que la Prestadora empieza
         Meta lo entrega solamente con una de ellas, así que ofrecerle las demás sería ofrecerle
         mensajes que no van a salir. Si la consulta falla, la pantalla igual sirve para todo lo
         demás y el selector queda vacío. */
      const { plantillas: todas } = await llamarApi('/whatsapp/plantillas').catch(() => ({ plantillas: [] }));
      setPlantillas((todas ?? []).filter((p) => p.estado === 'aprobada'));
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
        body: JSON.stringify({
          emails: fila.emails,
          activo: fila.activo,
          whatsapp_activo: fila.whatsapp_activo,
          notificar_familia: fila.notificar_familia,
          plantilla_whatsapp_id: fila.plantilla_whatsapp_id || null,
        }),
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
              <th>{t.configuracion.notificaciones_col_plantilla_whatsapp}</th>
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
                    {/* Un aviso que la persona está esperando para poder seguir no se apaga, así
                        que no se le dibuja la casilla: ofrecerla sería ofrecer algo que no ocurre. */}
                    {fila.se_puede_apagar === false
                      ? <span className="panel-dato-vacio" title={t.configuracion.notificaciones_no_se_apaga}>—</span>
                      : (
                        <input
                          type="checkbox"
                          checked={fila.activo}
                          onChange={(e) => set(fila.evento, 'activo', e.target.checked)}
                          aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.notificaciones_col_activo, nombre: nombreEvento })}
                        />
                      )}
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
                    {fila.admite_whatsapp
                      ? (
                        <select
                          value={fila.plantilla_whatsapp_id || ''}
                          onChange={(e) => set(fila.evento, 'plantilla_whatsapp_id', e.target.value || null)}
                          aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.notificaciones_col_plantilla_whatsapp, nombre: nombreEvento })}
                        >
                          <option value="">{t.configuracion.notificaciones_plantilla_sin_elegir}</option>
                          {plantillas.map((p) => (
                            <option key={p.id} value={p.id}>{p.nombre_interno}</option>
                          ))}
                        </select>
                      )
                      : null}
                    {/* La casilla encendida sin plantilla elegida no manda nada: se dice acá y no
                        después, cuando el aviso ya salió por correo sin que nadie entienda por qué. */}
                    {fila.admite_whatsapp && fila.whatsapp_activo && !fila.plantilla_whatsapp_id
                      ? <div className="panel-explicacion">{t.configuracion.notificaciones_plantilla_falta}</div>
                      : null}
                    {!fila.admite_whatsapp
                      ? <span className="panel-dato-vacio" title={t.configuracion.notificaciones_canal_no_disponible}>—</span>
                      : null}
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
      <TabCorreoDeLaPrestadora />
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

/* Desde dónde manda esta Prestadora, y adónde vuelven las respuestas.
   ==========================================================================

   Acá no se pide ningún servidor de correo ni ninguna contraseña. Los avisos de todas las
   Prestadoras salen por el mismo despachante, y lo propio de cada una es la dirección: la suya,
   que le queda fijada cuando se la da de alta.

   Esa dirección **sólo manda**. Quien conteste un aviso le estaría escribiendo a un buzón que no
   existe, así que lo que entra ahí se reenvía a la casilla que se elige en este formulario, y es
   lo único que hay para elegir.

   Las dos cosas que pueden haber salido mal se dicen acá y nunca por correo, porque lo que falló
   es justamente el correo: que esta Prestadora no tenga dirección propia —y entonces manda desde
   la común—, y que el reenvío no esté abierto —y entonces las respuestas se pierden—. Hay una
   tercera que no es una falla y se parece: que la casilla exista y todavía le falte el clic con
   el que su dueño confirma que acepta recibir ahí. */
function TabCorreoDeLaPrestadora() {
  const { t } = useLocale();
  const [correo, setCorreo] = useState(null);
  const [casilla, setCasilla] = useState('');
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { correo: leido } = await llamarApi('/correo');
      setCorreo(leido);
      setCasilla(leido?.email_respuestas || '');
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  // El motor contesta el estado nuevo, así que no hace falta volver a preguntárselo: guardar la
  // casilla mueve el reenvío, y lo que hay que mostrar después es cómo quedó ese movimiento.
  async function guardar() {
    setGuardando(true);
    setError(null);
    setGuardado(false);
    try {
      const { correo: comoQuedo } = await llamarApi('/correo', {
        method: 'PATCH',
        body: JSON.stringify({ email_respuestas: casilla.trim() }),
      });
      setCorreo(comoQuedo);
      setCasilla(comoQuedo?.email_respuestas || '');
      setGuardado(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.correo_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.correo_explicacion}</p>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        {correo && (
          <div>
            {error && <Alert variant="error">{error}</Alert>}

            <p>
              <strong>{t.configuracion.correo_salen_desde}</strong>{' '}
              {correo.direccion_envio || t.configuracion.correo_direccion_comun}
            </p>
            {!correo.direccion_envio && (
              <Alert variant="warning">{t.configuracion.correo_sin_direccion_propia}</Alert>
            )}

            <FormField
              label={t.configuracion.correo_respuestas}
              name="email_respuestas"
              type="email"
              value={casilla}
              ayuda={t.configuracion.correo_respuestas_ayuda}
              onChange={(e) => {
                setCasilla(e.target.value);
                setGuardado(false);
              }}
            />

            {!correo.servicio_configurado && (
              <Alert variant="warning">{t.configuracion.correo_servicio_sin_configurar}</Alert>
            )}
            {correo.servicio_configurado && !correo.reenvio_abierto && (
              <Alert variant="error">{t.configuracion.correo_reenvio_cerrado}</Alert>
            )}
            {correo.servicio_configurado && correo.reenvio_abierto && !correo.respuestas_confirmadas && (
              <Alert variant="warning">{t.configuracion.correo_falta_confirmar}</Alert>
            )}
            {correo.servicio_configurado && correo.reenvio_abierto && correo.respuestas_confirmadas && (
              <Alert variant="info">{t.configuracion.correo_respuestas_llegan}</Alert>
            )}

            {guardado && <Alert variant="info">{t.configuracion.correo_guardado}</Alert>}
            <Button onClick={guardar} disabled={guardando || !casilla.trim()}>
              {guardando ? t.comun.guardando : t.comun.guardar}
            </Button>
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

/* Todo lo de WhatsApp, con una parte que no es para cualquiera de los que entran acá.
   ==========================================================================

   Las plantillas y la escalada al Coordinador son configuración: quien administra la
   Prestadora las toca, y Superadmin también, porque es quien da soporte. Las credenciales no:
   son las claves con las que esta Prestadora habla con Meta, y Superadmin es un rol técnico de
   CeltaTech. La sesión de soporte técnico tampoco lo habilita.

   Quien decide de verdad es el motor (`backend/src/routes/panelConfiguracion.js`, las dos rutas
   `/whatsapp`): escribiendo la dirección a mano se llega igual, y ahí se niega. Esto de acá es
   para que no se le muestre a Superadmin un formulario que no va a poder guardar, y para que
   entienda por qué no lo ve — una pantalla que esconde algo sin decirlo se lee como una falla
   del sistema. */
function TabWhatsapp() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const puedeVerLasCredenciales = esAdminDePrestadora(usuario?.rol);

  return (
    <div>
      {puedeVerLasCredenciales ? (
        <TabWhatsappCredenciales />
      ) : (
        <div>
          <h2>{t.configuracion.whatsapp_credenciales_titulo}</h2>
          <Alert variant="info">{t.configuracion.whatsapp_credenciales_solo_admin}</Alert>
        </div>
      )}
      <TabWhatsappPlantillas />
      <TabWhatsappEscaladaCoordinador />
    </div>
  );
}

/* Las credenciales de la cuenta de Meta de esta Prestadora.
   ==========================================================================

   Son cinco datos y no tres (pendiente #165). A los que identifican la cuenta —número, WABA,
   identificador del número— y al token con el que el motor manda mensajes, se les suman los dos
   con los que el motor **le cree a un mensaje que entra**: el secreto de la aplicación, con el
   que Meta firma cada aviso, y el token de verificación del saludo inicial. Ese último era
   antes una sola variable de entorno para todo el producto: el mismo texto para todas las
   Prestadoras, así que quien lo supiera de una lo sabía de todas. Ahora es de cada una y se
   carga acá.

   Los tres secretos se guardan cifrados y no vuelven a mostrarse: de cada uno la pantalla sabe
   solamente si está cargado o no, y el campo dice si va a crearlo o a reemplazarlo. */
function TabWhatsappCredenciales() {
  const { t } = useLocale();
  const [form, setForm] = useState(null);
  const [token, setToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
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
          app_secret: appSecret || undefined,
          verify_token: verifyToken || undefined,
        }),
      });
      setToken('');
      setAppSecret('');
      setVerifyToken('');
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
            <FormField
              label={form.app_secret_cargado ? t.configuracion.whatsapp_app_secret_reemplazar : t.configuracion.whatsapp_app_secret_cargar}
              name="app_secret"
              type="password"
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              ayuda={t.configuracion.whatsapp_app_secret_ayuda}
            />
            <FormField
              label={form.verify_token_cargado ? t.configuracion.whatsapp_verify_token_reemplazar : t.configuracion.whatsapp_verify_token_cargar}
              name="verify_token"
              type="password"
              value={verifyToken}
              onChange={(e) => setVerifyToken(e.target.value)}
              ayuda={t.configuracion.whatsapp_verify_token_ayuda}
            />
            {/* La dirección que hay que pegar en el panel de Meta. Es distinta para cada
                Prestadora —el identificador va adentro—, y esa es justamente la razón por la
                que un aviso de una no puede entrar por la puerta de otra. Se muestra sola, sin
                poder editarse: no es un dato que se cargue, es uno que se copia. */}
            <FormField
              label={t.configuracion.whatsapp_direccion_webhook}
              name="direccion_webhook"
              value={`${DIRECCION_DEL_MOTOR}/api/whatsapp-webhook/${form.prestadora_id}`}
              readOnly
              ayuda={t.configuracion.whatsapp_direccion_webhook_ayuda}
            />
            {/* Sin los dos secretos cargados, el motor rechaza todo lo que entre por esa
                dirección. Es el comportamiento correcto, pero desde afuera se ve como que
                WhatsApp no anda, así que se dice acá antes de que alguien lo averigüe. */}
            {form.activo && !(form.app_secret_cargado && form.verify_token_cargado) && (
              <Alert variant="error">{t.configuracion.whatsapp_entrada_sin_secretos}</Alert>
            )}
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
  const [consultando, setConsultando] = useState(false);
  const [corrigiendo, setCorrigiendo] = useState(null);
  const [aplicando, setAplicando] = useState(false);

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

  // El alta de la plantilla en Meta la hace el motor, que es el único lado que tiene el token de
  // la Prestadora. Acá no se elige ningún estado: el que quede lo escribe lo que Meta conteste.
  async function enviarAMeta(fila) {
    setActualizandoId(fila.id);
    setError(null);
    try {
      await llamarApi(`/whatsapp/plantillas/${fila.id}/enviar-a-meta`, { method: 'POST' });
      recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setActualizandoId(null);
    }
  }

  // Meta revisa las plantillas a su tiempo y avisa sola cuando termina. Esto es para mirar ahora
  // mismo, y para cuando ese aviso no llegó: se le pregunta por todas juntas y se recarga.
  async function consultarAMeta() {
    setConsultando(true);
    setError(null);
    try {
      await llamarApi('/whatsapp/plantillas/consultar-a-meta', { method: 'POST' });
      recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setConsultando(false);
    }
  }

  // La IA lee lo que Meta objetó y propone otro texto. Acá no se guarda nada: la propuesta se
  // muestra, y quien coordina decide si la usa.
  async function corregirConIA(fila) {
    setActualizandoId(fila.id);
    setError(null);
    try {
      const { propuesta } = await llamarApi(`/whatsapp/plantillas/${fila.id}/corregir`, { method: 'POST' });
      setCorrigiendo({ plantilla: fila, propuesta });
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setActualizandoId(null);
    }
  }

  async function aplicarCorreccion() {
    setAplicando(true);
    setError(null);
    try {
      await llamarApi(`/whatsapp/plantillas/${corrigiendo.plantilla.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ cuerpo_texto: corrigiendo.propuesta.cuerpo }),
      });
      setCorrigiendo(null);
      recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setAplicando(false);
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
        <Button variant="secondary" onClick={consultarAMeta} disabled={consultando}>
          {t.configuracion.whatsapp_plantillas_consultar_meta}
        </Button>
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
                <td>
                  {traducirValor(t.configuracion, `whatsapp_plantillas_estado_${p.estado}`)}
                  {/* Lo que objetó Meta, tal como lo dijo. Sin esto, «rechazada» no dice qué
                      corregir y la plantilla se vuelve a mandar igual. */}
                  {p.motivo_rechazo && (
                    <div className="panel-explicacion">
                      {t.configuracion.whatsapp_plantillas_motivo_rechazo}: {p.motivo_rechazo}
                    </div>
                  )}
                </td>
                <td>{p.cuerpo_texto}</td>
                <td>
                  {p.estado === 'borrador' && (
                    <button onClick={() => enviarAMeta(p)} disabled={actualizandoId === p.id}>
                      {t.configuracion.whatsapp_plantillas_enviar_meta}
                    </button>
                  )}
                  {p.motivo_rechazo && (
                    <button onClick={() => corregirConIA(p)} disabled={actualizandoId === p.id}>
                      {t.configuracion.whatsapp_plantillas_corregir_ia}
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

      {corrigiendo && (
        <CorreccionDeLaIA
          plantilla={corrigiendo.plantilla}
          propuesta={corrigiendo.propuesta}
          aplicando={aplicando}
          onAplicar={aplicarCorreccion}
          onClose={() => setCorrigiendo(null)}
        />
      )}
    </div>
  );
}

/* Lo que la IA dice además del texto: qué se completa en cada hueco, y una línea con lo que
   conviene mirar antes de mandarlo a Meta. Sin los huecos a la vista, el texto llega con
   `{{1}}` y `{{2}}` y nadie sabe qué va adentro de cada uno. */
function QueDijoLaIA({ propuesta }) {
  const { t } = useLocale();
  if (!propuesta) return null;

  return (
    <div className="panel-explicacion">
      {propuesta.nota && <p>{propuesta.nota}</p>}
      {propuesta.huecos?.length > 0 && (
        <ul>
          {propuesta.huecos.map((hueco, i) => (
            <li key={i}>{con(t.configuracion.whatsapp_plantillas_hueco, { numero: i + 1, que: hueco })}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* La corrección de una plantilla que Meta rechazó. Se muestra el texto propuesto y no se guarda
   solo: quien coordina lo lee y decide. El botón de usarlo aparece únicamente mientras la
   plantilla es un borrador, que es lo único que el motor deja editar — el texto de una plantilla
   que ya salió no se cambia de este lado sin que Meta se entere. */
function CorreccionDeLaIA({ plantilla, propuesta, aplicando, onAplicar, onClose }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.configuracion.whatsapp_plantillas_correccion_titulo}</h2>
        <p className="panel-explicacion">
          {t.configuracion.whatsapp_plantillas_motivo_rechazo}: {plantilla.motivo_rechazo}
        </p>
        <p>{propuesta.cuerpo}</p>
        <QueDijoLaIA propuesta={propuesta} />
        {plantilla.estado !== 'borrador' && (
          <Alert variant="info">{t.configuracion.whatsapp_plantillas_correccion_no_se_aplica}</Alert>
        )}
        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={aplicando}>{t.comun.cerrar}</Button>
          {plantilla.estado === 'borrador' && (
            <Button onClick={onAplicar} disabled={aplicando}>
              {aplicando ? t.comun.guardando : t.configuracion.whatsapp_plantillas_correccion_usar}
            </Button>
          )}
        </div>
      </div>
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
  const [proposito, setProposito] = useState('');
  const [redactando, setRedactando] = useState(false);
  const [propuesta, setPropuesta] = useState(null);

  async function redactarConIA() {
    setRedactando(true);
    setError(null);
    try {
      const { propuesta: escrita } = await llamarApi('/whatsapp/plantillas/redactar', {
        method: 'POST',
        body: JSON.stringify({ proposito, categoria }),
      });
      setCuerpoTexto(escrita.cuerpo);
      setPropuesta(escrita);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setRedactando(false);
    }
  }

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
        {/* La IA escribe el texto a partir de para qué es el mensaje. Lo que devuelve entra en el
            cuadro de abajo, que se sigue pudiendo editar: la plantilla sale hacia Meta cuando la
            aprueba quien coordina, nunca sola. */}
        <FormField
          label={t.configuracion.whatsapp_plantillas_proposito}
          name="proposito"
          type="textarea"
          value={proposito}
          onChange={(e) => setProposito(e.target.value)}
          placeholder={t.configuracion.whatsapp_plantillas_proposito_ejemplo}
        />
        <Button variant="secondary" onClick={redactarConIA} disabled={redactando || !proposito.trim()}>
          {redactando ? t.configuracion.whatsapp_plantillas_redactando : t.configuracion.whatsapp_plantillas_redactar_ia}
        </Button>
        <FormField label={t.configuracion.whatsapp_plantillas_col_cuerpo} name="cuerpo_texto" type="textarea" value={cuerpoTexto} onChange={(e) => setCuerpoTexto(e.target.value)} required />
        <QueDijoLaIA propuesta={propuesta} />
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

/* El campo vacío apaga ese escalón, y apagarlo es una decisión válida: no hay un interruptor
   aparte. Por eso vacío pasa la revisión y sale como nulo hacia el motor. */
const minutosDeEscalonValidos = (valor, campo) => {
  if (valor === null || valor === undefined || valor === '') return true;
  const { minimo, maximo } = MINUTOS_QUE_SE_PUEDEN_TOCAR[campo];
  const minutos = Number(valor);
  return Number.isInteger(minutos) && minutos >= minimo && minutos <= maximo;
};

const enNumeroOApagado = (valor) =>
  valor === null || valor === undefined || valor === '' ? null : Number(valor);

/* Lo que se acaba de configurar, dicho en orden.

   Los tres escalones no se ordenan eligiendo un orden: se ordenan solos, según el minuto que
   lleve cada uno, que es lo que pedía el PRD —que dependa de la premura y no sea igual para todas
   las Prestadoras—. El problema es que así quien lo configura carga dos números sueltos y no ve
   lo que armó. Esto se lo muestra, y se recalcula mientras escribe. */
function EscaladaEnOrden({ form }) {
  const { t } = useLocale();

  const pasos = ordenDeLaEscalada({
    coordinadorBackupId: form.coordinador_backup_id,
    minutosAntesBackup: form.minutos_antes_backup,
    faseAutomaticaActiva: form.fase_automatica_activa,
    minutosAntesFaseAutomatica: form.minutos_antes_fase_automatica,
    minutosAntesTodosLosCoordinadores: form.minutos_antes_todos_los_coordinadores,
    minutosAntesAdministracion: form.minutos_antes_administracion,
  });

  const cuando = (minuto) => {
    if (minuto === null) return t.configuracion.escalada_orden_sin_minuto;
    if (minuto <= 0) return t.configuracion.escalada_orden_desde_el_inicio;
    return con(t.configuracion.escalada_orden_a_los_minutos, { minutos: minuto });
  };

  return (
    <div>
      <h3>{t.configuracion.escalada_orden_titulo}</h3>
      <p className="panel-explicacion">{t.configuracion.escalada_orden_explicacion}</p>
      <ol>
        {pasos.map((paso) => (
          <li key={paso.clave}>
            <strong>{cuando(paso.minuto)}</strong>
            {' — '}
            {t.configuracion[`escalada_orden_${paso.clave}`]}
          </li>
        ))}
      </ol>
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
      /* La lista de Coordinadores llega con la configuración, del motor. Antes se pedía acá
         mismo a la tabla `usuarios`, y esa tabla deja que cada persona lea su propia fila y
         ninguna otra: la lista volvía vacía y el desplegable del Coordinador de respaldo
         aparecía sin nadie adentro, así que no se podía elegir a nadie. Es el mismo reparto
         que ya usaba Configuración › Permisos. */
      const { escalada, coordinadores: coordinadoresData } = await llamarApi('/escalada-coordinador');
      setForm(escalada);
      setCoordinadores(coordinadoresData ?? []);
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
    // Los dos escalones de arriba se apagan dejando el campo vacío. Vacío está bien; lo que no
    // se manda es un número fuera de los bordes, que la base rechazaría con un error suyo.
    const fueraDeBorde = [
      'minutos_antes_todos_los_coordinadores',
      'minutos_antes_administracion',
    ].find((campo) => !minutosDeEscalonValidos(form[campo], campo));
    if (fueraDeBorde) {
      setGuardado(false);
      setError(
        con(t.configuracion.whatsapp_escalada_minutos_escalon_invalido, MINUTOS_QUE_SE_PUEDEN_TOCAR[fueraDeBorde])
      );
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
          minutos_antes_todos_los_coordinadores: enNumeroOApagado(form.minutos_antes_todos_los_coordinadores),
          minutos_antes_administracion: enNumeroOApagado(form.minutos_antes_administracion),
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
              label={t.configuracion.whatsapp_escalada_minutos_todos_los_coordinadores}
              name="minutos_antes_todos_los_coordinadores"
              type="number"
              value={form.minutos_antes_todos_los_coordinadores ?? ''}
              onChange={(e) => set('minutos_antes_todos_los_coordinadores', e.target.value)}
              ayuda={t.configuracion.whatsapp_escalada_minutos_todos_los_coordinadores_ayuda}
            />
            <FormField
              label={t.configuracion.whatsapp_escalada_minutos_administracion}
              name="minutos_antes_administracion"
              type="number"
              value={form.minutos_antes_administracion ?? ''}
              onChange={(e) => set('minutos_antes_administracion', e.target.value)}
              ayuda={t.configuracion.whatsapp_escalada_minutos_administracion_ayuda}
            />
            <EscaladaEnOrden form={form} />
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
      <CuantoDuraTomarUnaAlarma />
    </div>
  );
}

/* CUÁNTO DURA HACERSE CARGO DE UNA ALARMA.
   ==========================================================================

   Va acá abajo y no en una pantalla propia porque es el otro lado de lo de arriba: arriba se
   decide cada cuánto se insiste, acá cuánto se deja de insistir cuando alguien dijo que la está
   atendiendo. Son un solo tema leído desde los dos lados.

   ES UN SOLO NÚMERO Y NO APAGA NADA. Cuando el rato se cumple, la alarma vuelve como si nadie la
   hubiera tomado. Por eso el número tiene borde por arriba y por abajo, y los dos están escritos
   en `lib/alarmasTomadas.js`, que es el mismo archivo que usa el motor. */
function CuantoDuraTomarUnaAlarma() {
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
      const { configuracion } = await llamarApi('/alarmas-tomadas');
      setMinutos(String(configuracion.regla.minutos_que_dura_hacerse_cargo));
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
      await llamarApi('/alarmas-tomadas', {
        method: 'PUT',
        body: JSON.stringify({ regla: { minutos_que_dura_hacerse_cargo: Number(minutos) } }),
      });
      setGuardado(true);
    } catch (err) {
      setGuardado(false);
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  const borde = REGLA_QUE_SE_PUEDE_TOCAR.minutos_que_dura_hacerse_cargo;

  return (
    <div>
      <h2>{t.configuracion.tomar_alarma_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.tomar_alarma_explicacion}</p>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        <div>
          {error && <Alert variant="error">{error}</Alert>}
          {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
          <FormField
            label={t.configuracion.tomar_alarma_minutos}
            name="minutos_que_dura_hacerse_cargo"
            type="number"
            min={borde.minimo}
            max={borde.maximo}
            value={minutos}
            ayuda={con(t.configuracion.tomar_alarma_minutos_ayuda, { minimo: borde.minimo, maximo: borde.maximo })}
            onChange={(e) => {
              setMinutos(e.target.value);
              setGuardado(false);
            }}
          />
          <Button onClick={guardar} disabled={guardando}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
        </div>
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
