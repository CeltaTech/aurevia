// La hoja que firma el titular de la cuenta: qué puede ver cada persona de su círculo familiar.
//
// CÓMO SE FIRMA, Y POR QUÉ ASÍ. El titular le dice a la Prestadora qué quiere, la Prestadora lo
// carga, el sistema arma el documento y acá se lo muestra tal cual quedó guardado. Firmar es
// entrar con la clave —eso ya pasó, si está mirando esta pantalla— y confirmar con un código que
// llega por otro camino. Las dos cosas juntas son lo que después permite sostener que la
// instrucción la dio él, el día que alguien diga que nunca autorizó nada.
//
// EL TEXTO SE MUESTRA TAL CUAL LLEGÓ. Es texto plano, escrito con sus renglones y su sangría, y
// se guardó entero el día que se armó: si mañana cambia una descripción del catálogo, lo que se
// ve acá sigue siendo lo que se firmó. Por eso no se lo vuelve a armar ni se lo reacomoda.
//
// ESTO NO FRENA NADA. La instrucción ya rige desde que la Prestadora la cargó; lo que falta es la
// constancia firmada. Por eso el aviso de las otras pantallas no bloquea, y por eso acá se puede
// volver sin firmar.

import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { useCirculo } from '../context/CirculoContext';
import { mensajeDeError } from '../lib/errores';

const LARGO_DEL_CODIGO = 6;

// Cuánto queda a la vista la confirmación antes de volver sola. Lo suficiente para leerla: quien
// firmó no tiene nada más que hacer en esta pantalla, y dejarlo parado acá lo obliga a buscar el
// camino de vuelta.
const MS_ANTES_DE_VOLVER = 2500;

