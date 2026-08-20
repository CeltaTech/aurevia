import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { hoyISO } from '../lib/horarios';
import { useLocale } from '../i18n/LocaleContext';
import { traducirValor } from '../i18n/valores';

// Las fechas las escribe el teléfono, no esta pantalla. `toLocaleDateString` con el idioma
// elegido devuelve "jueves, 20 de agosto", "Thursday, August 20" y "quinta-feira, 20 de agosto"
// sin que haya que escribir los nombres de los días y de los meses tres veces en el archivo de
// textos. No es texto de la aplicación: es una fecha dicha en el idioma de quien mira.
//
// La hora del medio (`T00:00:00`) no es un detalle: sin ella, `2026-08-20` se entiende como
// medianoche en Londres, y en Buenos Aires eso todavía es el 19. La Familia vería la semana
// corrida un día.
function enPalabras(fechaISO, locale, opciones) {
  return new Date(`${fechaISO}T00:00:00`).toLocaleDateString(locale, opciones);
}

// La hora en que el Asistente llegó o se fue. Se guarda como un momento exacto, así que acá se
// muestra en el reloj del teléfono de quien mira.
//
// Reloj de 24 horas en los tres idiomas, a propósito. El horario de la guardia sale de la base
// escrito así —`08:00` a `16:00`— y no hay forma de escribirlo de otra manera. Dejar que el
// idioma elija pondría "Llegó a las 08:03 a. m." justo debajo de "08:00 - 16:00", dos relojes
// distintos en la misma tarjeta, que es lo que hace dudar de si llegó tarde o no.
function horaDelMomento(momento, locale) {
  return new Date(momento).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function Guardias() {
  const { id } = useParams();
  const { t, locale } = useLocale();
  // El día desde el que se pide. Arranca en el de hoy —el de este teléfono, no el del
  // servidor— y cambia cuando se camina a la semana de al lado.
  const [dia, setDia] = useState(hoyISO);
  const [semana, setSemana] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let activo = true;
    setCargando(true);
    api
      .guardiasDelPaciente(id, dia)
      .then((data) => {
        if (!activo) return;
        setSemana(data);
        setError('');
      })
      .catch(() => {
        if (activo) setError(t.comun.error_generico);
      })
      .finally(() => {
        if (activo) setCargando(false);
      });
    return () => {
      activo = false;
    };
  }, [id, dia]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (semana === null) return <div className="estado-cargando">{t.comun.cargando}</div>;

  const hoy = hoyISO();
  // Comparar fechas escritas así —`2026-08-20`— es comparar dos textos, y da bien: el año va
  // primero. No hace falta ninguna cuenta de calendario para saber si hoy cae en esta semana.
  const mirandoEstaSemana = hoy >= semana.desde && hoy <= semana.hasta;
  const opcionesDelRango = { day: 'numeric', month: 'long' };
  const rango = `${enPalabras(semana.desde, locale, opcionesDelRango)} – ${enPalabras(semana.hasta, locale, opcionesDelRango)}`;
  const vacia = semana.dias.every((d) => d.guardias.length === 0);

  return (
    <div>
      <Link to={`/pacientes/${id}`} className="btn btn-secondary" style={{ marginBottom: '1rem', fontSize: '0.8rem', padding: '0.4rem 1rem' }}>
        <span aria-hidden="true">←</span> {t.comun.volver}
      </Link>
      <h1>{t.guardias.titulo}</h1>

      {/* Los dos botones quedan apagados mientras la semana nueva está viajando: si no, dos
          toques seguidos piden dos semanas y llega primero la que se pidió después. */}
      <div className="semana-navegador">
        <button type="button" className="btn btn-secondary" disabled={cargando} onClick={() => setDia(semana.semanaAnterior)}>
          <span aria-hidden="true">←</span> {t.guardias.semana_anterior}
        </button>
        <span className="semana-rango">{rango}</span>
        <button type="button" className="btn btn-secondary" disabled={cargando} onClick={() => setDia(semana.semanaSiguiente)}>
          {t.guardias.semana_siguiente} <span aria-hidden="true">→</span>
        </button>
      </div>

      {/* El atajo de vuelta aparece solo cuando hace falta. Sin él, quien se fue cuatro semanas
          para atrás tiene que tocar cuatro veces para volver a lo que le importa. */}
      {!mirandoEstaSemana && (
        <button type="button" className="btn btn-secondary btn-full" disabled={cargando} onClick={() => setDia(hoy)} style={{ marginBottom: '1rem' }}>
          {t.guardias.esta_semana}
        </button>
      )}

      {vacia ? (
        <div className="estado-vacio">{t.guardias.sin_guardias_en_la_semana}</div>
      ) : (
        semana.dias.map((d) => (
          <div key={d.fecha} className="semana-dia">
            <div className="semana-dia-titulo">
              <span className="semana-dia-fecha">
                {enPalabras(d.fecha, locale, { weekday: 'long', day: 'numeric', month: 'long' })}
              </span>
              {d.fecha === hoy && <span className="badge">{t.guardias.hoy}</span>}
            </div>

            {d.guardias.length === 0 ? (
              <div className="semana-dia-vacio">{t.guardias.sin_guardias_en_el_dia}</div>
            ) : (
              d.guardias.map((g) => (
                <div key={g.id} className={`guardia-card guardia-${g.estado}`}>
                  <div className="guardia-card-paciente">{g.asistente || t.paciente.sin_asistente}</div>
                  <div className="guardia-card-detalle">
                    {g.hora_inicio?.slice(0, 5)} - {g.hora_fin?.slice(0, 5)}
                  </div>
                  <div style={{ marginTop: '0.4rem' }}>
                    {/* Quién canceló manda sobre el estado: "cancelada" a secas deja a la
                        Familia sin saber si fue una decisión suya o de la Prestadora. */}
                    <span className="badge">
                      {g.cancelacion_origen
                        ? traducirValor(t.guardias, `cancelo_${g.cancelacion_origen}`)
                        : traducirValor(t.guardias, `estado_${g.estado}`)}
                    </span>
                  </div>
                  {/* La hora real de llegada y de salida es lo que separa "estaba programada"
                      de "pasó de verdad". Solo se muestra la que está registrada. */}
                  {g.checkin_at && (
                    <div className="guardia-card-detalle">{t.guardias.llegada.replace('{hora}', horaDelMomento(g.checkin_at, locale))}</div>
                  )}
                  {g.checkout_at && (
                    <div className="guardia-card-detalle">{t.guardias.salida.replace('{hora}', horaDelMomento(g.checkout_at, locale))}</div>
                  )}
                </div>
              ))
            )}
          </div>
        ))
      )}
    </div>
  );
}
