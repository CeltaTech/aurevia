import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { supabase } from '../lib/supabaseClient';
import { useLocale } from '../i18n/LocaleContext';
import { traducirValor } from '../i18n/valores';
import { useSeVe } from '../context/PerfilContext';
import { INTERRUPTOR_DE_LA_PANTALLA } from '../lib/interruptorDeCadaPantalla';

function segundosDesde(fecha) {
  return Math.max(0, Math.floor((Date.now() - new Date(fecha).getTime()) / 1000));
}

export default function PacienteDetalle() {
  const { id } = useParams();
  const { t } = useLocale();
  const seVe = useSeVe();
  // Se resuelve acá, como un sí o un no, porque además de decidir si se dibuja el mapa
  // decide si conviene abrir la escucha en vivo de la guardia: sin mapa no hay nada que
  // hacer con esas posiciones.
  const veUbicacionEnVivo = seVe('familia_ubicacion_en_vivo');
  // Las alertas se preguntan una sola vez porque mandan sobre dos cosas de esta pantalla: el
  // resumen de arriba y el botón que lleva a la lista completa.
  const veAlertas = seVe(INTERRUPTOR_DE_LA_PANTALLA.alertas);
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [ubicacion, setUbicacion] = useState(null);
  const [, setTick] = useState(0);

  function cargar() {
    api
      .paciente(id)
      .then((data) => setDatos(data))
      .catch(() => setError(t.comun.error_generico));
  }

  useEffect(() => {
    setDatos(null);
    cargar();
  }, [id]);

  const guardiaActiva = datos?.guardiaActiva;

  useEffect(() => {
    if (!veUbicacionEnVivo || !guardiaActiva?.id) {
      setUbicacion(null);
      return;
    }
    if (guardiaActiva.ubicacion_actual_lat && guardiaActiva.ubicacion_actual_lng) {
      setUbicacion({
        lat: guardiaActiva.ubicacion_actual_lat,
        lng: guardiaActiva.ubicacion_actual_lng,
        at: guardiaActiva.ubicacion_actual_at,
      });
    }
    const canal = supabase
      .channel(`guardia-ubicacion-${guardiaActiva.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'guardias', filter: `id=eq.${guardiaActiva.id}` },
        (payload) => {
          const fila = payload.new;
          if (fila.ubicacion_actual_lat && fila.ubicacion_actual_lng) {
            setUbicacion({ lat: fila.ubicacion_actual_lat, lng: fila.ubicacion_actual_lng, at: fila.ubicacion_actual_at });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(canal);
    };
  }, [guardiaActiva?.id, veUbicacionEnVivo]);

  useEffect(() => {
    if (!ubicacion) return;
    const intervalo = setInterval(() => setTick((v) => v + 1), 5000);
    return () => clearInterval(intervalo);
  }, [ubicacion]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (datos === null) return <div className="estado-cargando">{t.comun.cargando}</div>;

  const { paciente, guardiaProxima, alertasActivas } = datos;
  const guardia = guardiaActiva || guardiaProxima;
  const asistente = guardia?.asistentes;

  // "En camino" es el rato entre que el Asistente sale de su casa y llega al domicilio:
  // hay hora de salida registrada y todavía no hay hora de llegada.
  const enCamino = Boolean(guardia?.salida_checkin_at && !guardia?.checkin_at);

  return (
    <div>
      <h1>{paciente.nombre}</h1>
      <p className="guardia-card-detalle">
        {t.paciente.domicilio}: {paciente.domicilio || '—'}
      </p>

      {veAlertas && alertasActivas.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <h2>{t.paciente.alertas_activas_titulo}</h2>
          {alertasActivas.map((a) => (
            <div key={a.id} className={`alert alerta-${a.nivel}`}>
              <span className={`badge badge-${a.nivel}`}>{traducirValor(t.alertas, `nivel_${a.nivel}`)}</span> {a.descripcion}
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: '1.5rem' }}>{guardiaActiva ? t.paciente.guardia_actual_titulo : t.paciente.guardia_proxima_titulo}</h2>

      {!guardia && <div className="estado-vacio">{t.paciente.sin_guardia}</div>}

      {guardia && (
        <div className={`guardia-card guardia-${guardia.estado}`}>
          <div className="guardia-card-paciente">{t.paciente.asistente_asignado}: {asistente?.nombre || t.paciente.sin_asistente}</div>
          <div className="guardia-card-detalle">
            {guardia.fecha} · {guardia.hora_inicio?.slice(0, 5)} - {guardia.hora_fin?.slice(0, 5)}
          </div>
          {guardiaActiva && !guardiaActiva.checkin_at && <div className="guardia-card-detalle">{t.paciente.checkin_pendiente}</div>}
          {enCamino && <div className="guardia-card-detalle">{t.paciente.en_camino}</div>}
        </div>
      )}

      {/* Apagado el mapa, la Familia sigue viendo que el Asistente llegó y que se fue: lo
          que desaparece es el recorrido, el título incluido. */}
      {guardiaActiva && veUbicacionEnVivo && (
        <>
          <h2 style={{ marginTop: '1.5rem' }}>{t.paciente.ubicacion_en_vivo}</h2>
          {ubicacion ? (
            <>
              <iframe
                className="mapa-embed"
                title={t.paciente.ubicacion_en_vivo}
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${ubicacion.lng - 0.01}%2C${ubicacion.lat - 0.01}%2C${ubicacion.lng + 0.01}%2C${ubicacion.lat + 0.01}&layer=mapnik&marker=${ubicacion.lat}%2C${ubicacion.lng}`}
              />
              <p className="mapa-actualizado">{t.paciente.ubicacion_actualizada.replace('{segundos}', segundosDesde(ubicacion.at))}</p>
            </>
          ) : (
            /* Sin esto el título y el mapa desaparecían juntos, y la Familia no sabía si el
               seguimiento no estaba andando o si todavía no había llegado ninguna posición. */
            <p className="mapa-actualizado">{t.paciente.ubicacion_sin_datos}</p>
          )}
        </>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '1.5rem' }}>
        {/* Primero de la lista a propósito: arriba se ve una sola guardia, y la pregunta que
            sigue siempre es qué pasa el resto de la semana. */}
        <Link to={`/pacientes/${id}/guardias`} className="btn btn-secondary btn-full">
          {t.paciente.ver_guardias_de_la_semana}
        </Link>
        <Link to={`/pacientes/${id}/reportes`} className="btn btn-secondary btn-full">
          {t.paciente.ver_reportes}
        </Link>
        {veAlertas && (
          <Link to={`/pacientes/${id}/alertas`} className="btn btn-secondary btn-full">
            {t.paciente.ver_alertas}
          </Link>
        )}
        <Link to={`/pacientes/${id}/asistente`} className="btn btn-secondary btn-full">
          {t.paciente.ver_asistente}
        </Link>
        {seVe(INTERRUPTOR_DE_LA_PANTALLA.suscripcion) && (
          <Link to={`/pacientes/${id}/suscripcion`} className="btn btn-secondary btn-full">
            {t.paciente.ver_suscripcion}
          </Link>
        )}
        {seVe(INTERRUPTOR_DE_LA_PANTALLA.medicacion) && (
          <Link to={`/pacientes/${id}/medicacion`} className="btn btn-secondary btn-full">
            {t.paciente.ver_medicacion}
          </Link>
        )}
      </div>
    </div>
  );
}
