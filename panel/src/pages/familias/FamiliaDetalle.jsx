import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { usePermisos } from '../../context/PermisosContext';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { esAdminOSuperior } from '../../lib/roles';
import { linkWhatsapp } from '../../lib/telefono';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { PrestacionesPaciente } from './PrestacionesPaciente';
import { EditarPacienteModal } from './EditarPacienteModal';
import { NuevoPacienteModal } from './NuevoPacienteModal';
import { MonitoreoVitalesPaciente } from './MonitoreoVitalesPaciente';
import { DomiciliosTemporalesPaciente } from './DomiciliosTemporalesPaciente';
import { InvitarCirculoModal } from './InvitarCirculoModal';
import {
  AlertasDeLaFamilia,
  GuardiasActivasDeLaFamilia,
  ReportesDeLaFamilia,
} from './GuardiasReportesYAlertas';
import {
  AccesosDelCirculoModal,
  DocumentoDeLaInstruccion,
  RegistrarPapelFirmadoModal,
} from './AccesosDelCirculoModal';
import { mensajeDeError } from '../../lib/errores';
import { llamarApiPanel } from '../../lib/apiPanel';
import { con } from '../../lib/textos';

const API_URL = import.meta.env.VITE_API_URL;

/* Qué ve, en una línea, cada persona del círculo.
   ==========================================================================

   La tabla no tiene lugar para once casillas por renglón, y tampoco hace falta: lo que la
   Prestadora necesita de un vistazo es si esa persona ve todo, no ve nada, o ve una parte. El
   detalle está a un clic, en la ventana de accesos.

   Se cuenta sobre lo que manda el motor y no sobre una lista escrita acá, así que una casilla
   nueva del catálogo cambia sola el «7 de 11» sin tocar esta pantalla. */
function resumenDeAccesos(accesos, t) {
  const total = accesos?.length ?? 0;
  // Todavía no llegó el detalle: mejor un guion que un «0 de 0», que se leería como «no ve
  // nada» justo cuando lo que pasa es que no se sabe.
  if (!total) return '—';

  const permitidos = accesos.filter((acceso) => acceso.permitido).length;
  if (permitidos === total) return t.familias.circulo.accesos_todo;
  if (permitidos === 0) return t.familias.circulo.accesos_ninguno;
  return con(t.familias.circulo.accesos_parcial, { n: permitidos, total });
}

