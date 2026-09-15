import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import { entrarConLaLlaveDelAparato, esteAparatoGuardaLlaves, loCancelaronAMano } from '../lib/llaveDelDispositivo';

export default function Login() {
  const { login } = useAuth();
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [hayLlave, setHayLlave] = useState(false);
  const [entrandoConLlave, setEntrandoConLlave] = useState(false);

  // Se pregunta una sola vez, al abrir: ofrecer una puerta que este aparato no puede abrir es peor
  // que no ofrecerla. Mientras no conteste, el botón no está.
  useEffect(() => {
    let vigente = true;
    esteAparatoGuardaLlaves().then((puede) => {
      if (vigente) setHayLlave(puede);
    });
    return () => {
      vigente = false;
    };
  }, []);

  async function alEnviar(evento) {
    evento.preventDefault();
    setError('');
    setEnviando(true);
    const { error: errorLogin } = await login(email, password);
    setEnviando(false);
    if (errorLogin) {
      setError(t.auth.error_credenciales);
    }
  }

  async function alEntrarConLlave() {
    setError('');
    setEntrandoConLlave(true);
    try {
      // Si sale bien no hay nada que hacer acá: la sesión queda abierta y quien escucha los
      // cambios de sesión cambia de pantalla solo.
      await entrarConLaLlaveDelAparato('asistente');
    } catch (errorLlave) {
      // Cancelar no es fallar. Quien cierra el pedido del aparato a propósito no necesita que le
      // avisen nada: la contraseña sigue estando ahí abajo.
      if (!loCancelaronAMano(errorLlave)) setError(t.auth.llave_error);
    } finally {
      setEntrandoConLlave(false);
    }
  }

  return (
    <div className="login-pantalla">
      <div className="login-card">
        <h1>{t.auth.titulo}</h1>
        <p className="login-subtitulo">{t.auth.subtitulo}</p>
        {/* El motivo queda atado a los dos campos y no a uno: no se dice cuál de los dos está
            mal, a propósito, porque decirlo le regalaría a cualquiera la mitad de la
            respuesta. Los dos quedan marcados y los dos leen el mismo motivo. */}
        {error && <div id="login-error" className="alert alert-error" role="alert">{error}</div>}
        <form onSubmit={alEnviar}>
          <div className="form-field">
            <label htmlFor="email">{t.auth.email}</label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error) setError('');
              }}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </div>
          <div className="form-field">
            <label htmlFor="password">{t.auth.password}</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError('');
              }}
              required
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? 'login-error' : undefined}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-full" disabled={enviando}>
            {enviando ? t.auth.ingresando : t.auth.ingresar}
          </button>
        </form>
        {hayLlave && (
          <>
            <div className="login-separador">{t.auth.llave_o}</div>
            <button
              type="button"
              className="btn btn-secondary btn-full"
              onClick={alEntrarConLlave}
              disabled={entrandoConLlave || enviando}
            >
              {entrandoConLlave ? t.auth.llave_esperando : t.auth.llave_entrar}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
