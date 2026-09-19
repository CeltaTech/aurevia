import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { FormField } from '../components/ui/FormField';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { errorDeLaRespuesta, mensajeDeError } from '../lib/errores';
import { MINIMO_DE_CARACTERES, claveAceptable } from '../lib/reglaDeClave';

const API_URL = import.meta.env.VITE_API_URL;

// Los tres motivos que contesta el motor son definitivos: con ese mismo enlace, reintentar no
// sirve nunca, así que el formulario se retira en vez de invitar a un intento que va a fallar.
const MOTIVOS_SIN_REINTENTO = ['token_invalido', 'token_ya_usado', 'token_vencido'];

// Donde se elige la clave nueva, con el enlace que llegó por correo.
//
// Es la hermana de `ActivarCuenta`: el mismo formulario, contra otra puerta del motor. Se
// escriben aparte porque no son lo mismo —una activa una cuenta que nunca se usó y la otra
// reemplaza la clave de una que está en uso—, y los enlaces de una no sirven en la otra.
export function ClaveNueva() {
  const { t } = useLocale();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [motivoSinReintento, setMotivoSinReintento] = useState('');
  const [errorCampo, setErrorCampo] = useState(null);
  const [cambiada, setCambiada] = useState(false);

  const avisoDe = (campo) => (errorCampo?.campo === campo ? errorCampo.texto : undefined);

  async function handleGuardar(evento) {
    evento.preventDefault();
    setError(null);
    setErrorCampo(null);

    if (!claveAceptable(password)) {
      setErrorCampo({
        campo: 'password',
        texto: t.auth.activar_password_corta.replace('{{minimo}}', MINIMO_DE_CARACTERES),
      });
      return;
    }
    if (password !== confirmacion) {
      setErrorCampo({ campo: 'confirmacion', texto: t.auth.activar_no_coincide });
      return;
    }

    setEnviando(true);
    try {
      const respuesta = await fetch(`${API_URL}/api/recuperar-clave/canjear`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const resultado = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw errorDeLaRespuesta(respuesta, resultado);
      setCambiada(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
      if (MOTIVOS_SIN_REINTENTO.includes(err?.motivo)) setMotivoSinReintento(err.motivo);
    } finally {
      setEnviando(false);
    }
  }

  if (!token) {
    return (
      <div className="login-pantalla">
        <div className="login-card">
          <h1>{t.auth.clave_nueva_titulo}</h1>
          <Alert variant="error">{t.auth.activar_token_invalido}</Alert>
          <Link to="/recuperar-clave">{t.auth.recuperar_titulo}</Link>
        </div>
      </div>
    );
  }

  if (cambiada) {
    return (
      <div className="login-pantalla">
        <div className="login-card">
          <h1>{t.auth.clave_nueva_titulo}</h1>
          <Alert variant="success">{t.auth.clave_nueva_exito}</Alert>
          <Link to="/login">{t.auth.activar_ingresar}</Link>
        </div>
      </div>
    );
  }

  if (motivoSinReintento) {
    return (
      <div className="login-pantalla">
        <div className="login-card">
          <h1>{t.auth.clave_nueva_titulo}</h1>
          <Alert variant="error">{error}</Alert>
          {motivoSinReintento === 'token_ya_usado' ? (
            <Link to="/login">{t.auth.activar_ingresar}</Link>
          ) : (
            <Link to="/recuperar-clave">{t.auth.recuperar_titulo}</Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="login-pantalla">
      <form className="login-card" onSubmit={handleGuardar}>
        <h1>{t.auth.clave_nueva_titulo}</h1>
        <p className="login-subtitulo">{t.auth.clave_nueva_subtitulo}</p>

        {error && <Alert variant="error">{error}</Alert>}

        <FormField
          label={t.auth.activar_password_nueva}
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={avisoDe('password')}
        />

        <FormField
          label={t.auth.activar_password_confirmar}
          name="confirmacion"
          type="password"
          autoComplete="new-password"
          required
          value={confirmacion}
          onChange={(e) => setConfirmacion(e.target.value)}
          error={avisoDe('confirmacion')}
        />

        <Button type="submit" disabled={enviando}>
          {enviando ? t.auth.activar_enviando : t.auth.clave_nueva_confirmar}
        </Button>
      </form>
    </div>
  );
}