export function FamiliaDetalle() {
  const { t } = useLocale();
  const { id } = useParams();
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const { puede } = usePermisos();
  const confirmarDestructivo = useConfirmarDestructivo();
  const esAdmin = esAdminOSuperior(usuario?.rol);
  const puedeEditarFamilia = esAdmin || puede('editar_datos_familia');
  const puedeEditarPaciente = esAdmin || puede('editar_datos_paciente');
  const [familia, setFamilia] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [pacienteSeleccionado, setPacienteSeleccionado] = useState(null);
  const [pacienteParaVitales, setPacienteParaVitales] = useState(null);
  const [pacienteParaDomicilios, setPacienteParaDomicilios] = useState(null);
  const [pacienteAEditar, setPacienteAEditar] = useState(null);
  const [mostrarNuevoPaciente, setMostrarNuevoPaciente] = useState(false);
  const [formContacto, setFormContacto] = useState(null);
  const [guardandoContacto, setGuardandoContacto] = useState(false);
  const [errorContacto, setErrorContacto] = useState(null);
  const [contactoGuardado, setContactoGuardado] = useState(false);
  const [circulo, setCirculo] = useState(null);
  const [estadoCirculo, setEstadoCirculo] = useState('cargando');
  const [errorCirculo, setErrorCirculo] = useState(null);
  const [instruccionPendiente, setInstruccionPendiente] = useState(null);
  const [ultimaInstruccion, setUltimaInstruccion] = useState(null);
  const [mostrarInvitarCirculo, setMostrarInvitarCirculo] = useState(false);
  // Guarda a quién se estaba mirando al abrir la ventana de accesos, para que esa persona
  // quede a la vista. `null` es la ventana cerrada.
  const [accesosDe, setAccesosDe] = useState(null);
  const [documentoAVer, setDocumentoAVer] = useState(null);
  const [papelAConfirmar, setPapelAConfirmar] = useState(null);
  const [quitandoUsuarioId, setQuitandoUsuarioId] = useState(null);
  const [reenviandoUsuarioId, setReenviandoUsuarioId] = useState(null);
  const [mensajeReenvio, setMensajeReenvio] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from('familias')
      .select('id, plan, solicitud_id, created_at, solicitudes!familias_solicitud_id_fkey(nombre, telefono, email, localidad), pacientes(*)')
      .eq('id', id)
      .single();

    if (errorConsulta) {
      setError(errorConsulta.code === 'PGRST116' ? null : mensajeDeError(errorConsulta, t));
      setEstado(errorConsulta.code === 'PGRST116' ? 'no_encontrado' : 'error');
      return;
    }

    setFamilia(data);
    setFormContacto({
      nombre: data.solicitudes?.nombre || '',
      telefono: data.solicitudes?.telefono || '',
      email: data.solicitudes?.email || '',
      localidad: data.solicitudes?.localidad || '',
      plan: data.plan || '',
    });
    setEstado('listo');
  }, [id, t]);

  const recargarCirculo = useCallback(async () => {
    setEstadoCirculo('cargando');
    setErrorCirculo(null);
    try {
      // Por el único camino del Panel hacia el motor: es el que hace viajar el número de la
      // respuesta adentro del error, y sin ese número todo falla igual —una sesión vencida se
      // vería como «ocurrió un error»—.
      const resultado = await llamarApiPanel(`/cuentas/familia/${id}/circulo`);
      const miembros = resultado.miembros ?? [];
      setCirculo(miembros);
      setInstruccionPendiente(resultado.instruccionPendiente ?? null);
      setUltimaInstruccion(resultado.ultimaInstruccion ?? null);
      setEstadoCirculo(miembros.length ? 'listo' : 'vacio');
    } catch (err) {
      setErrorCirculo(mensajeDeError(err, t));
      setEstadoCirculo('error');
    }
  }, [id, t]);

  useEffect(() => {
    recargar();
    recargarCirculo();
  }, [recargar, recargarCirculo]);

  async function quitarMiembroCirculo(usuarioId) {
    if (!(await confirmarDestructivo(t.familias.circulo.quitar_confirmacion))) {
      return;
    }
    setQuitandoUsuarioId(usuarioId);
    try {
      const { data } = await supabase.auth.getSession();
      const respuesta = await fetch(`${API_URL}/api/panel/cuentas/familia/${id}/circulo/${usuarioId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${data.session?.access_token}` },
      });
      const resultado = await respuesta.json();
      if (!respuesta.ok) {
        throw new Error(resultado.error || t.familias.circulo.quitar_error);
      }
      recargarCirculo();
    } catch (err) {
      setErrorCirculo(mensajeDeError(err, t));
    } finally {
      setQuitandoUsuarioId(null);
    }
  }

  async function reenviarInvitacion(usuarioId) {
    setReenviandoUsuarioId(usuarioId);
    setMensajeReenvio(null);
    try {
      const { data } = await supabase.auth.getSession();
      const respuesta = await fetch(`${API_URL}/api/panel/cuentas/${usuarioId}/reenviar-activacion`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${data.session?.access_token}` },
      });
      const resultado = await respuesta.json();
      if (!respuesta.ok) {
        throw new Error(resultado.error);
      }
      setMensajeReenvio({ tipo: 'info', texto: t.comun.invitacion_reenviada });
    } catch {
      setMensajeReenvio({ tipo: 'error', texto: t.comun.reenviar_invitacion_error });
    } finally {
      setReenviandoUsuarioId(null);
    }
  }

  function setCampoContacto(campo, valor) {
    setFormContacto((f) => ({ ...f, [campo]: valor }));
    setContactoGuardado(false);
  }

  async function guardarContacto() {
    setGuardandoContacto(true);
    setErrorContacto(null);
    const { nombre, telefono, email, localidad, plan } = formContacto;
    const [{ error: errorSolicitud }, { error: errorFamilia }] = await Promise.all([
      familia.solicitud_id
        ? supabase.from('solicitudes').update({ nombre, telefono, email, localidad }).eq('id', familia.solicitud_id)
        : Promise.resolve({ error: null }),
      supabase.from('familias').update({ plan }).eq('id', familia.id),
    ]);
    setGuardandoContacto(false);
    if (errorSolicitud || errorFamilia) {
      setErrorContacto(t.comun.error_generico);
      return;
    }
    setContactoGuardado(true);
    recargar();
  }

  if (estado === 'cargando') return <p className="estado-cargando">{t.comun.cargando}</p>;
  if (estado === 'no_encontrado') return <p className="estado-vacio">{t.comun.no_encontrado}</p>;
  if (estado === 'error') return <p className="estado-vacio">{error || t.comun.error_generico}</p>;

  return (
    <div>
      <button className="link-volver" onClick={() => navigate('/familias')}><span aria-hidden="true">←</span> {t.familias.volver_a_familias}</button>
      <h1>{familia.solicitudes?.nombre || '—'}</h1>

      <h2>{t.familias.contacto}</h2>
      {errorContacto && <Alert variant="error">{errorContacto}</Alert>}
      {contactoGuardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
      {mensajeReenvio && <Alert variant={mensajeReenvio.tipo}>{mensajeReenvio.texto}</Alert>}
      {formContacto && (
        <>
          <FormField label={t.familias.col_nombre} name="nombre_contacto" value={formContacto.nombre} onChange={(e) => setCampoContacto('nombre', e.target.value)} disabled={!puedeEditarFamilia} />
          <FormField label={t.familias.col_telefono} name="telefono_contacto" value={formContacto.telefono} onChange={(e) => setCampoContacto('telefono', e.target.value)} disabled={!puedeEditarFamilia} />
          {formContacto.telefono && (
            <p className="panel-explicacion">
              <a href={linkWhatsapp(formContacto.telefono)} target="_blank" rel="noreferrer">{t.familias.abrir_whatsapp}</a>
            </p>
          )}
          <FormField label={t.familias.col_email} name="email_contacto" type="email" value={formContacto.email} onChange={(e) => setCampoContacto('email', e.target.value)} disabled={!puedeEditarFamilia} />
          <FormField label={t.familias.col_localidad} name="localidad_contacto" value={formContacto.localidad} onChange={(e) => setCampoContacto('localidad', e.target.value)} disabled={!puedeEditarFamilia} />
          <FormField label={t.familias.plan} name="plan_contacto" value={formContacto.plan} onChange={(e) => setCampoContacto('plan', e.target.value)} disabled={!puedeEditarFamilia} />
          <dl className="panel-detalle-lista">
            <dt>{t.familias.col_fecha_alta}</dt>
            <dd>{new Date(familia.created_at).toLocaleDateString()}</dd>
          </dl>
          <Button onClick={guardarContacto} disabled={guardandoContacto || !puedeEditarFamilia}>
            {guardandoContacto ? t.comun.guardando : t.comun.guardar}
          </Button>{' '}
          {puedeEditarFamilia && (
            <Button variant="secondary" onClick={() => reenviarInvitacion(familia.id)} disabled={reenviandoUsuarioId === familia.id}>
              {reenviandoUsuarioId === familia.id ? t.comun.reenviando_invitacion : t.comun.reenviar_invitacion}
            </Button>
          )}
        </>
      )}

      <h2>{t.familias.pacientes}</h2>
      {familia.pacientes?.length ? (
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.familias.col_nombre}</th>
              <th>{t.familias.fecha_nacimiento}</th>
              <th>{t.familias.nivel_complejidad}</th>
              <th>{t.familias.domicilio}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {familia.pacientes.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td>{p.fecha_nacimiento || '—'}</td>
                <td>{p.nivel_complejidad || '—'}</td>
                <td>{p.domicilio || '—'}</td>
                <td>
                  {puedeEditarPaciente && (
                    <>
                      <Button variant="secondary" onClick={() => setPacienteAEditar(p)}>
                        {t.comun.editar}
                      </Button>{' '}
                    </>
                  )}
                  <Button variant="secondary" onClick={() => setPacienteSeleccionado(p)}>
                    {t.prestaciones.titulo}
                  </Button>{' '}
                  <Button variant="secondary" onClick={() => setPacienteParaVitales(p)}>
                    {t.vitales_autorizacion.titulo}
                  </Button>{' '}
                  <Button variant="secondary" onClick={() => setPacienteParaDomicilios(p)}>
                    {t.domicilios_temporales.titulo}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="estado-vacio">{t.familias.sin_pacientes}</p>
      )}
      {puedeEditarPaciente && (
        <Button variant="secondary" onClick={() => setMostrarNuevoPaciente(true)}>
          {t.familias.agregar_paciente}
        </Button>
      )}

      <h2>{t.familias.circulo.titulo}</h2>
      <p className="panel-explicacion">{t.familias.circulo.descripcion}</p>

      {/* La instrucción cargada y todavía sin firmar es lo primero que hay que ver: mientras
          no esté firmada, lo que hay es un pedido anotado, no una autorización. Los dos
          caminos de cierre están acá al lado —imprimir el papel, o registrar que ya volvió
          firmado—, porque son lo único que queda por hacer. */}
      {instruccionPendiente && (
        <Alert variant="warning">
          {con(t.familias.circulo.instruccion_pendiente, {
            fecha: new Date(instruccionPendiente.created_at).toLocaleDateString(),
          })}{' '}
          <Button variant="secondary" onClick={() => setDocumentoAVer(instruccionPendiente)}>
            {t.familias.circulo.ver_documento}
          </Button>{' '}
          {puedeEditarFamilia && (
            <Button variant="secondary" onClick={() => setPapelAConfirmar(instruccionPendiente)}>
              {t.familias.circulo.registrar_papel}
            </Button>
          )}
        </Alert>
      )}
      {!instruccionPendiente && ultimaInstruccion && (
        <p className="panel-explicacion">
          {con(t.familias.circulo.ultima_instruccion, {
            fecha: new Date(ultimaInstruccion.cerrada_en || ultimaInstruccion.created_at).toLocaleDateString(),
            como: t.familias.circulo[`cerrada_${ultimaInstruccion.cerrada_como}`] || '',
          })}
        </p>
      )}
      {!instruccionPendiente && !ultimaInstruccion && estadoCirculo === 'listo' && (
        <p className="panel-explicacion">{t.familias.circulo.sin_instruccion}</p>
      )}

      {estadoCirculo === 'cargando' && <p className="estado-cargando">{t.comun.cargando}</p>}
      {estadoCirculo === 'error' && <p className="estado-vacio">{errorCirculo || t.comun.error_generico}</p>}
      {estadoCirculo === 'vacio' && <p className="estado-vacio">{t.familias.circulo.sin_miembros}</p>}
      {estadoCirculo === 'listo' && (
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.familias.circulo.col_nombre}</th>
              <th>{t.familias.circulo.col_email}</th>
              <th>{t.familias.circulo.col_que_ve}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {circulo.map((m) => (
              <tr key={m.usuarioId}>
                <td>{m.nombre || '—'}</td>
                <td>{m.email || '—'}</td>
                <td>{resumenDeAccesos(m.accesos, t)}</td>
                <td>
                  <Button
                    variant="secondary"
                    onClick={() => setAccesosDe(m.usuarioId)}
                    aria-label={con(t.comun.campo_de_fila, {
                      campo: t.familias.circulo.accesos_boton,
                      nombre: m.nombre || m.email || '',
                    })}
                  >
                    {t.familias.circulo.accesos_boton}
                  </Button>{' '}
                  {puedeEditarFamilia && (
                    <>
                      <Button
                        variant="secondary"
                        onClick={() => reenviarInvitacion(m.usuarioId)}
                        disabled={reenviandoUsuarioId === m.usuarioId}
                      >
                        {reenviandoUsuarioId === m.usuarioId ? t.comun.reenviando_invitacion : t.comun.reenviar_invitacion}
                      </Button>{' '}
                      <Button
                        variant="secondary"
                        onClick={() => quitarMiembroCirculo(m.usuarioId)}
                        disabled={quitandoUsuarioId === m.usuarioId}
                      >
                        {t.familias.circulo.quitar}
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {errorCirculo && estadoCirculo === 'listo' && <Alert variant="error">{errorCirculo}</Alert>}
      {puedeEditarFamilia && (
        <Button variant="secondary" onClick={() => setMostrarInvitarCirculo(true)}>
          {t.familias.circulo.agregar}
        </Button>
      )}

      {/* Las tres secciones traen sus propios datos y manejan sus propios cuatro estados; viven
          en `GuardiasReportesYAlertas.jsx` y hacen las mismas preguntas que las pantallas de
          Guardias, Reportes y Alertas, acotadas a los Pacientes de esta Familia. */}
      <h2>{t.familias.guardias_activas}</h2>
      <GuardiasActivasDeLaFamilia pacientes={familia.pacientes} />

      <h2>{t.familias.historial_reportes}</h2>
      <ReportesDeLaFamilia pacientes={familia.pacientes} />

      <h2>{t.familias.alertas_activas}</h2>
      <AlertasDeLaFamilia pacientes={familia.pacientes} />

      {pacienteSeleccionado && (
        <PrestacionesPaciente paciente={pacienteSeleccionado} onClose={() => setPacienteSeleccionado(null)} />
      )}

      {pacienteParaVitales && (
        <MonitoreoVitalesPaciente paciente={pacienteParaVitales} onClose={() => setPacienteParaVitales(null)} />
      )}

      {pacienteParaDomicilios && (
        <DomiciliosTemporalesPaciente
          paciente={pacienteParaDomicilios}
          puedeEditar={puedeEditarPaciente}
          onClose={() => setPacienteParaDomicilios(null)}
        />
      )}

      {pacienteAEditar && (
        <EditarPacienteModal
          paciente={pacienteAEditar}
          onClose={() => setPacienteAEditar(null)}
          onGuardado={() => {
            setPacienteAEditar(null);
            recargar();
          }}
        />
      )}

      {mostrarNuevoPaciente && (
        <NuevoPacienteModal
          familiaId={familia.id}
          onClose={() => setMostrarNuevoPaciente(false)}
          onCreado={() => {
            setMostrarNuevoPaciente(false);
            recargar();
          }}
        />
      )}

      {mostrarInvitarCirculo && (
        <InvitarCirculoModal
          familiaId={familia.id}
          onClose={() => setMostrarInvitarCirculo(false)}
          onInvitado={() => {
            setMostrarInvitarCirculo(false);
            recargarCirculo();
          }}
        />
      )}

      {accesosDe && (
        <AccesosDelCirculoModal
          familiaId={familia.id}
          miembros={circulo}
          puedeEditar={puedeEditarFamilia}
          usuarioIdInicial={accesosDe}
          onClose={() => setAccesosDe(null)}
          onGuardado={() => {
            setAccesosDe(null);
            recargarCirculo();
          }}
        />
      )}

      {documentoAVer && (
        <DocumentoDeLaInstruccion
          texto={documentoAVer.documento_texto}
          fecha={documentoAVer.created_at}
          onCerrar={() => setDocumentoAVer(null)}
        />
      )}

      {papelAConfirmar && (
        <RegistrarPapelFirmadoModal
          familiaId={familia.id}
          instruccionId={papelAConfirmar.id}
          onClose={() => setPapelAConfirmar(null)}
          onRegistrado={() => {
            setPapelAConfirmar(null);
            recargarCirculo();
          }}
        />
      )}
    </div>
  );
}
