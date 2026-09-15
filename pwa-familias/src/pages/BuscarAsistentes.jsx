import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { nombreTipo } from '../lib/tipoDeAsistente';
import { mensajeDeError } from '../lib/errores';

// La vidriera del Marketplace: la gente que esta Prestadora ofrece, para elegir.
//
// EL ORDEN SE DICE, NO SE SUPONE. Mientras la Prestadora no encienda `ranking_plataforma`, la
// lista sale mezclada parejo y cambia todos los días. Eso se escribe arriba de la lista: quien
// mira una lista de personas da por sentado que el de arriba es el mejor, y acá no lo es. Que
// el orden no premie a nadie es una exigencia legal —ordenar a quién se le ofrece trabajo
// primero es un indicio de dirección del trabajo—, así que tampoco puede quedar sin decir.
//
// LOS FILTROS SALEN DE QUIEN ESTÁ EN LA VIDRIERA. Las zonas y los tipos vienen en la misma
// respuesta, armados con el pool real: una zona donde no trabaja nadie no se ofrece, porque
// elegirla devolvería siempre vacío.
//
// EL DATO DE CONTACTO NO ESTÁ ACÁ, Y SE DICE. Llegar a la persona es lo que el Marketplace
// vende y tiene su propio circuito. Una pantalla que simplemente no lo muestra hace buscarlo;
// una que avisa dónde está, no.

// El puntaje, dicho de las dos maneras: dibujado para quien mira y escrito para quien escucha.
function Estrellas({ calificacion, t }) {
  if (!calificacion) return <p className="guardia-card-detalle">{t.vidriera.sin_calificaciones}</p>;
  const enteras = Math.round(calificacion.promedio);
  return (
    <p className="guardia-card-detalle">
      <span aria-hidden="true">
        {'★'.repeat(enteras)}
        {'☆'.repeat(Math.max(0, 5 - enteras))}
      </span>{' '}
      {t.vidriera.calificacion_cuenta
        .replace('{promedio}', calificacion.promedio)
        .replace('{cuantas}', calificacion.cuantas)}
    </p>
  );
}

export default function BuscarAsistentes() {
  const { t } = useLocale();
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [zona, setZona] = useState('');
  const [tipo, setTipo] = useState('');

  useEffect(() => {
    let activo = true;
    setError('');
    api
      .asistentesDelMarketplace({ zona, tipo })
      .then((data) => {
        if (activo) setDatos(data);
      })
      .catch((e) => {
        if (activo) setError(mensajeDeError(e, t, 'Buscar Asistentes'));
      });
    return () => {
      activo = false;
    };
  }, [zona, tipo]);

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (datos === null) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;

  const { asistentes, orden, zonas, tipos } = datos;

  return (
    <div>
      <h1>{t.vidriera.titulo}</h1>
      <p className="guardia-card-detalle">{t.vidriera.para_que}</p>

      {/* Las dos listas de opciones salen del motor. Cuando hay una sola opción no se dibuja el
          filtro: elegirla no cambia nada y ocupa la pantalla de un teléfono. */}
      {zonas.length > 1 && (
        <div className="form-field">
          <label htmlFor="filtro-zona">{t.vidriera.filtro_zona}</label>
          <select id="filtro-zona" value={zona} onChange={(e) => setZona(e.target.value)}>
            <option value="">{t.vidriera.todas_las_zonas}</option>
            {zonas.map((z) => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        </div>
      )}
      {tipos.length > 1 && (
        <div className="form-field">
          <label htmlFor="filtro-tipo">{t.vidriera.filtro_tipo}</label>
          <select id="filtro-tipo" value={tipo} onChange={(e) => setTipo(e.target.value)}>
            <option value="">{t.vidriera.todos_los_tipos}</option>
            {tipos.map((ti) => (
              <option key={ti.id} value={ti.id}>{nombreTipo(ti, t)}</option>
            ))}
          </select>
        </div>
      )}

      <p className="guardia-card-detalle">
        {orden === 'calificacion' ? t.vidriera.orden_por_calificacion : t.vidriera.orden_neutro}
      </p>

      {asistentes.length === 0 ? (
        <div className="estado-vacio" role="status">{t.vidriera.sin_resultados}</div>
      ) : (
        asistentes.map((a) => (
          <Link key={a.id} to={`/buscar/${a.id}`} className="guardia-card" style={{ display: 'block' }}>
            <div className="guardia-card-paciente">{a.nombre}</div>
            {a.tipo && <div className="guardia-card-detalle">{nombreTipo(a.tipo, t)}</div>}
            {a.zonas.length > 0 && (
              <div className="guardia-card-detalle">
                {t.vidriera.zonas}: {a.zonas.join(', ')}
              </div>
            )}
            {a.antiguedad_meses !== null && (
              <div className="guardia-card-detalle">
                {t.vidriera.antiguedad.replace('{meses}', a.antiguedad_meses)}
              </div>
            )}
            <Estrellas calificacion={a.calificacion} t={t} />
          </Link>
        ))
      )}

      <p className="guardia-card-detalle" style={{ marginTop: '1.5rem' }}>
        {t.vidriera.contacto_aparte}
      </p>
    </div>
  );
}