export default function FirmarInstruccion() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { recargar } = useCirculo();

  // `undefined` mientras se pregunta, `null` cuando no hay ninguna: son dos estados distintos y
  // se dibujan distinto.
  const [instruccion, setInstruccion] = useState(undefined);
  const [error, setError] = useState('');
  const [pidiendoCodigo, setPidiendoCodigo] = useState(false);
  const [enviadoA, setEnviadoA] = useState(null);
  const [codigo, setCodigo] = useState('');
  const [errorDelCodigo, setErrorDelCodigo] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  const [firmado, setFirmado] = useState(false);
  const reloj = useRef(null);

  // A dónde se vuelve. El aviso que trae hasta acá deja anotado de qué pantalla salió, así que se
  // vuelve a esa y no a un lugar fijo. Escribiendo la dirección a mano no hay nada anotado y se
  // cae a la pantalla de siempre.
  const desde = location.state?.desde ?? '/pacientes';

  useEffect(() => {
    let activo = true;
    api
      .instruccionPendiente()
      .then(({ instruccion: pendiente }) => {
        if (activo) setInstruccion(pendiente ?? null);
      })
      .catch((e) => {
        if (activo) setError(mensajeDeError(e, t, 'instrucción del círculo familiar'));
      });
    return () => {
      activo = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (reloj.current) clearTimeout(reloj.current);
    };
  }, []);

  async function pedirCodigo() {
    setPidiendoCodigo(true);
    setErrorDelCodigo('');
    try {
      const { enviadoA: destino } = await api.pedirCodigoDeInstruccion(instruccion.id);
      setEnviadoA(destino);
      // El código anterior, si lo hubo, ya no sirve: dejar escrito el que se había tipeado
      // llevaría a confirmar con uno vencido y a leer un error que no explica nada.
      setCodigo('');
    } catch (e) {
      setErrorDelCodigo(mensajeDeError(e, t, 'pedir el código de la instrucción'));
    } finally {
      setPidiendoCodigo(false);
    }
  }

  async function confirmar(evento) {
    evento.preventDefault();
    if (codigo.length !== LARGO_DEL_CODIGO) return;
    setConfirmando(true);
    setErrorDelCodigo('');
    try {
      await api.confirmarInstruccion(instruccion.id, codigo);
      setFirmado(true);
      // Recién ahora el aviso de instrucción pendiente tiene que desaparecer de todas las
      // pantallas, y no cuando la firma todavía estaba viajando.
      recargar();
      reloj.current = setTimeout(() => navigate(desde, { replace: true }), MS_ANTES_DE_VOLVER);
    } catch (e) {
      setErrorDelCodigo(mensajeDeError(e, t, 'confirmar la instrucción'));
    } finally {
      setConfirmando(false);
    }
  }

  const volver = (
    <Link to={desde} className="btn btn-secondary" style={{ marginBottom: '1rem', fontSize: '0.8rem', padding: '0.4rem 1rem' }}>
      <span aria-hidden="true">←</span> {t.comun.volver}
    </Link>
  );

  if (error) {
    return (
      <div>
        {volver}
        <div className="alert alert-error" role="alert">{error}</div>
      </div>
    );
  }

  if (instruccion === undefined) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;

  if (instruccion === null) {
    return (
      <div>
        {volver}
        <h1>{t.instruccion.titulo}</h1>
        <div className="estado-vacio" role="status">{t.instruccion.sin_instruccion}</div>
      </div>
    );
  }

  return (
    <div>
      {volver}
      <h1>{t.instruccion.titulo}</h1>
      <p className="guardia-card-detalle">{t.instruccion.explicacion}</p>

      {/* El documento, con sus renglones y su sangría. Va en un `pre` para que ni el navegador ni
          esta pantalla le acomoden nada: lo que se lee tiene que ser exactamente lo que se firma. */}
      <pre className="documento-instruccion">{instruccion.documento_texto}</pre>

      {firmado ? (
        <div className="alert alert-success" role="status">{t.instruccion.firmada}</div>
      ) : (
        <>
          <h2 style={{ marginTop: '1.5rem' }}>{t.instruccion.firmar_titulo}</h2>
          <p className="guardia-card-detalle">{t.instruccion.firmar_explicacion}</p>

          {enviadoA && (
            <div className="alert alert-info" role="status">
              {enviadoA === 'whatsapp' ? t.instruccion.codigo_enviado_whatsapp : t.instruccion.codigo_enviado_email}
            </div>
          )}

          <button type="button" className="btn btn-secondary btn-full" disabled={pidiendoCodigo} onClick={pedirCodigo}>
            {pidiendoCodigo
              ? t.instruccion.codigo_pidiendo
              : enviadoA
              ? t.instruccion.codigo_pedir_otro
              : t.instruccion.codigo_pedir}
          </button>

          {enviadoA && (
            <form onSubmit={confirmar} style={{ marginTop: '1rem' }}>
              <div className="form-field">
                <label htmlFor="codigo-instruccion">{t.instruccion.campo_codigo}</label>
                <input
                  id="codigo-instruccion"
                  // El teclado numérico y el relleno automático del código que acaba de llegar:
                  // sin esto hay que salir de la aplicación a copiarlo a mano.
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={LARGO_DEL_CODIGO}
                  value={codigo}
                  // Se deja entrar sólo dígitos: pegar el código con un espacio o un guion
                  // adelante termina en un rechazo que no explica nada.
                  onChange={(e) => setCodigo(e.target.value.replace(/\D/g, '').slice(0, LARGO_DEL_CODIGO))}
                  aria-describedby={errorDelCodigo ? 'codigo-instruccion-error' : undefined}
                  aria-invalid={errorDelCodigo ? 'true' : undefined}
                />
                {errorDelCodigo && <span className="form-error" id="codigo-instruccion-error" role="alert">{errorDelCodigo}</span>}
              </div>
              <button type="submit" className="btn btn-primary btn-full" disabled={confirmando || codigo.length !== LARGO_DEL_CODIGO}>
                {confirmando ? t.instruccion.confirmando : t.instruccion.confirmar}
              </button>
            </form>
          )}

          {/* Cuando todavía no se pidió ningún código no hay campo donde colgar el error, así que
              va acá: si no, un pedido que falla no se ve por ningún lado. */}
          {!enviadoA && errorDelCodigo && <div className="alert alert-error" role="alert">{errorDelCodigo}</div>}
        </>
      )}
    </div>
  );
}
