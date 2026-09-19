import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { mensajeDeError } from '../lib/errores';

// LA LISTA DE CONVERSACIONES DEL MARKETPLACE.
//
// Es el mismo archivo en las dos aplicaciones, y por eso tiene original y copia: la lista que ve
// la Familia y la que ve el Asistente son la misma lista mirada desde cada punta, y lo único que
// cambia es cómo se llama quien está del otro lado. La copia la genera
// `scripts/sincronizar_copias.mjs`: nunca se edita a mano.
//
// DE DÓNDE SALE EL NOMBRE DEL OTRO. El motor manda `asistente` cuando quien mira es la Familia y
// `familia` cuando quien mira es el Asistente. No hace falta que la pantalla sepa cuál de las dos
// aplicaciones es: le alcanza con mirar qué vino.
export default function Mensajes() {
  const { t, locale } = useLocale();
  const [conversaciones, setConversaciones] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let activo = true;
    api
      .conversacionesDelMarketplace()
      .then((data) => {
        if (activo) setConversaciones(data.conversaciones || []);
      })
      .catch((e) => {
        if (activo) setError(mensajeDeError(e, t, 'Mensajes'));
      });
    return () => {
      activo = false;
    };
  }, []);

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (conversaciones === null) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;

  return (
    <div>
      <h1>{t.chat.titulo}</h1>

      {conversaciones.length === 0 ? (
        <div className="estado-vacio" role="status">{t.chat.sin_conversaciones}</div>
      ) : (
        conversaciones.map((c) => {
          const otro = c.asistente || c.familia || {};
          // El número de mensajes sin leer se ve por dónde está; dicho en voz alta, un número
          // suelto no dice nada, así que la frase entera va en el texto que se escucha.
          const sinLeer = c.sin_leer > 0
            ? (c.sin_leer === 1 ? t.chat.sin_leer_uno : t.chat.sin_leer.replace('{n}', c.sin_leer))
            : '';
          return (
            <Link key={c.id} to={`/mensajes/${c.id}`} className="guardia-card" style={{ display: 'block' }}>
              <div className="guardia-card-paciente">{otro.nombre}</div>
              {c.ultimo_mensaje_at && (
                <div className="guardia-card-detalle">{new Date(c.ultimo_mensaje_at).toLocaleString(locale)}</div>
              )}
              {sinLeer && <div className="guardia-card-detalle">{sinLeer}</div>}
            </Link>
          );
        })
      )}
    </div>
  );
}
