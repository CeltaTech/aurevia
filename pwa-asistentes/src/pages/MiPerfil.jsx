import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { mensajeDeError } from '../lib/errores';
import { activarPush, desactivarPush, pushSoportado, suscripcionActual } from '../lib/push';
import { traducirValor } from '../i18n/valores';
import { nombreTipo } from '../lib/tipoDeAsistente';
import Matricula from '../components/Matricula';
import Consentimientos from '../components/Consentimientos';

export default function MiPerfil() {
  const { t } = useLocale();
  const [perfil, setPerfil] = useState(null);
  const [error, setError] = useState('');
  const [notifActivas, setNotifActivas] = useState(false);
  const [notifCargando, setNotifCargando] = useState(false);
  const [notifError, setNotifError] = useState('');
  const [dispCargando, setDispCargando] = useState(false);
  const [dispError, setDispError] = useState('');

  useEffect(() => {
    let activo = true;
    api
      .perfil()
      .then(({ perfil: data }) => {
        if (activo) setPerfil(data);
      })
      .catch(() => {
        if (activo) setError(t.comun.error_generico);
      });
    if (pushSoportado()) {
      suscripcionActual().then((suscripcion) => {
        if (activo) setNotifActivas(!!suscripcion);
      });
    }
    return () => {
      activo = false;
    };
  }, []);

  // El interruptor de disponibilidad. Lo mueve el Asistente y nadie más: `estado` —lo que decide
  // la Prestadora— es otra cosa y se muestra arriba, sin tocar.
  //
  // Lo que queda en pantalla es lo que contestó el motor, no lo que se mandó. Si el pedido no
  // llegó, el interruptor tiene que seguir mostrando lo de antes: decirle a alguien que quedó no
  // disponible cuando en realidad no quedó es el único error que esta pantalla no puede cometer.
  async function alternarDisponibilidad() {
    setDispError('');
    setDispCargando(true);
    try {
      const ahora = perfil?.disponible_para_ofertas !== false;
      const { disponible_para_ofertas } = await api.cambiarDisponibilidad(!ahora);
      setPerfil((previo) => ({ ...previo, disponible_para_ofertas }));
    } catch (e) {
      setDispError(mensajeDeError(e, t, 'cambiar disponibilidad'));
    } finally {
      setDispCargando(false);
    }
  }

  async function alternarNotificaciones() {
    setNotifError('');
    setNotifCargando(true);
    try {
      if (notifActivas) {
        await desactivarPush();
        setNotifActivas(false);
      } else {
        if (Notification.permission === 'denied') {
          setNotifError(t.perfil.notificaciones_permiso_denegado);
          return;
        }
        const permiso = await Notification.requestPermission();
        if (permiso !== 'granted') {
          setNotifError(t.perfil.notificaciones_permiso_denegado);
          return;
        }
        await activarPush();
        setNotifActivas(true);
      }
    } catch {
      setNotifError(t.perfil.notificaciones_error);
    } finally {
      setNotifCargando(false);
    }
  }

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!perfil) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;

  return (
    <div>
      <h1>{t.perfil.titulo}</h1>
      <div className="panel-detalle-lista" style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.5rem 1.5rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--azul-oscuro)', fontSize: '0.85rem' }}>{t.perfil.nombre}</div>
        <div>{perfil.nombre}</div>
        <div style={{ fontWeight: 700, color: 'var(--azul-oscuro)', fontSize: '0.85rem' }}>{t.perfil.email}</div>
        <div>{perfil.email}</div>
        <div style={{ fontWeight: 700, color: 'var(--azul-oscuro)', fontSize: '0.85rem' }}>{t.perfil.telefono}</div>
        <div>{perfil.telefono || '—'}</div>
        <div style={{ fontWeight: 700, color: 'var(--azul-oscuro)', fontSize: '0.85rem' }}>{t.perfil.tipo}</div>
        <div>{nombreTipo(perfil.tipos_asistente, t)}</div>
        <div style={{ fontWeight: 700, color: 'var(--azul-oscuro)', fontSize: '0.85rem' }}>{t.perfil.zonas}</div>
        <div>{(perfil.zonas || []).join(', ') || '—'}</div>
        <div style={{ fontWeight: 700, color: 'var(--azul-oscuro)', fontSize: '0.85rem' }}>{t.perfil.estado}</div>
        <div>
          <span className={`badge badge-${perfil.estado}`}>{traducirValor(t.perfil, `estado_${perfil.estado}`)}</span>
        </div>
      </div>

      {/* El interruptor de disponibilidad. Va inmediatamente después del estado que decide la
          Prestadora, y con su propio título, para que se vea que son dos cosas distintas: una la
          decide ella y la otra la decide él.

          El texto de abajo dice qué apaga y qué no, porque es lo que la gente necesita saber
          antes de tocarlo: que no lo saca de la Prestadora y que no le cancela nada de lo que ya
          aceptó. Nadie se pone "no disponible" si sospecha que puede perder el trabajo. */}
      <h2 style={{ marginTop: '2rem' }}>{t.perfil.disponibilidad_titulo}</h2>
      <p className="texto-ayuda">{t.perfil.disponibilidad_explicacion}</p>
      <p>
        {perfil.disponible_para_ofertas !== false
          ? t.perfil.disponibilidad_disponible
          : t.perfil.disponibilidad_no_disponible}
      </p>
      <button type="button" className="btn btn-secondary" disabled={dispCargando} onClick={alternarDisponibilidad}>
        {dispCargando
          ? t.comun.guardando
          : perfil.disponible_para_ofertas !== false
          ? t.perfil.disponibilidad_ponerse_no_disponible
          : t.perfil.disponibilidad_ponerse_disponible}
      </button>
      {dispError && <div className="alert alert-error" role="alert">{dispError}</div>}

      {/* Lo que dijeron de su trabajo, y lo que él tiene para contestar (pendiente #85). Va acá
          y no en la barra de abajo porque no es trabajo del día: se mira cada tanto. */}
      <p style={{ marginTop: '1rem' }}>
        <Link to="/calificaciones">{t.perfil.ver_calificaciones}</Link>
      </p>

      {/* La Matrícula va antes que las notificaciones porque es lo único de esta
          pantalla que puede dejarlo sin trabajo. Si le corresponde y está trabada,
          tiene que ser lo primero que vea. Si su tipo no requiere Matrícula, este
          bloque no se dibuja. */}
      <Matricula />
      <h2 style={{ marginTop: '2rem' }}>{t.perfil.notificaciones_titulo}</h2>
      {!pushSoportado() ? (
        <div className="alert">{t.perfil.notificaciones_no_soportadas}</div>
      ) : (
        <>
          <button type="button" className="btn btn-primary" disabled={notifCargando} onClick={alternarNotificaciones}>
            {notifCargando
              ? t.perfil.notificaciones_activando
              : notifActivas
              ? t.perfil.notificaciones_desactivar
              : t.perfil.notificaciones_activar}
          </button>
          {notifActivas && !notifCargando && <p>{t.perfil.notificaciones_activas}</p>}
          {notifError && <div className="alert alert-error" role="alert">{notifError}</div>}
        </>
      )}

      {/* Pendiente #102. Vive en Mi Perfil y no en una pantalla aparte a
          propósito: es algo que la persona tiene que poder volver a mirar
          cuando quiera, no un trámite de una sola vez que después desaparece. */}
      <Consentimientos />
    </div>
  );
}
