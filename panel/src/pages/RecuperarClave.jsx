import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { FormField } from '../components/ui/FormField';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { errorDeLaRespuesta, mensajeDeError } from '../lib/errores';
import { segmentoDeLaPuerta } from '../lib/puertaDeIngreso';

const API_URL = import.meta.env.VITE_API_URL;

// Donde alguien que perdió su clave pide el enlace para elegir una nueva.
//
// LA RESPUESTA ES LA MISMA EXISTA EL CORREO O NO, y eso no es un descuido de la pantalla: lo
// decide el motor, que contesta igual en los dos casos. Si contestara distinto, esta pantalla
// sería una forma de averiguar quién tiene cuenta, preguntando de a un correo por vez, sin
// necesidad de tener sesión.
//
// LA PRESTADORA SALE DE LA DIRECCIÓN POR DONDE SE ENTRÓ. Cada Prestadora donde la persona trabaja
// es una cuenta distinta con su propia clave, así que el pedido tiene que decir de cuál se trata,
// y lo dice la dirección del navegador, no un casillero que se pueda escribir.
export function RecuperarClave() {
  const { t } = useLocale();
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  const [pedido, setPedido] = useState(false);

  async function handlePedir(evento) {
    evento.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      // El mismo segmento que arma la pantalla de ingreso, de un solo lugar: si las dos lo
      // dedujeran por su cuenta, una dirección con subdominio entraría por una puerta y recuperaría
      // por otra (`lib/puertaDeIngreso.js`).
      const puerta = encodeURIComponent(segmentoDeLaPuerta(window.location.hostname));
      const respuesta = await fetch(`${API_URL}/api/recuperar-clave/pedir/${puerta}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const resultado = await respuesta.json().catch(() => ({}));
      if (!respuesta.ok) throw errorDeLaRespuesta(respuesta, resultado);
      setPedido(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setEnviando(false);
    }
  }

  if (pedido) {
    return (
      <div className="login-pantalla">
        <div className="login-card">
          <h1>{t.auth.recuperar_titulo}</h1>
          <Alert variant="success">{t.auth.recuperar_listo}</Alert>
          <Link to="/login">{t.auth.recuperar_volver}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="login-pantalla">
      <form className="login-card" onSubmit={handlePedir}>
        <h1>{t.auth.recuperar_titulo}</h1>
        <p className="login-subtitulo">{t.auth.recuperar_subtitulo}</p>

        {error && <Alert variant="error">{error}</Alert>}

        <FormField
          label={t.auth.email}
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <Button type="submit" disabled={enviando}>
          {enviando ? t.auth.recuperar_enviando : t.auth.recuperar_enviar}
        </Button>

        <Link to="/login">{t.auth.recuperar_volver}</Link>
      </form>
    </div>
  );
}
