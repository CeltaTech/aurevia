import { useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { FormField } from '../components/ui/FormField';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { errorDeLaRespuesta, mensajeDeError } from '../lib/errores';

const API_URL = import.meta.env.VITE_API_URL;

// Los tres motivos que contesta el motor son definitivos: con ese mismo enlace, reintentar no
// sirve nunca. Cuando llega uno, el formulario se retira en vez de quedar invitando a un intento
// que ya se sabe que va a fallar.
const MOTIVOS_SIN_REINTENTO = ['token_invalido', 'token_ya_usado', 'token_vencido'];

// Donde el administrador de una Prestadora nueva elige su contraseña.
//
// Va afuera del Panel, al lado de la entrada y del segundo factor, porque quien llega acá
// todavía no tiene con qué entrar: trae la llave que le llegó por correo, y esa llave es toda
// su credencial. El motor la revisa en `/api/activar-cuenta`, que es la misma puerta que usan
// las dos aplicaciones de teléfono: la llave no distingue rol, así que no hay una segunda.
//
// Existe porque el alta de una Prestadora la crea desde CeltaTech (`panelPrestadoras.js`), y
// quien la da de alta no puede ver ni elegir la contraseña de nadie.
export function ActivarCuenta() {
  const { t } = useLocale();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [motivoSinReintento, setMotivoSinReintento] = useState('');
  // Los dos problemas de acá son de un campo concreto —la contraseña corta, la repetida que no
  // coincide—, así que el aviso se cuelga de ese campo y no de todo el formulario. Arriba queda
  // el cartel general sólo para lo que contesta el motor, que no es de ningún campo.
  const [errorCampo, setErrorCampo] = useState(null);
  const [activada, setActivada] = useState(false);

  const avisoDe = (campo) => (errorCampo?.campo === campo ? errorCampo.texto : undefined);

  async function handleActivar(evento) {
    evento.preventDefault();
    setError(null);
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
      const resultado = await respuesta.json().catch(() => ({}));
      // La explicación viene del motor, que es el único que sabe qué pasó: manda un motivo y acá
      // se busca la frase en las traducciones. Esta pantalla no compara códigos.
      if (!respuesta.ok) throw errorDeLaRespuesta(respuesta, resultado);
      setActivada(true);
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
          <h1>{t.auth.activar_titulo}</h1>
          <Alert variant="error">{t.auth.activar_token_invalido}</Alert>
        </div>
      </div>
    );
  }

  if (activada) {
    return (
      <div className="login-pantalla">
        <div className="login-card">
          <h1>{t.auth.activar_titulo}</h1>
          <Alert variant="success">{t.auth.activar_exito}</Alert>
          <Link to="/login">{t.auth.activar_ingresar}</Link>
        </div>
      </div>
    );
  }

  if (motivoSinReintento) {
    return (
      <div className="login-pantalla">
        <div className="login-card">
          <h1>{t.auth.activar_titulo}</h1>
          <Alert variant="error">{error}</Alert>
          {motivoSinReintento === 'token_ya_usado' && (
            <Link to="/login">{t.auth.activar_ingresar}</Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="login-pantalla">
      <form className="login-card" onSubmit={handleActivar}>
        <h1>{t.auth.activar_titulo}</h1>
        <p className="login-subtitulo">{t.auth.activar_subtitulo}</p>

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
          {enviando ? t.auth.activar_enviando : t.auth.activar_confirmar}
        </Button>
      </form>
    </div>
  );
}
