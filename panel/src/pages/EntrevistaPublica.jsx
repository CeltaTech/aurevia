import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { Alert } from '../components/ui/Alert';
import { errorDeLaRespuesta, mensajeDeError } from '../lib/errores';

/* La pantalla que abre el postulante con el enlace que le llegó por correo.
   ==========================================================================

   SIN SESIÓN A PROPÓSITO. Quien llega acá no tiene cuenta en el producto y no puede tenerla: se
   postuló y todavía no es nadie adentro de la Prestadora. Lo único que trae es la llave larga que
   viaja en su enlace, y con eso alcanza. Es la misma forma que ya tiene la activación de cuenta.

   QUÉ SE VE Y QUÉ NO. Con qué Prestadora es la entrevista, cuándo, y —si es la hora— el botón
   para entrar. Nada del postulante, nada de quien lo va a entrevistar y nada de lo que se haya
   anotado por dentro: el motor no lo manda, y esta pantalla no lo pide.

   LA SALA SÓLO APARECE A LA HORA. Llegar temprano no es equivocarse, así que no hay ningún error:
   el motor contesta bien y dice en qué momento está la cita. Acá eso se convierte en las tres
   cosas que la persona puede necesitar leer —vuelva más tarde, entre ahora, o ya pasó— y no en un
   cartel de falla. */

const API_URL = import.meta.env.VITE_API_URL;

export function EntrevistaPublica() {
  const { llave } = useParams();
  const { t, locale } = useLocale();
  const tr = t.entrevistaPublica;

  const [entrevista, setEntrevista] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let activo = true;
    async function traer() {
      try {
        const respuesta = await fetch(`${API_URL}/api/entrevista/${encodeURIComponent(llave)}`);
        const resultado = await respuesta.json().catch(() => ({}));
        if (!respuesta.ok) throw errorDeLaRespuesta(respuesta, resultado);
        if (activo) setEntrevista(resultado);
      } catch (err) {
        // Una llave que no existe y una que ya no vale se contestan igual a propósito, así que acá
        // las dos se leen como el mismo cartel: este enlace ya no abre nada. Lo demás —el servidor
        // caído, por ejemplo— sí se explica como lo que es.
        if (activo) setError(err);
      } finally {
        if (activo) setCargando(false);
      }
    }
    traer();
    return () => {
      activo = false;
    };
  }, [llave]);

  if (cargando) {
    return (
      <div className="login-pantalla">
        <div className="login-card">
          <p>{t.comun.cargando}</p>
        </div>
      </div>
    );
  }

  if (error) {
    const noEstá = error.motivo === 'no_encontrado';
    return (
      <div className="login-pantalla">
        <div className="login-card">
          <h1>{noEstá ? tr.no_encontrada_titulo : tr.titulo}</h1>
          {noEstá ? (
            <p className="login-subtitulo">{tr.no_encontrada_texto}</p>
          ) : (
            <Alert variant="error">{mensajeDeError(error, t)}</Alert>
          )}
        </div>
      </div>
    );
  }

  const cuando = new Date(entrevista.agendada_para).toLocaleString(locale, {
    dateStyle: 'full',
    timeStyle: 'short',
  });

  return (
    <div className="login-pantalla">
      <div className="login-card">
        {entrevista.logo_url && (
          <img className="login-logo" src={entrevista.logo_url} alt={entrevista.prestadora} />
        )}
        <h1>{tr.titulo}</h1>
        <p className="login-subtitulo">
          {tr.con.replace('{{prestadora}}', entrevista.prestadora)}
        </p>

        <p>
          <strong>{tr.cuando}:</strong> {cuando}
        </p>

        {/* Que esta entrevista no tenga sala es distinto de que todavía no sea la hora: una se
            arregla volviendo más tarde y la otra no se arregla sola, así que se dicen aparte. */}
        {!entrevista.hay_videollamada ? (
          <>
            <h2>{tr.sin_sala_titulo}</h2>
            <p>{tr.sin_sala_texto}</p>
          </>
        ) : entrevista.momento === 'ahora' && entrevista.url ? (
          // La sala es una dirección de afuera, así que el control es un enlace y no un botón:
          // lo que hace es ir a otro lado, no disparar una operación.
          <a className="btn btn-primary" href={entrevista.url} target="_blank" rel="noreferrer">
            {tr.entrar}
          </a>
        ) : entrevista.momento === 'ya_paso' ? (
          <>
            <h2>{tr.ya_paso_titulo}</h2>
            <p>{tr.ya_paso_texto}</p>
          </>
        ) : (
          <>
            <h2>{tr.todavia_no_titulo}</h2>
            <p>{tr.todavia_no_texto}</p>
          </>
        )}
      </div>
    </div>
  );
}
