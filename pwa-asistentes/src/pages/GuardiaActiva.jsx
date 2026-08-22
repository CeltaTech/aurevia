import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { agregarACola, nuevoId, pendientesDeGuardia } from '../lib/colaOffline';
import { sincronizarCola, suscribirseASincronizacion } from '../lib/sincronizarCola';
import { con } from '../lib/textos';
import { mensajeDeError } from '../lib/errores';
import { nombreTipo } from '../lib/tipoDeAsistente';
import { useSeVe } from '../context/PerfilContext';
import DomicilioTemporal from '../components/DomicilioTemporal';

// Una de las dos listas del tipo de Asistente. La de "qué no hace" se muestra igual de
// grande que la otra a propósito: es la que evita la discusión en la puerta. Se dibuja
// idéntica a la que ve la Familia, para que las dos partes miren lo mismo.
function ListaDeTareas({ titulo, tareas, vacio }) {
  return (
    <>
      <h2 style={{ marginTop: '1.5rem' }}>{titulo}</h2>
      {tareas.length === 0 ? (
        <div className="estado-vacio" role="status">{vacio}</div>
      ) : (
        <ul className="lista-tareas">
          {tareas.map((tarea) => (
            <li key={tarea.id}>{tarea.texto || tarea.clave}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * Lo que se puede consultar de UN Paciente durante el turno: sus reportes anteriores y sus
 * órdenes de medicación.
 *
 * Cada Paciente tiene su propio bloque, con su nombre arriba cuando el turno cubre a más de
 * uno. Es a propósito: una lista de medicación sin decir de quién es, en una casa donde viven
 * dos personas, es la clase de pantalla que termina en un medicamento dado a quien no era.
 *
 * Las dos consultas se apagan por separado desde el Panel. Si la Prestadora apagó las dos, el
 * bloque entero desaparece: quedaría un nombre solo, sin nada abajo.
 */
function DatosDelPaciente({ paciente, mostrarNombre, t }) {
  const [reportes, setReportes] = useState(null);
  const [mostrandoReportes, setMostrandoReportes] = useState(false);
  const [ordenesMedicacion, setOrdenesMedicacion] = useState(null);
  const [mostrandoMedicacion, setMostrandoMedicacion] = useState(false);
  const seVe = useSeVe();

  async function verReportesAnteriores() {
    if (mostrandoReportes) {
      setMostrandoReportes(false);
      return;
    }
    setMostrandoReportes(true);
    if (reportes === null) {
      try {
        const { reportes: data } = await api.reportesDelPaciente(paciente.id);
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
        const { ordenes } = await api.medicacionDelPaciente(paciente.id);
        setOrdenesMedicacion(ordenes);
      } catch {
        setOrdenesMedicacion([]);
      }
    }
  }

  const veReportes = seVe('asistente_reportes_anteriores');
  const veMedicacion = seVe('asistente_medicacion_del_paciente');
  if (!veReportes && !veMedicacion) return null;

  return (
    <div style={{ marginTop: '1rem' }}>
      {mostrarNombre && <h2 className="guardia-card-paciente">{paciente.nombre}</h2>}

      {veReportes && (
        <button className="btn btn-secondary btn-full" onClick={verReportesAnteriores}>
          {t.guardia_activa.ver_reportes_anteriores}
        </button>
      )}

      {veReportes && mostrandoReportes && (
        <div style={{ marginTop: '1rem' }}>
          {reportes === null && <div className="estado-cargando" role="status">{t.comun.cargando}</div>}
          {reportes?.length === 0 && <div className="estado-vacio" role="status">{t.comun.vacio}</div>}
          {reportes?.map((r) => (
            <div key={r.id} className="guardia-card">
              <div className="guardia-card-detalle">{r.guardias?.fecha}</div>
              {r.observaciones && <p>{r.observaciones}</p>}
            </div>
          ))}
        </div>
      )}

      {veMedicacion && (
        <button className="btn btn-secondary btn-full" onClick={verOrdenesMedicacion} style={{ marginTop: '1rem' }}>
          {t.medicacion.ver_ordenes}
        </button>
      )}

      {veMedicacion && mostrandoMedicacion && (
        <div style={{ marginTop: '1rem' }}>
          {ordenesMedicacion === null && <div className="estado-cargando" role="status">{t.comun.cargando}</div>}
          {ordenesMedicacion?.length === 0 && <div className="estado-vacio" role="status">{t.medicacion.sin_ordenes}</div>}
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
  const seVe = useSeVe();
  const [guardia, setGuardia] = useState(null);
  const [error, setError] = useState('');
  const [aviso, setAviso] = useState('');
  const [haciendoCheckin, setHaciendoCheckin] = useState(false);
  const [tick, setTick] = useState(0);
  const [checkinPendiente, setCheckinPendiente] = useState(null); // { desde } o null
  // Quiénes del turno ya tienen su reporte. Es una lista y no un sí/no porque cada Paciente
  // lleva el suyo: si el Asistente atendió a dos personas y escribió una sola hoja, el turno
  // todavía no está terminado.
  const [conReporte, setConReporte] = useState([]);
  // Qué es esta persona y qué le toca hacer en el turno. Viene del catálogo en cada
  // consulta, nunca guardado con la guardia: si la Prestadora corrige la lista, la
  // corrección tiene que llegar al próximo turno.
  const [tipo, setTipo] = useState(null);
  const [tareas, setTareas] = useState(null);
  const [confirmandoCierre, setConfirmandoCierre] = useState(false);
  const [cerrando, setCerrando] = useState(false);
  const [cerradoPendiente, setCerradoPendiente] = useState(false);

  function cargar() {
    api
      .guardia(id)
      .then(({ guardia: data, pacientesConReporte, tipo: elTipo, tareas: lasTareas }) => {
        setGuardia(data);
        setConReporte(pacientesConReporte ?? []);
        setTipo(elTipo ?? null);
        setTareas(lasTareas ?? null);
      })
      .catch((e) => setError(mensajeDeError(e, t, 'cargar la guardia')));
  }

  async function revisarPendientes() {
    const pendientes = await pendientesDeGuardia(id);
    const checkin = pendientes.find((p) => p.tipo === 'checkin');
    setCheckinPendiente(checkin ? { desde: checkin.creadoEn } : null);
    // Un reporte esperando señal cuenta como cargado: ya lo escribió el Asistente, y si no
    // contara, la pantalla le pediría escribirlo de nuevo por estar sin conexión.
    const esperando = pendientes
      .filter((p) => p.tipo === 'reporte' && p.payload?.pacienteId)
      .map((p) => p.payload.pacienteId);
    if (esperando.length > 0) {
      setConReporte((previos) => [...new Set([...previos, ...esperando])]);
    }
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
      setError(e.message === 'sin_geo' ? t.guardia_activa.geo_no_disponible : mensajeDeError(e, t));
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
      // `falta_reporte` es el único motivo que se sigue mirando acá, y es a propósito: su
      // frase lleva adentro los nombres de los Pacientes cuyo reporte falta, y eso una
      // búsqueda por motivo no lo hace. Si el turno cubrió a dos personas y se escribió una
      // sola hoja, hay que decir cuál falta, no que "falta el reporte".
      else if (e.motivo === 'falta_reporte')
        setError(
          e.pacientesSinReporte?.length
            ? con(t.guardia_activa.cerrar_faltan_reportes, {
                nombres: e.pacientesSinReporte.map((p) => p.nombre).join(', '),
              })
            : t.guardia_activa.cerrar_falta_reporte,
        );
      // El resto de los motivos los explica lib/errores.js con las traducciones: el motivo
      // que se agregue mañana en el motor va a salir explicado acá sin tocar esta pantalla.
      else setError(mensajeDeError(e, t, 'cerrar guardia'));
    } finally {
      setCerrando(false);
    }
  }

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (!guardia) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;

  // Una guardia puede cubrir a más de un Paciente: una casa donde viven dos, o un grupo
  // entero en una residencia. Por eso acá siempre hay una lista, aunque casi siempre tenga
  // un solo nombre — y por eso el check-in de más abajo es uno solo para todos.
  const pacientes = guardia.pacientes ?? [];
  const sonVarios = pacientes.length > 1;
  // La dirección exacta y las patologías se apagan por separado: hay Prestadoras que dan la
  // dirección recién por teléfono al confirmar, y hay otras que no mandan datos clínicos a
  // ningún teléfono. Lo apagado ni siquiera viaja, así que acá solo se deja de dibujar el
  // renglón que quedaría con el título y nada al lado.
  const veDomicilio = seVe('asistente_domicilio_del_paciente');
  const vePatologias = seVe('asistente_patologias_del_paciente');
  const faltanReporte = pacientes.filter((p) => !conReporte.includes(p.id));
  const reportesCompletos = pacientes.length > 0 && faltanReporte.length === 0;

  return (
    <div>
      <Link to="/guardias" className="btn btn-secondary" style={{ marginBottom: '1rem', fontSize: '0.8rem', padding: '0.4rem 1rem' }}>
        <span aria-hidden="true">←</span> {t.comun.volver}
      </Link>

      <h1>{sonVarios ? t.guardia_activa.pacientes : `${t.guardia_activa.paciente}: ${pacientes[0]?.nombre ?? ''}`}</h1>

      {pacientes.length === 0 && <div className="estado-vacio" role="status">{t.guardias.sin_paciente}</div>}

      {pacientes.map((p) => {
        // Con las dos cosas apagadas la tarjeta se saltea entera, salvo que el turno cubra a
        // varias personas: ahí el nombre sigue haciendo falta para saber a quiénes se atiende.
        const hayDatos = veDomicilio || (vePatologias && p.patologias);
        if (!hayDatos && !sonVarios) return null;
        return (
          <div key={p.id} className={sonVarios ? 'guardia-card' : undefined}>
            {sonVarios && <div className="guardia-card-paciente">{p.nombre}</div>}
            {veDomicilio && (
              <p className="guardia-card-detalle">
                {t.guardia_activa.domicilio}: {p.domicilio}
              </p>
            )}
            {/* Y si esa dirección no es la de siempre, se dice acá mismo, pegado a la
                dirección. Con el interruptor de arriba apagado el domicilio no viaja, y este
                renglón no se dibuja solo: no queda ningún cartel vacío. */}
            <DomicilioTemporal paciente={p} t={t} />
            {vePatologias && p.patologias && (
              <p className="guardia-card-detalle">
                {t.guardia_activa.patologias}: {p.patologias}
              </p>
            )}
          </div>
        );
      })}

      {sonVarios && (
        <div className="alert alert-info" role="status">{con(t.guardia_activa.varios_pacientes, { n: pacientes.length })}</div>
      )}

      {aviso && <div className="alert alert-alerta" role="status">{aviso}</div>}

      {checkinPendiente && (
        <div className="alert alert-info" role="status">
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

          {/* Un botón por cada persona que todavía no tiene su hoja. Con un solo Paciente se ve
              igual que siempre; con dos, el nombre está en el botón para que no haya que
              acordarse de cuál ya se cargó. */}
          {faltanReporte.length > 0 && (
            <>
              {faltanReporte.map((p) => (
                <Link
                  key={p.id}
                  to={`/guardias/${id}/reporte/${p.id}`}
                  className="btn btn-exito btn-full"
                  style={{ marginTop: '1rem' }}
                >
                  {sonVarios ? con(t.guardia_activa.cargar_reporte_de, { nombre: p.nombre }) : t.guardia_activa.cargar_reporte}
                </Link>
              ))}
              <p className="guardia-card-detalle">
                {sonVarios ? t.guardia_activa.un_reporte_por_paciente : t.guardia_activa.cerrar_falta_reporte}
              </p>
            </>
          )}

          {/* El cierre es un acto propio, no un efecto secundario de mandar el reporte
              (tarea 66a). Es también el lugar donde va a enchufarse el pase por QR. */}
          {reportesCompletos && cerradoPendiente && (
            <div className="alert alert-info" role="status" style={{ marginTop: '1rem' }}>
              <span aria-hidden="true">⏳</span> {t.comun.pendiente_de_enviar}
            </div>
          )}

          {/* El aviso de antes del intento y el rechazo de después son la misma regla, así que
              son un solo texto: el del motivo `continuidad` que manda el motor. */}
          {reportesCompletos && !cerradoPendiente && guardia.checkout_bloqueado && (
            <div className="alert alert-alerta" role="status" style={{ marginTop: '1rem' }}>{t.errores.motivos.continuidad}</div>
          )}

          {reportesCompletos && !cerradoPendiente && !guardia.checkout_bloqueado && !confirmandoCierre && (
            <button className="btn btn-primary btn-full" onClick={() => setConfirmandoCierre(true)} style={{ marginTop: '1rem' }}>
              {t.guardia_activa.hacer_checkout}
            </button>
          )}

          {reportesCompletos && !cerradoPendiente && !guardia.checkout_bloqueado && confirmandoCierre && (
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

      {guardia.checkout_at && <div className="alert alert-info" role="status">{t.guardia_activa.cerrar_ok}</div>}

      {/* Qué le toca hacer en este turno y qué no. Sale del mismo catálogo que ve la Familia
          en su pantalla, así que las dos partes leen exactamente lo mismo: es lo que corta la
          discusión en la puerta cuando le piden algo que no es de su trabajo.
          Si esta persona no tiene tipo cargado no hay lista que mostrar, y no se dibuja nada. */}
      {tipo && (
        <>
          <p className="guardia-card-detalle" style={{ marginTop: '1.5rem' }}>
            {t.guardia_activa.tipo}: {nombreTipo(tipo, t)}
          </p>
          <ListaDeTareas
            titulo={t.guardia_activa.tareas_corresponde}
            tareas={tareas?.corresponde || []}
            vacio={t.guardia_activa.tareas_vacio}
          />
          <ListaDeTareas
            titulo={t.guardia_activa.tareas_no_corresponde}
            tareas={tareas?.no_corresponde || []}
            vacio={t.guardia_activa.tareas_vacio}
          />
        </>
      )}

      {pacientes.map((p) => (
        <DatosDelPaciente key={p.id} paciente={p} mostrarNombre={sonVarios} t={t} />
      ))}
    </div>
  );
}
