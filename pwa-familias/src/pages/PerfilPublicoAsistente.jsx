import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { nombreTipo } from '../lib/tipoDeAsistente';
import { diaEnPalabras } from '../lib/fechaEnPalabras';
import { mensajeDeError } from '../lib/errores';
import EstadoDocumental from '../components/EstadoDocumental';

// El perfil público de una persona de la vidriera, antes de contratarla.
//
// Es la misma persona que la Familia que ya contrató ve en «Asistente Asignado», y por eso el
// estado de los papeles lo dibuja el mismo componente: decir una cosa acá y otra allá sobre la
// misma carpeta de documentos sería inventar una verificación distinta según quién mire.
//
// LAS OPINIONES VAN SIN QUIÉN LAS ESCRIBIÓ. Quien calificó es una Familia, y su nombre no es
// parte de lo que se publica. El motor ya no lo manda; acá no habría de dónde sacarlo.
//
// Y NO HAY NINGÚN DATO DE CONTACTO. Llegar a la persona es lo que el Marketplace vende y se
// pide aparte. Esta pantalla lo dice en vez de dejar buscando un botón que no está.
export default function PerfilPublicoAsistente() {
  const { id } = useParams();
  const { t, locale } = useLocale();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let activo = true;
    api
      .asistenteDelMarketplace(id)
      .then((data) => {
        if (activo) setDatos(data);
      })
      .catch((e) => {
        if (activo) setError(mensajeDeError(e, t, 'Perfil público del Asistente'));
      });
    return () => {
      activo = false;
    };
  }, [id]);

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (datos === null) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;
  if (!datos.asistente) return <div className="estado-vacio" role="status">{t.comun.vacio}</div>;

  const { asistente, opiniones } = datos;
  const { verificacion, calificacion } = asistente;

  return (
    <div>
      <Link to="/buscar" className="btn btn-secondary" style={{ marginBottom: '1rem', fontSize: '0.8rem', padding: '0.4rem 1rem' }}>
        <span aria-hidden="true">←</span> {t.comun.volver}
      </Link>
      <h1>{asistente.nombre}</h1>
      {asistente.foto_url && (
        <img
          src={asistente.foto_url}
          alt={asistente.nombre}
          style={{ width: '100%', maxWidth: 200, borderRadius: '12px', marginBottom: '1rem' }}
        />
      )}
      {asistente.tipo && (
        <p className="guardia-card-detalle">
          {t.asistente.tipo}: {nombreTipo(asistente.tipo, t)}
        </p>
      )}
      {asistente.zonas.length > 0 && (
        <p className="guardia-card-detalle">
          {t.vidriera.zonas}: {asistente.zonas.join(', ')}
        </p>
      )}
      {asistente.antiguedad_meses !== null && (
        <p className="guardia-card-detalle">
          {t.vidriera.antiguedad.replace('{meses}', asistente.antiguedad_meses)}
        </p>
      )}

      {verificacion && (
        <EstadoDocumental
          resumen={verificacion.documentacion}
          matricula={verificacion.matricula}
          alDia={verificacion.papeles_al_dia}
          papelesExigidos={verificacion.papeles_exigidos}
          t={t}
        />
      )}

      <h2 style={{ marginTop: '1.5rem' }}>{t.vidriera.opiniones_titulo}</h2>
      {calificacion ? (
        <p className="guardia-card-detalle">
          {/* Las estrellas dibujadas no se leen: un lector de pantalla las nombraría una por
              una. Al lado va el mismo dato escrito, que no se ve pero sí se escucha. */}
          <span aria-hidden="true">
            {'★'.repeat(Math.round(calificacion.promedio))}
            {'☆'.repeat(Math.max(0, 5 - Math.round(calificacion.promedio)))}
          </span>{' '}
          {t.vidriera.calificacion_cuenta
            .replace('{promedio}', calificacion.promedio)
            .replace('{cuantas}', calificacion.cuantas)}
        </p>
      ) : (
        <p className="guardia-card-detalle">{t.vidriera.sin_calificaciones}</p>
      )}

      {opiniones.length === 0 ? (
        <div className="estado-vacio" role="status">{t.vidriera.sin_opiniones}</div>
      ) : (
        opiniones.map((o) => (
          <div key={o.id} className="guardia-card">
            <div className="guardia-card-paciente">
              <span aria-hidden="true">
                {'★'.repeat(o.estrellas)}
                {'☆'.repeat(Math.max(0, 5 - o.estrellas))}
              </span>
              <span className="solo-lectores-pantalla">
                {t.comun.puntaje_estrellas.replace('{n}', o.estrellas)}
              </span>
            </div>
            {o.comentario && <div className="guardia-card-detalle">{o.comentario}</div>}
            <div className="guardia-card-detalle">{diaEnPalabras(String(o.created_at).slice(0, 10), locale)}</div>
          </div>
        ))
      )}

      <p className="guardia-card-detalle" style={{ marginTop: '1.5rem' }}>
        {t.vidriera.contacto_aparte}
      </p>
    </div>
  );
}
