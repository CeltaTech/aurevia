import { useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { FormField } from '../components/ui/FormField';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { EstadoLista } from '../components/layout/EstadoLista';
import { TelefonoDeLaCuenta } from '../components/cuenta/TelefonoDeLaCuenta';
import { useCuentaSegura } from '../components/cuenta/useCuentaSegura';
import { MINIMO_DE_CARACTERES, claveAceptable } from '../lib/reglaDeClave';

// Donde alguien que ya entró cambia su propia clave.
//
// SE PIDE LA ACTUAL ANTES DE CAMBIARLA, y se comprueba entrando con ella. Una sesión abierta no
// prueba que quien está delante de la pantalla sea el dueño de la cuenta: puede ser cualquiera
// que se sentó frente a una computadora desatendida. Sin ese paso, el cambio de clave sería la
// forma más cómoda de quedarse con una cuenta ajena.
//
// No pasa por el motor: la cuenta se cambia contra el servicio de acceso, con la sesión de quien
// está pidiendo el cambio. Nadie puede cambiar así la de otro.
// Y ACÁ TAMBIÉN SE OFRECE VERIFICAR EL TELÉFONO, porque es el otro momento en que alguien se
// ocupa de cómo entra. Es la misma sección que la pantalla de seguridad de la cuenta, escrita
// una sola vez en `components/cuenta/TelefonoDeLaCuenta.jsx`: no hay un segundo mecanismo, hay
// un segundo lugar desde donde se llega al mismo. Cambiar la contraseña no depende de esto ni
// lo espera: quien no verifica nada cambia su contraseña igual.
export function MiClave() {
  const { t } = useLocale();
  const { session } = useAuth();
  const cuenta = useCuentaSegura();
  const [actual, setActual] = useState('');
  const [password, setPassword] = useState('');
  const [confirmacion, setConfirmacion] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  const [errorCampo, setErrorCampo] = useState(null);
  const [cambiada, setCambiada] = useState(false);

  const avisoDe = (campo) => (errorCampo?.campo === campo ? errorCampo.texto : undefined);

  async function handleGuardar(evento) {
    evento.preventDefault();
    setError(null);
    setErrorCampo(null);
    setCambiada(false);

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

    setGuardando(true);
    try {
      const { error: errorActual } = await supabase.auth.signInWithPassword({
        email: session?.user?.email,
        password: actual,
      });
      if (errorActual) {
        setErrorCampo({ campo: 'actual', texto: t.auth.mi_clave_actual_mal });
        return;
      }

      const { error: errorCambio } = await supabase.auth.updateUser({ password });
      if (errorCambio) throw errorCambio;

      setActual('');
      setPassword('');
      setConfirmacion('');
      setCambiada(true);
    } catch (err) {
      // El texto crudo queda en la consola y a la pantalla va la frase del catálogo.
      console.error('MiClave:', err?.message);
      setError(t.errores.falla_del_sistema);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h1>{t.auth.mi_clave_titulo}</h1>

      <form onSubmit={handleGuardar}>
        {error && <Alert variant="error">{error}</Alert>}
        {cambiada && <Alert variant="success">{t.auth.mi_clave_exito}</Alert>}

        <FormField
          label={t.auth.mi_clave_actual}
          name="actual"
          type="password"
          autoComplete="current-password"
          required
          value={actual}
          onChange={(e) => setActual(e.target.value)}
          error={avisoDe('actual')}
        />

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

        <Button type="submit" disabled={guardando}>
          {guardando ? t.auth.mi_clave_guardando : t.auth.mi_clave_guardar}
        </Button>
      </form>

      <EstadoLista estado={cuenta.estado} error={cuenta.error} recargar={cuenta.recargar}>
        {cuenta.datos && (
          <TelefonoDeLaCuenta datos={cuenta.datos} recargar={cuenta.recargar} />
        )}
      </EstadoLista>
    </div>
  );
}
