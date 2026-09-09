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
import PaseDeGuardia from '../components/PaseDeGuardia';
import CodigoDePresencia from '../components/CodigoDePresencia';

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

  // Los dos botones abren y cierran el bloque que tienen debajo. Un lector de pantalla no ve
  // que el bloque se desplegó, así que hay que decírselo: `aria-expanded` dice si está
  // abierto o cerrado, y `aria-controls` dice qué bloque es el que abre. Los dos bloques se
  // dibujan siempre, vacíos mientras están cerrados, para que el botón nunca apunte a algo
  // que no existe.
  const idReportes = `reportes-anteriores-${paciente.id}`;
  const idMedicacion = `ordenes-medicacion-${paciente.id}`;

  return (
    <div style={{ marginTop: '1rem' }}>
      {mostrarNombre && <h2 className="guardia-card-paciente">{paciente.nombre}</h2>}

      {veReportes && (
        <>
          {/* Con varios Pacientes hay un botón igual por cada uno. En la pantalla se
              distinguen por el nombre que tienen arriba; para quien escucha, todos dirían lo
              mismo, así que ahí el nombre va adentro del botón. */}
          <button
            className="btn btn-secondary btn-full"
            onClick={verReportesAnteriores}
            aria-expanded={mostrandoReportes}
            aria-controls={idReportes}
            aria-label={
              mostrarNombre
                ? con(t.guardia_activa.ver_reportes_anteriores_de, { nombre: paciente.nombre })
                : undefined
            }
          >
            {t.guardia_activa.ver_reportes_anteriores}
          </button>
          <div id={idReportes} style={mostrandoReportes ? { marginTop: '1rem' } : undefined}>
            {mostrandoReportes && (
              <>
                {reportes === null && <div className="estado-cargando" role="status">{t.comun.cargando}</div>}
                {reportes?.length === 0 && <div className="estado-vacio" role="status">{t.comun.vacio}</div>}
                {reportes?.map((r) => (
                  <div key={r.id} className="guardia-card">
                    <div className="guardia-card-detalle">{r.guardias?.fecha}</div>
                    {r.observaciones && <p>{r.observaciones}</p>}
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}

      {veMedicacion && (
        <>
          <button
            className="btn btn-secondary btn-full"
            onClick={verOrdenesMedicacion}
            style={{ marginTop: '1rem' }}
            aria-expanded={mostrandoMedicacion}
            aria-controls={idMedicacion}
            aria-label={mostrarNombre ? con(t.medicacion.ver_ordenes_de, { nombre: paciente.nombre }) : undefined}
          >
            {t.medicacion.ver_ordenes}
          </button>
          <div id={idMedicacion} style={mostrandoMedicacion ? { marginTop: '1rem' } : undefined}>
            {mostrandoMedicacion && (
              <>
                {ordenesMedicacion === null && <div className="estado-cargando" role="status">{t.comun.cargando}</div>}
                {ordenesMedicacion?.length === 0 && (
                  <div className="estado-vacio" role="status">{t.medicacion.sin_ordenes}</div>
                )}
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
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function esErrorDeRed(error) {
  return error instanceof TypeError;
}

// Los tres motivos con los que el motor rechaza un código del pase de guardia (pendiente #113).
// Son los únicos que no cierran el pase: el Asistente sigue parado en la puerta, y una pantalla
// que se cierra sola después de un código mal tipeado lo deja sin nada que apretar. El resto de
// los motivos —falta el Reporte Diario, la guardia no se puede cerrar todavía— hablan de otra
// cosa y sí cierran, porque no se arreglan tipeando de nuevo.
const MOTIVOS_DEL_CODIGO = ['codigo_incorrecto', 'codigo_vencido', 'demasiados_intentos'];

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
  // El pase de guardia (pendiente #113): mientras estos dos están en true se muestra el pase en
  // vez del botón. Uno por acto porque la llegada y el cierre son actos independientes — igual
  // que el resto del ciclo de vida de la guardia, que esta función no toca.
  const [pasandoCheckin, setPasandoCheckin] = useState(false);
  const [pasandoCheckout, setPasandoCheckout] = useState(false);
  // Y el otro lado del mismo pase: cuando el que se va es este Asistente, es él quien tiene que
  // mostrarle el código al relevo que llega.
  const [mostrandoMiCodigo, setMostrandoMiCodigo] = useState(false);

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

  // `comprobacion` es { codigo } o { motivoSinComprobar, detalle }, resuelto por
  // <PaseDeGuardia/>. Comprobación y ubicación van siempre juntas (decisión del Desarrollador):
  // nunca se marca un check-in con una y no la otra, y ninguna de las dos traba la guardia —
  // lo que no se pudo comprobar queda anotado como tal y el check-in se marca igual.
  async function alHacerCheckin(comprobacion) {
    setError('');
    setAviso('');
    setHaciendoCheckin(true);
    try {
      const { lat, lng } = await obtenerUbicacion();
      const clienteUuid = nuevoId();
      try {
        const resultado = await api.checkin(id, { lat, lng, clienteUuid, comprobacion });
        const avisos = [];
        if (!resultado.dentroDeRango) avisos.push(t.guardia_activa.fuera_de_rango);
        if (resultado.comprobacion === 'sin_comprobar') avisos.push(t.guardia_activa.quedo_sin_comprobar);
        if (avisos.length > 0) setAviso(avisos.join(' '));
        setPasandoCheckin(false);
        cargar();
      } catch (e) {
        if (!esErrorDeRed(e)) throw e;
        // Sin señal: se guarda local y se reintenta solo al volver la conexión. Y el código que
        // se haya leído no se guarda con el pedido: para cuando la cola llegue al motor va a
        // estar vencido hace rato, y un código vencido rebota. Se guarda el motivo que existe
        // justamente para esto, así la llegada entra igual y queda para que el Coordinador la
        // mire. Esa es la diferencia entre una guardia que se traba y una que no.
        const sinRed = { motivoSinComprobar: 'sin_conexion' };
        await agregarACola({ id: clienteUuid, tipo: 'checkin', guardiaId: id, payload: { lat, lng, clienteUuid, comprobacion: sinRed } });
        setCheckinPendiente({ desde: Date.now() });
        setAviso(t.guardia_activa.sin_conexion_sin_comprobar);
        setPasandoCheckin(false);
        sincronizarCola();
      }
    } catch (e) {
      // Un código que el motor rechaza no cierra el pase: el Asistente sigue parado en la
      // puerta y tiene que poder intentar otra cosa ahí mismo, sin volver a empezar.
      if (MOTIVOS_DEL_CODIGO.includes(e.motivo)) return { ok: false, mensaje: mensajeDeError(e, t) };
      setPasandoCheckin(false);
      setError(e.message === 'sin_geo' ? t.guardia_activa.geo_no_disponible : mensajeDeError(e, t));
    } finally {
      setHaciendoCheckin(false);
    }
    return { ok: true };
  }

  // Mismo contrato que alHacerCheckin: la comprobación llega resuelta por <PaseDeGuardia/>,
  // nunca traba el cierre, y viaja junto con la ubicación en el mismo pedido.
  async function alCerrarGuardia(comprobacion) {
    setError('');
    setAviso('');
    setCerrando(true);
    try {
      const { lat, lng } = await obtenerUbicacion();
      const clienteUuid = nuevoId();
      try {
        const resultado = await api.checkout(id, { lat, lng, clienteUuid, comprobacion });
        if (resultado.comprobacion === 'sin_comprobar') setAviso(t.guardia_activa.quedo_sin_comprobar);
        setPasandoCheckout(false);
        setConfirmandoCierre(false);
        cargar();
      } catch (e) {
        if (!esErrorDeRed(e)) throw e;
        // Sin señal: se guarda local y se reintenta solo al volver la conexión, igual que
        // el check-in, y por el mismo motivo sin el código leído. El Asistente puede irse; el
        // cierre viaja cuando haya red.
        const sinRed = { motivoSinComprobar: 'sin_conexion' };
        await agregarACola({ id: clienteUuid, tipo: 'checkout', guardiaId: id, payload: { lat, lng, clienteUuid, comprobacion: sinRed } });
        setCerradoPendiente(true);
        setAviso(t.guardia_activa.sin_conexion_sin_comprobar);
        setPasandoCheckout(false);
        setConfirmandoCierre(false);
        sincronizarCola();
      }
    } catch (e) {
      if (MOTIVOS_DEL_CODIGO.includes(e.motivo)) return { ok: false, mensaje: mensajeDeError(e, t) };
      setPasandoCheckout(false);
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
    return { ok: true };
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

      {!guardia.checkin_at && !checkinPendiente && !pasandoCheckin && (
        <button className="btn btn-primary btn-full" onClick={() => setPasandoCheckin(true)} disabled={haciendoCheckin}>
          {haciendoCheckin ? t.guardia_activa.haciendo_checkin : t.guardia_activa.hacer_checkin}
        </button>
      )}

      {/* El pase de guardia (pendiente #113): antes de marcar la llegada se lee el código que
          muestra en su pantalla quien está en la casa. Si no hay nadie que pueda mostrarlo,
          <PaseDeGuardia/> ofrece pedírselo a la Prestadora, y si tampoco así, entrar igual
          eligiendo un motivo — el pase nunca traba la guardia.
          Se queda dibujado mientras el pedido viaja: si el motor rechaza el código, el aviso
          aparece adentro del mismo pase y se puede intentar de nuevo sin volver a empezar. */}
      {!guardia.checkin_at && !checkinPendiente && pasandoCheckin && (
        <PaseDeGuardia
          t={t}
          guardiaId={id}
          momento="checkin"
          onListo={alHacerCheckin}
          onCancelar={() => setPasandoCheckin(false)}
        />
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
              (tarea 66a). El pase por QR (pendiente #113) quedó enchufado más abajo, entre
              la pregunta de cierre y el cierre en sí. */}
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

              {!pasandoCheckout && (
                <>
                  <button className="btn btn-primary btn-full" onClick={() => setPasandoCheckout(true)} disabled={cerrando}>
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
                </>
              )}

              {/* El pase de guardia (pendiente #113): antes de cerrar se comprueba lo mismo que
                  al llegar, con el mismo criterio de nunca trabar. Es el lugar que ya estaba
                  marcado para esto (tarea 66a). */}
              {pasandoCheckout && (
                <PaseDeGuardia
                  t={t}
                  guardiaId={id}
                  momento="checkout"
                  onListo={alCerrarGuardia}
                  onCancelar={() => setPasandoCheckout(false)}
                />
              )}
            </div>
          )}

          {/* El otro lado del mismo pase (pendiente #113). Cuando hay relevo, el que está
              adentro es quien tiene que mostrarle el código al que llega: acá está el suyo.
              Se muestra a pedido y no siempre abierto, porque un código de estos se renueva
              solo cada pocos segundos y no tiene sentido tenerlo girando toda la guardia. */}
          {!pasandoCheckout && (
            <div style={{ marginTop: '1.5rem' }}>
              <button
                className="btn btn-secondary btn-full"
                onClick={() => setMostrandoMiCodigo((abierto) => !abierto)}
                aria-expanded={mostrandoMiCodigo}
                aria-controls="mi-codigo-de-presencia"
              >
                {mostrandoMiCodigo ? t.guardia_activa.ocultar_mi_codigo : t.guardia_activa.mostrar_mi_codigo}
              </button>
              <div id="mi-codigo-de-presencia">
                {mostrandoMiCodigo && (
                  <>
                    <p className="guardia-card-detalle" style={{ marginTop: '0.75rem' }}>
                      {t.guardia_activa.mi_codigo_explicacion}
                    </p>
                    <CodigoDePresencia t={t} pedirCodigo={api.codigoDePresencia} />
                  </>
                )}
              </div>
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
