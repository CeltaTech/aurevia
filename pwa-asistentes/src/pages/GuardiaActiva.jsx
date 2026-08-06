import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { agregarACola, nuevoId, pendientesDeGuardia } from '../lib/colaOffline';
import { sincronizarCola, suscribirseASincronizacion } from '../lib/sincronizarCola';

function esErrorDeRed(error) {
  return error instanceof TypeError;
}

function obtenerUbicacion() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('sin_geo'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (posicion) => resolve({ lat: posicion.coords.latitude, lng: posicion.coords.longitude }),
      () => reject(new Error('sin_geo')),
      { enableHighAccuracy: true, timeout: 10000 },
    );
  });
}

function tiempoTranscurrido(desde) {
  const ms = Date.now() - new Date(desde).getTime();
  const minutos = Math.floor(ms / 60000);
  const horas = Math.floor(minutos / 60);
  const minutosRestantes = minutos % 60;
  return `${String(horas).padStart(2, '0')}:${String(minutosRestantes).padStart(2, '0')}`;
}

export default function GuardiaActiva() {
  const { id } = useParams();
  const { t } = useLocale();
  const [guardia, setGuardia] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [haciendoCheckin, setHaciendoCheckin] = useState(false);
  const [reportes, setReportes] = useState(null);
  const [mostrandoReportes, setMostrandoReportes] = useState(false);
  const [ordenesMedicacion, setOrdenesMedicacion] = useState(null);
  const [mostrandoMedicacion, setMostrandoMedicacion] = useState(false);
  const [tick, setTick] = useState(0);
  const [checkinPendiente, setCheckinPendiente] = useState(null); // { desde } o null
  const [reporteCargado, setReporteCargado] = useState(false);
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [cerradoPendiente, setCerradoPendiente] = useState(false);

  function cargar() {
    api
      .guardia(id)
      .then(({ guardia: data, reporteCargado: hayReporte }) => {
        setGuardia(data);
        setReporteCargado(!!hayReporte);
      })
      .catch(() => setError(t.comun.error_generico));
  }

  async function revisarPendientes() {
    const pendientes = await pendientesDeGuardia(id);
    const checkin = pendientes.find((p) => p.tipo === 'checkin');
    setCheckinPendiente(checkin ? { desde: checkin.creadoEn } : null);
    // Un reporte esperando señal cuenta como cargado: ya lo escribió el Asistente, y si no
    // contara, la pantalla le pediría escribirlo de nuevo por estar sin conexión.
    if (pendientes.some((p) => p.tipo === 'reporte')) setReporteCargado(true);
    setCerradoPendiente(pendientes.some((p) => p.tipo === 'checkout'));
  }

  useEffect(() => {
    cargar();
    revisarPendientes();
  }, [id]);

  useEffect(() => {
    const desuscribir = suscribirseASincronizacion(() => {
      cargar();
      revisarPendientes();
    });
    return desuscribir;
  }, [id]);

  useEffect(() => {
    if ((!guardia?.checkin_at && !checkinPendiente) || guardia?.checkout_at || cerradoPendiente) return;
    const intervalo = setInterval(() => setTick((v) => v + 1), 30000);
    return () => clearInterval(intervalo);
  }, [guardia, checkinPendiente, cerradoPendiente]);

  async function alHacerCheckin() {
    setError('');
    setAviso('');
    setHaciendoCheckin(true);
    try {
      const { lat, lng } = await obtenerUbicacion();
      const clienteUuid = nuevoId();
      try {
        const resultado = await api.checkin(id, { lat, lng, clienteUuid });
        if (!resultado.dentroDeRango) {
          setAviso(t.guardia_activa.fuera_de_rango);
        }
        cargar();
      } catch (e) {
        if (!esErrorDeRed(e)) throw e;
        // Sin señal: se guarda local y se reintenta solo al volver la conexión.
        await agregarACola({ id: clienteUuid, tipo: 'checkin', guardiaId: id, payload: { lat, lng, clienteUuid } });
        setCheckinPendiente({ desde: Date.now() });
        sincronizarCola();
      }
    } catch (e) {
      setError(e.message === 'sin_geo' ? t.guardia_activa.geo_no_disponible : t.comun.error_generico);
    } finally {
      setHaciendoCheckin(false);
    }
  }

  async function alCerrarGuardia() {
    setError('');
    setAviso('');
    setCerrando(true);
    try {
      const { lat, lng } = await obtenerUbicacion();
      const clienteUuid = nuevoId();
      try {
        await api.checkout(id, { lat, lng, clienteUuid });
        setConfirmandoCierre(false);
        cargar();
      } catch (e) {
        if (!esErrorDeRed(e)) throw e;
        // Sin señal: se guarda local y se reintenta solo al volver la conexión, igual que
        // el check-in. El Asistente puede irse; el cierre viaja cuando haya red.
        await agregarACola({ id: clienteUuid, tipo: 'checkout', guardiaId: id, payload: { lat, lng, clienteUuid } });
        setCerradoPendiente(true);
        setConfirmandoCierre(false);
        sincronizarCola();
      }
    } catch (e) {
      if (e.message === 'sin_geo') setError(t.guardia_activa.geo_no_disponible);
      else if (e.motivo === 'falta_reporte') setError(t.guardia_activa.cerrar_falta_reporte);
      else if (e.motivo === 'continuidad') setError(t.guardia_activa.cerrar_bloqueado);
      else setError(t.comun.error_generico);
    } finally {
      setCerrando(false);
    }
  }

  async function verReportesAnteriores() {
    if (mostrandoReportes) {
      setMostrandoReportes(false);
      return;
    }
    setMostrandoReportes(true);
    if (reportes === null) {
      try {
        const { reportes: data } = await api.reportesDelPaciente(guardia.paciente_id);
        setReportes(data);
      } catch {
        setReportes([]);
      }
    }
  }

  async function verOrdenesMedicacion() {
    if (mostrandoMedicacion) {
      setMostrandoMedicacion(false);
      return;
    }
    setMostrandoMedicacion(true);
    if (ordenesMedicacion === null) {
      try {
        const { ordenes } = await api.medicacionDelPaciente(guardia.paciente_id);
        setOrdenesMedicacion(ordenes);
      } catch {
        setOrdenesMedicacion([]);
      }
    }
  }

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!guardia) return <div className="estado-cargando">{t.comun.cargando}</div>;

  const paciente = guardia.pacientes;

  return (
    <div>
      <Link to="/guardias" className="btn btn-secondary" style={{ marginBottom: '1rem', fontSize: '0.8rem', padding: '0.4rem 1rem' }}>
        <span aria-hidden="true">←</span> {t.comun.volver}
      </Link>
      <h1>{t.guardia_activa.paciente}: {paciente?.nombre}</h1>
      <p className="guardia-card-detalle">
        {t.guardia_activa.domicilio}: {paciente?.domicilio}
      </p>
      {paciente?.patologias && (
        <p className="guardia-card-detalle">
          {t.guardia_activa.patologias}: {paciente.patologias}
        </p>
      )}

      {aviso && <div className="alert alert-alerta">{aviso}</div>}

      {checkinPendiente && (
        <div className="alert alert-info" aria-label={t.comun.pendiente_de_enviar}>
          <span aria-hidden="true">⏳</span> {t.comun.pendiente_de_enviar}
        </div>
      )}

      {!guardia.checkin_at && !checkinPendiente && (
        <button className="btn btn-primary btn-full" onClick={alHacerCheckin} disabled={haciendoCheckin}>
          {haciendoCheckin ? t.guardia_activa.haciendo_checkin : t.guardia_activa.hacer_checkin}
        </button>
      )}

      {(guardia.checkin_at || checkinPendiente) && !guardia.checkout_at && (
        <>
          <div className="guardia-timer">{tiempoTranscurrido(guardia.checkin_at || checkinPendiente.desde)}</div>
          <p className="guardia-card-detalle" style={{ textAlign: 'center', marginTop: '-0.5rem' }}>
            {t.guardia_activa.tiempo_transcurrido}
          </p>

          {!reporteCargado && (
            <>
              <Link to={`/guardias/${id}/reporte`} className="btn btn-exito btn-full" style={{ marginTop: '1rem' }}>
                {t.guardia_activa.cargar_reporte}
              </Link>
              <p className="guardia-card-detalle">{t.guardia_activa.cerrar_falta_reporte}</p>
            </>
          )}

          {/* El cierre es un acto propio, no un efecto secundario de mandar el reporte
              (tarea 66a). Es también el lugar donde va a enchufarse el pase por QR. */}
          {reporteCargado && cerradoPendiente && (
            <div className="alert alert-info" aria-label={t.comun.pendiente_de_enviar} style={{ marginTop: '1rem' }}>
              <span aria-hidden="true">⏳</span> {t.comun.pendiente_de_enviar}
            </div>
          )}

          {reporteCargado && !cerradoPendiente && guardia.checkout_bloqueado && (
            <div className="alert alert-alerta" style={{ marginTop: '1rem' }}>{t.guardia_activa.cerrar_bloqueado}</div>
          )}

          {reporteCargado && !cerradoPendiente && !guardia.checkout_bloqueado && !confirmandoCierre && (
            <button className="btn btn-primary btn-full" onClick={() => setConfirmandoCierre(true)} style={{ marginTop: '1rem' }}>
              {t.guardia_activa.hacer_checkout}
            </button>
          )}

          {reporteCargado && !cerradoPendiente && !guardia.checkout_bloqueado && confirmandoCierre && (
            <div style={{ marginTop: '1rem' }}>
              <p className="guardia-card-detalle">{t.guardia_activa.cerrar_pregunta}</p>
              <button className="btn btn-primary btn-full" onClick={alCerrarGuardia} disabled={cerrando}>
                {cerrando ? t.guardia_activa.haciendo_checkout : t.guardia_activa.cerrar_si}
              </button>
              <button
                className="btn btn-secondary btn-full"
                onClick={() => setConfirmandoCierre(false)}
                disabled={cerrando}
                style={{ marginTop: '0.5rem' }}
              >
                {t.comun.cancelar}
              </button>
            </div>
          )}
        </>
      )}

      {guardia.checkout_at && <div className="alert alert-info">{t.guardia_activa.cerrar_ok}</div>}

      <button className="btn btn-secondary btn-full" onClick={verReportesAnteriores} style={{ marginTop: '1rem' }}>
        {t.guardia_activa.ver_reportes_anteriores}
      </button>

      {mostrandoReportes && (
        <div style={{ marginTop: '1rem' }}>
          {reportes === null && <div className="estado-cargando">{t.comun.cargando}</div>}
          {reportes?.length === 0 && <div className="estado-vacio">{t.comun.vacio}</div>}
          {reportes?.map((r) => (
            <div key={r.id} className="guardia-card">
              <div className="guardia-card-detalle">{r.guardias?.fecha}</div>
              {r.observaciones && <p>{r.observaciones}</p>}
            </div>
          ))}
        </div>
      )}

      <button className="btn btn-secondary btn-full" onClick={verOrdenesMedicacion} style={{ marginTop: '1rem' }}>
        {t.medicacion.ver_ordenes}
      </button>

      {mostrandoMedicacion && (
        <div style={{ marginTop: '1rem' }}>
          {ordenesMedicacion === null && <div className="estado-cargando">{t.comun.cargando}</div>}
          {ordenesMedicacion?.length === 0 && <div className="estado-vacio">{t.medicacion.sin_ordenes}</div>}
          {ordenesMedicacion?.map((o) => (
            <div key={o.id} className="guardia-card">
              <div className="guardia-card-detalle">
                <strong>{o.medicamento}</strong> · {o.dosis} · {o.frecuencia} ({o.via_administracion})
              </div>
              <div className="guardia-card-detalle">
                {t.medicacion.desde}: {o.fecha_desde} {o.fecha_hasta ? `— ${t.medicacion.hasta}: ${o.fecha_hasta}` : ''}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
