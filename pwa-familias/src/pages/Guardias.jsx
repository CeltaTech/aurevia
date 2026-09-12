import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { hoyISO, horaDelMomento } from '../lib/horarios';
import { enPalabras } from '../lib/fechaEnPalabras';
import { useLocale } from '../i18n/LocaleContext';
import { traducirValor } from '../i18n/valores';

// La hora en que el Asistente llegó o se fue la escribe `horaDelMomento`, en `lib/horarios.js`:
// la misma cuenta la usan la pantalla del Paciente y la aplicación de los Asistentes, y un reloj
// que se escribe distinto en cada pantalla es la clase de cosa que hace dudar de si llegó tarde.

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

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (semana === null) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;

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
        <div className="estado-vacio" role="status">{t.guardias.sin_guardias_en_la_semana}</div>
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
