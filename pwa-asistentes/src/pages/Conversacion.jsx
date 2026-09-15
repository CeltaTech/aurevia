import { useCallback, useEffect, useState } from 'react';
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
// EL TAPADO NO SE DECIDE ACÁ. Los mensajes llegan ya tapados, y con ellos llega si el contacto de
// esta pareja está abierto. Esta pantalla lo muestra y nada más.
export default function Conversacion() {
  const { id } = useParams();
  const { t } = useLocale();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');

  const traer = useCallback(
    () =>
      api
        .conversacionDelMarketplace(id)
        .then(setDatos)
        .catch((e) => setError(mensajeDeError(e, t, 'Conversación'))),
    [id],
  );

  useEffect(() => {
    traer();
  }, [traer]);

  async function enviar(cuerpo) {
    try {
      const data = await api.escribirEnConversacion(id, cuerpo);
      // Vuelve el hilo entero y ya tapado: quien escribió ve su mensaje como lo va a ver el otro.
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
      <HiloDeMensajes
        mensajes={datos.mensajes}
        ladoPropio={ladoPropio}
        contactoAbierto={datos.contacto_abierto}
        videollamada={datos.videollamada}
        videollamadaDisponible={datos.videollamada_disponible}
        alLlamar={llamar}
        alEnviar={enviar}
        t={t}
      />
    </div>
  );
}
