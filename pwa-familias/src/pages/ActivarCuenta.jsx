import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { errorDeLaRespuesta, mensajeDeError } from '../lib/errores';

const API_URL = import.meta.env.VITE_API_URL;

export default function ActivarCuenta() {
  const { t } = useLocale();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  // Los dos problemas de acá son de un campo concreto —la contraseña corta, la repetida que no
  // coincide—, así que el aviso se cuelga de ese campo y no de todo el formulario: quien lo
  // recorre con un lector de pantalla lo escucha al llegar ahí. Arriba queda el cartel general
  // solo para lo que contesta el motor, que no es de ningún campo en particular.
  const [errorCampo, setErrorCampo] = useState(null);

  const avisoDe = (campo) => (errorCampo?.campo === campo ? errorCampo.texto : undefined);
  const [activada, setActivada] = useState(false);

  async function alEnviar(evento) {
    evento.preventDefault();
    setError('');
    setErrorCampo(null);

    if (password.length < 8) {
      setErrorCampo({ campo: 'password', texto: t.auth.activar_password_corta });
      return;
    }
    if (password !== confirmacion) {
      setErrorCampo({ campo: 'confirmacion', texto: t.auth.activar_no_coincide });
      return;
    }

    setEnviando(true);
    try {
      const respuesta = await fetch(`${API_URL}/api/activar-cuenta`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const resultado = await respuesta.json();
      // La explicación viene del motor, que es el único que sabe qué pasó: manda un motivo y
      // acá se busca la frase en las traducciones. Esta pantalla no compara códigos.
      if (!respuesta.ok) throw errorDeLaRespuesta(respuesta, resultado);
      setActivada(true);
    } catch (err) {
      setError(mensajeDeError(err, t, 'activar la cuenta'));
    } finally {
      setEnviando(false);
    }
  }

  if (!token) {
    return (
      <div className="login-pantalla">
        <div className="login-card">
          <h1>{t.auth.activar_titulo}</h1>
          <div className="alert alert-error" role="alert">{t.auth.activar_token_invalido}</div>
        </div>
      </div>
    );
  }

  if (activada) {
    return (
      <div className="login-pantalla">
        <div className="login-card">
          <h1>{t.auth.activar_titulo}</h1>
          <div className="alert alert-info" role="status">{t.auth.activar_exito}</div>
          <Link to="/login" className="btn btn-primary btn-full">{t.auth.ingresar}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="login-pantalla">
      <div className="login-card">
        <h1>{t.auth.activar_titulo}</h1>
        <p className="login-subtitulo">{t.auth.activar_subtitulo}</p>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <form onSubmit={alEnviar}>
          <div className="form-field">
            <label htmlFor="password">{t.auth.activar_password_nueva}</label>
            <input
              id="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              aria-invalid={avisoDe('password') ? 'true' : undefined}
              aria-describedby={avisoDe('password') ? 'password-error' : undefined}
            />
            {avisoDe('password') && (
              <span className="form-error" id="password-error" role="alert">{avisoDe('password')}</span>
            )}
          </div>
          <div className="form-field">
            <label htmlFor="confirmacion">{t.auth.activar_password_confirmar}</label>
            <input
              id="confirmacion"
              type="password"
              autoComplete="new-password"
              value={confirmacion}
              onChange={(e) => setConfirmacion(e.target.value)}
              required
              aria-invalid={avisoDe('confirmacion') ? 'true' : undefined}
              aria-describedby={avisoDe('confirmacion') ? 'confirmacion-error' : undefined}
            />
            {avisoDe('confirmacion') && (
              <span className="form-error" id="confirmacion-error" role="alert">{avisoDe('confirmacion')}</span>
            )}
          </div>
          <button type="submit" className="btn btn-primary btn-full" disabled={enviando}>
            {enviando ? t.auth.activar_enviando : t.auth.activar_confirmar}
          </button>
        </form>
      </div>
    </div>
  );
}
