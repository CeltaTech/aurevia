import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { traducirValor } from '../i18n/valores';
import { activarPush, desactivarPush, pushSoportado, suscripcionActual } from '../lib/push';
import { useSeVe } from '../context/PerfilContext';
import { useCirculo } from '../context/CirculoContext';
import { pantallaPermitida } from '../lib/interruptorDeCadaPantalla';
import AvisoInstruccionPendiente from '../components/AvisoInstruccionPendiente';

// Una de las dos listas: qué ve esta persona y qué no. La de «qué no ve» pesa lo mismo que la
// otra a propósito. Quien está anotado en un círculo familiar tiene que poder saber qué le
// falta sin tener que descubrirlo a los tropezones, buscando un botón que no está.
function ListaDeAccesos({ titulo, claves, etiquetas, vacio }) {
  return (
    <>
      <h3 style={{ marginTop: '1.25rem' }}>{titulo}</h3>
      {claves.length === 0 ? (
        <p className="guardia-card-detalle">{vacio}</p>
      ) : (
        <ul className="lista-tareas">
          {claves.map((clave) => (
            <li key={clave}>{traducirValor(etiquetas, clave)}</li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function MiPerfil() {
  const { t } = useLocale();
  const seVe = useSeVe();
  const { puedeVer } = useCirculo();
  const [perfil, setPerfil] = useState(null);
  const [error, setError] = useState('');
  const [notifActivas, setNotifActivas] = useState(false);
  const [notifCargando, setNotifCargando] = useState(false);
  const [notifError, setNotifError] = useState('');

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

  // El orden es el que mandó el motor, que es el del catálogo: dos personas del mismo círculo
  // leen su lista en el mismo orden y se pueden comparar renglón por renglón.
  const accesos = perfil.accesos ? Object.entries(perfil.accesos) : null;
  const loQueVe = accesos ? accesos.filter(([, permitido]) => permitido).map(([clave]) => clave) : [];
  const loQueNoVe = accesos ? accesos.filter(([, permitido]) => !permitido).map(([clave]) => clave) : [];

  return (
    <div>
      <h1>{t.perfil.titulo}</h1>

      <AvisoInstruccionPendiente />
      <div style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.5rem 1.5rem' }}>
        <div style={{ fontWeight: 700, color: 'var(--azul-oscuro)', fontSize: '0.85rem' }}>{t.perfil.nombre}</div>
        <div>{perfil.nombre}</div>
        <div style={{ fontWeight: 700, color: 'var(--azul-oscuro)', fontSize: '0.85rem' }}>{t.perfil.telefono}</div>
        <div>{perfil.telefono || '—'}</div>
        {/* El plan contratado es una condición comercial, no un dato del cuidado: va con el
            resto de lo que la Prestadora decide mostrar sobre el dinero. Hay Prestadoras que
            cobran por fuera de la aplicación y no quieren que aparezca acá. */}
        {seVe('familia_pagos_y_suscripcion') && (
          <>
            <div style={{ fontWeight: 700, color: 'var(--azul-oscuro)', fontSize: '0.85rem' }}>{t.perfil.plan}</div>
            <div>{perfil.plan || '—'}</div>
          </>
        )}
      </div>

      {/* Las facturas se entran desde acá y no desde la barra de abajo, que tiene tres lugares y
          los tres son de todos los días. Lo que se le cobra al círculo familiar no cuelga de
          ningún Paciente: se factura al círculo entero, y una misma factura puede tener
          renglones de más de una persona cuidada. El botón se pregunta lo mismo que la ruta, con
          la misma función, o quedaría un botón que rebota. */}
      {pantallaPermitida('facturas', seVe, puedeVer) && (
        <Link to="/facturas" className="btn btn-secondary btn-full" style={{ marginTop: '1.5rem' }}>
          {t.facturas.titulo}
        </Link>
      )}

      {/* Qué ve esta persona y qué no. Al titular se le dice que ve todo y se termina ahí: lo
          suyo no se configura, no hay instrucción que le pueda quitar nada, ni siquiera una
          propia. A quien está en el círculo se le muestran las dos listas enteras, y de dónde
          salieron: acá no hay nada que tocar, y el cambio se lo pide a la Prestadora quien
          firmó la prestación. Sin esa aclaración, la pantalla parece un formulario roto. */}
      {(perfil.esTitular || accesos) && (
        <>
          <h2 style={{ marginTop: '2rem' }}>{t.perfil.acceso_titulo}</h2>
          {perfil.esTitular ? (
            <p>{t.perfil.acceso_titular}</p>
          ) : (
            <>
              <ListaDeAccesos
                titulo={t.perfil.acceso_ve}
                claves={loQueVe}
                etiquetas={t.circulo}
                vacio={t.perfil.acceso_ve_vacio}
              />
              <ListaDeAccesos
                titulo={t.perfil.acceso_no_ve}
                claves={loQueNoVe}
                etiquetas={t.circulo}
                vacio={t.perfil.acceso_no_ve_vacio}
              />
              <p className="guardia-card-detalle" style={{ marginTop: '1rem' }}>{t.perfil.acceso_lo_decide_el_titular}</p>
            </>
          )}
        </>
      )}

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
    </div>
  );
}
