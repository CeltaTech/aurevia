import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { mensajeDeError } from '../lib/errores';

// Lo que la Prestadora escribió para quien cuida en su casa.
//
// El texto lo escribió una persona de la Prestadora, en su idioma, y por eso sale tal cual: acá
// no se traduce nada más que el marco de la pantalla. Se respetan los renglones que puso quien
// lo escribió, que es lo único que se puede dar por intencional de un texto suelto.
//
// Vuelve sólo lo publicado. Un borrador existe del lado del Panel y de acá no se ve: quién decide
// cuándo se muestra es quien lo escribe.
export default function Contenidos() {
  const { t } = useLocale();
  const [contenidos, setContenidos] = useState(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    let activo = true;
    api
      .contenidos()
      .then(({ contenidos: data }) => {
        if (activo) setContenidos(data);
      })
      .catch((e) => {
        if (activo) setError(mensajeDeError(e, t, 'contenido de la Prestadora'));
      });
    return () => {
      activo = false;
    };
  }, []);

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (contenidos === undefined) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;

  return (
    <div>
      <h1>{t.contenidos.titulo}</h1>
      <p className="guardia-card-detalle">{t.contenidos.explicacion}</p>

      {contenidos.length === 0 ? (
        <div className="estado-vacio" role="status">{t.contenidos.sin_contenidos}</div>
      ) : (
        contenidos.map((contenido) => (
          <article key={contenido.id} className="guardia-card">
            <h2 className="guardia-card-paciente">{contenido.titulo}</h2>
            <p style={{ whiteSpace: 'pre-wrap' }}>{contenido.cuerpo}</p>
            {/* El enlace lleva a una página de la Prestadora, fuera de esta aplicación: se abre
                aparte para no perder dónde estaba quien lo tocó, y sin dejarle a esa página
                ninguna llave de vuelta hacia acá. */}
            {contenido.enlace_url && (
              <a
                className="btn btn-secondary btn-full"
                href={contenido.enlace_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.contenidos.abrir_enlace}
              </a>
            )}
          </article>
        ))
      )}
    </div>
  );
}
