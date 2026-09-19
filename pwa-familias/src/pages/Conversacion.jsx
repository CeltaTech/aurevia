import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { mensajeDeError } from '../lib/errores';
import HiloDeMensajes from '../components/HiloDeMensajes';

// UNA CONVERSACIÓN DEL MARKETPLACE, DESDE CUALQUIERA DE LAS DOS PUNTAS.
//
// Es el mismo archivo en las dos aplicaciones —original y copia, que genera
// `scripts/sincronizar_copias.mjs`—, porque es la misma conversación. El hilo lo dibuja
// `components/HiloDeMensajes.jsx`, que también es uno solo.
//
// QUIÉN ES «YO». El motor manda `asistente` cuando quien mira es la Familia y `familia` cuando
// quien mira es el Asistente: quien ve el nombre de un Asistente del otro lado es, justamente, la
// Familia. Así la pantalla no necesita saber en cuál de las dos aplicaciones está corriendo.
//
// EL TAPADO NO SE DECIDE ACÁ, NI SIQUIERA EN EL MOTOR. Lo tapa la base antes de guardar el
// mensaje, así que lo que llega es lo único que hay, y con cada mensaje tapado llega el motivo en
// los tres idiomas. Esta pantalla elige el suyo y lo muestra.
//
// EL HILO ABIERTO SE REFRESCA SOLO, Y PIDE NADA MÁS LO QUE LE FALTA. Con el momento del último
// mensaje que ya tiene, el motor contesta lo posterior y nada más. Volver a bajar la conversación
// entera cada vez es gastar la conexión de un teléfono en traer lo que ya está en pantalla.
//
// Y UN REFRESCO QUE FALLA NO BORRA LO LEÍDO. Lo que ya se bajó queda donde está, se avisa que no
// se pudo traer lo nuevo y se ofrece volver a intentar. Mientras eso no salga bien el reloj queda
// parado, porque insistir solo contra algo que no contesta no arregla nada.
//
// AL CAMBIAR DE HILO NO QUEDA NADA DEL ANTERIOR. Ni sus mensajes, ni su error, ni lo que se había
// escrito y no se llegó a enviar: eso último saldría hacia otra persona. Por eso el hilo se dibuja
// con la conversación como clave, y cambiarla lo estrena entero.

// Cada cuánto se pregunta si llegó algo. No es una regla de negocio: es cada cuánto se molesta a
// un teléfono, y por eso vive acá, con nombre, y no escrito adentro del reloj.
const CADA_CUANTO_SE_REFRESCA_MS = 15000;

export default function Conversacion() {
  const { id } = useParams();
  const { t, locale } = useLocale();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [errorDelRefresco, setErrorDelRefresco] = useState('');
  const [reintentando, setReintentando] = useState(false);

  // Hasta cuándo está traído el hilo. Va en una referencia y no en un estado porque el reloj del
  // refresco no tiene que rearmarse cada vez que llega un mensaje.
  const traidoHasta = useRef(null);

  function anotarHastaDonde(mensajes) {
    if (mensajes?.length) traidoHasta.current = mensajes[mensajes.length - 1].created_at;
  }

  // Cambió la conversación: se limpia todo antes de pedir la nueva. Sin esto, por un instante se
  // vería el hilo de la anterior debajo del nombre de esta.
  useEffect(() => {
    setDatos(null);
    setError('');
    setErrorDelRefresco('');
    traidoHasta.current = null;
  }, [id]);

  const traer = useCallback(async () => {
    const data = await api.conversacionDelMarketplace(id);
    anotarHastaDonde(data.mensajes);
    setDatos(data);
    setErrorDelRefresco('');
  }, [id]);

  const refrescar = useCallback(async () => {
    const data = await api.conversacionDelMarketplace(id, traidoHasta.current);
    anotarHastaDonde(data.mensajes);
    setDatos((previo) => {
      if (!previo) return data;
      // `solo_lo_nuevo` lo dice el motor, y por eso la pantalla no lo deduce de lo que pidió.
      return {
        ...data,
        mensajes: data.solo_lo_nuevo ? [...previo.mensajes, ...data.mensajes] : data.mensajes,
      };
    });
    setErrorDelRefresco('');
  }, [id]);

  useEffect(() => {
    traer().catch((e) => setError(mensajeDeError(e, t, 'Conversación')));
    // El idioma no cambia qué se pide, y ponerlo acá volvería a pedir el hilo entero cada vez que
    // alguien lo cambia.
  }, [traer]);

  const hayHilo = datos !== null;

  useEffect(() => {
    if (!hayHilo || errorDelRefresco) return undefined;
    const reloj = setInterval(() => {
      refrescar().catch((e) => setErrorDelRefresco(mensajeDeError(e, t, 'Conversación')));
    }, CADA_CUANTO_SE_REFRESCA_MS);
    return () => clearInterval(reloj);
  }, [hayHilo, errorDelRefresco, refrescar]);

  async function volverAIntentar() {
    if (reintentando) return;
    setReintentando(true);
    try {
      await refrescar();
    } catch (e) {
      setErrorDelRefresco(mensajeDeError(e, t, 'Conversación'));
    } finally {
      setReintentando(false);
    }
  }

  async function enviar(cuerpo) {
    try {
      const data = await api.escribirEnConversacion(id, cuerpo);
      // Vuelve el hilo entero y ya tapado: quien escribió ve su mensaje como lo va a ver el otro.
      anotarHastaDonde(data.mensajes);
      setDatos((previo) => ({ ...previo, mensajes: data.mensajes }));
    } catch (e) {
      setError(mensajeDeError(e, t, 'Conversación'));
    }
  }

  async function llamar() {
    try {
      await api.abrirVideollamada(id);
      // La sala queda anotada en el hilo con un aviso, así que se vuelve a pedir todo: así el
      // botón pasa a decir «entrar» y el aviso aparece también acá.
      await traer();
    } catch (e) {
      setError(mensajeDeError(e, t, 'Conversación'));
    }
  }

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (datos === null) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;

  const otro = datos.conversacion.asistente || datos.conversacion.familia || {};
  const ladoPropio = datos.conversacion.asistente ? 'familia' : 'asistente';

  return (
    <div>
      <h1>{otro.nombre}</h1>

      {errorDelRefresco && (
        <div className="alert alert-error" role="alert">
          {errorDelRefresco}
          <button type="button" className="btn btn-secondary" onClick={volverAIntentar} disabled={reintentando}>
            {t.comun.reintentar}
          </button>
        </div>
      )}

      <HiloDeMensajes
        key={id}
        mensajes={datos.mensajes}
        ladoPropio={ladoPropio}
        locale={locale}
        videollamada={datos.videollamada}
        videollamadaDisponible={datos.videollamada_disponible}
        alLlamar={llamar}
        alEnviar={enviar}
        t={t}
      />
    </div>
  );
}
