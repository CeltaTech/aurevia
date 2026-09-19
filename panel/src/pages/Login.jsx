import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { anotarNombreDeLaPrestadora } from '../i18n/marcaEnElTexto';
import { correoDeAcceso } from '../lib/correoDeAcceso';
import { segmentoDeLaPuerta, laPuertaEstaReconocida } from '../lib/puertaDeIngreso';
import { FormField } from '../components/ui/FormField';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';

const API_URL = import.meta.env.VITE_API_URL;

// LA PUERTA POR DONDE SE ENTRA DICE DE QUÉ PRESTADORA SE TRATA.
//
// Cada Prestadora entra por su propia dirección. De ahí sale la Prestadora, nunca de un casillero
// donde se elija ni de nada que venga en el pedido. Sin saber de cuál se trata no hay ninguna
// cuenta que abrir: la misma persona tiene una cuenta distinta en cada Prestadora donde trabaja, y
// con qué correo se le habla al servicio de acceso lleva la Prestadora adentro
// (`lib/correoDeAcceso.js`). El mecanismo del motor es el mismo que ya usa recuperar la clave, y no
// se inventa otro: la pantalla traduce la dirección a un segmento y el motor lo resuelve contra el
// dominio configurado (`lib/puertaDeIngreso.js`).
//
// FALLA CERRADO. Mientras no se reconozca la Prestadora no se ofrece entrar, no se ofrece elegir
// ninguna y no se dice cuáles existen.
//
// AL ENTRAR NO SE INSINÚA NADA. Un correo con cuenta en otra Prestadora arma, en esta puerta, una
// cuenta de acceso que no existe: falla por el mismo camino, con el mismo mensaje y con la misma
// demora que un correo que no existe en ninguna parte.
//
// LA MARCA ES LA DE ESA PRESTADORA, que es a quien conoce el que entra. La línea al pie —«con la
// tecnología de …»— va igual, siempre.
export function Login() {
  const { t } = useLocale();
  const { login, session, usuario } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState(null);
  // Los cuatro estados de la pantalla: mientras se pregunta, cuando no se pudo preguntar, cuando
  // la dirección no es de ninguna Prestadora, y cuando se supo de quién es.
  const [estado, setEstado] = useState('cargando');
  const [puerta, setPuerta] = useState(null);

  useEffect(() => {
    let vigente = true;
    (async () => {
      try {
        const segmento = encodeURIComponent(segmentoDeLaPuerta(window.location.hostname));
        const respuesta = await fetch(`${API_URL}/api/publico/${segmento}/marca`);
        const resultado = await respuesta.json().catch(() => ({}));
        if (!vigente) return;
        if (respuesta.status === 404) {
          setEstado('desconocida');
          return;
        }
        if (!respuesta.ok || !laPuertaEstaReconocida(resultado)) {
          setEstado('desconocida');
          return;
        }
        setPuerta(resultado);
        // Con qué nombre se presenta la Prestadora, para las frases que la nombran con el
        // marcador {{prestadora}} (i18n/marcaEnElTexto.js).
        anotarNombreDeLaPrestadora(resultado.nombre);
        setEstado('listo');
      } catch (err) {
        if (!vigente) return;
        console.error('Login:', err?.message);
        setEstado('error');
      }
    })();
    return () => {
      vigente = false;
    };
  }, []);

  // AuthContext actualiza session/usuario de forma asíncrona (listener
  // onAuthStateChange), no en el mismo tick en que login() resuelve — navegar
  // a "/" inmediatamente después de login() usaba el estado viejo (todavía sin
  // sesión) y ProtectedRoute rebotaba de vuelta acá. Se redirige recién cuando
  // el estado de auth ya está resuelto de verdad.
  useEffect(() => {
    if (session && usuario) {
      navigate('/', { replace: true });
    }
  }, [session, usuario, navigate]);

  async function handleSubmit(evento) {
    evento.preventDefault();
    setEnviando(true);
    setError(null);

    try {
      // El correo con el que se le habla al servicio de acceso, armado con la Prestadora de esta
      // puerta. Nunca el que la persona escribió: ése es el mismo en todas.
      const correo = await correoDeAcceso(email, puerta.prestadoraId);
      const { error: errorLogin } = await login(correo, password);
      if (errorLogin) {
        setError(t.auth.error_credenciales);
        setEnviando(false);
      }
    } catch (err) {
      // El mismo mensaje que cualquier otro fallo de entrada: acá no se distingue nada.
      console.error('Login:', err?.message);
      setError(t.auth.error_credenciales);
      setEnviando(false);
    }
  }

  const pie = <p className="login-pie">{t.auth.con_tecnologia_de}</p>;

  if (estado === 'cargando') {
    return (
      <div className="login-pantalla">
        <div className="login-card">
          <p>{t.comun.cargando}</p>
          {pie}
        </div>
      </div>
    );
  }

  if (estado !== 'listo') {
    return (
      <div className="login-pantalla">
        <div className="login-card">
          <h1>{t.auth.titulo}</h1>
          <Alert variant="error">
            {estado === 'desconocida' ? t.auth.puerta_desconocida : t.comun.error_generico}
          </Alert>
          {pie}
        </div>
      </div>
    );
  }

  return (
    <div className="login-pantalla">
      <form className="login-card" onSubmit={handleSubmit}>
        {puerta.logoUrl && <img className="login-logo" src={puerta.logoUrl} alt={puerta.nombre ?? ''} />}
        <h1>{puerta.nombre ?? t.auth.titulo}</h1>
        <p className="login-subtitulo">{t.auth.titulo}</p>

        {error && <Alert variant="error">{error}</Alert>}

        <FormField
          label={t.auth.email}
          name="email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <FormField
          label={t.auth.password}
          name="password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <Button type="submit" disabled={enviando}>
          {enviando ? t.auth.ingresando : t.auth.ingresar}
        </Button>

        <Link to="/recuperar-clave">{t.auth.recuperar_link}</Link>
        {pie}
      </form>
    </div>
  );
}
