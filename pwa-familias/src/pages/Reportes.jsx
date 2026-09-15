import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { useSeVe } from '../context/PerfilContext';
import { caraDelAnimo } from '../lib/animoDelReporte';
import { SIGNOS_VITALES, SIGNOS_VITALES_LEGADO, colorSigno } from '../lib/signosVitales';

// La lista de reportes de un Paciente.
//
// CADA TARJETA DICE CÓMO ESTUVO EL DÍA, y no solamente qué día fue. Antes mostraba la fecha y el
// nombre de quien cuidó: para saber si el lunes había pasado algo había que abrir el lunes, y
// después el martes, y después el miércoles. Una lista que obliga a entrar en todos para
// encontrar el único que importa no es una lista, es un índice.
//
// TODO ESTO YA VIAJABA AL TELÉFONO. El motor manda el ánimo, los incidentes y los signos en la
// misma respuesta de la lista, junto con los rangos contra los que se comparan, y ya recortados
// según lo que esa Prestadora muestre. No se agregó ninguna consulta: lo que se traía se estaba
// descartando al dibujar.
//
// LO QUE FALTA NO DEJA HUECO. Adentro de un reporte, un dato ausente se dice con «sin datos»,
// porque ahí la pregunta es por ese día. Acá el renglón directamente no se dibuja: la misma frase
// repetida sesenta veces tapa los días que sí tienen algo para contar.

const CAMPOS_VACIOS = ['', null, undefined];

// Cuál de las dos listas de signos usa este reporte. Los reportes viejos guardaron la presión en
// un solo campo; los nuevos, separada. Se prefiere la forma de ahora y se cae a la vieja sólo
// cuando el reporte no trae ninguno de los campos nuevos.
function signosDelReporte(signos) {
  if (!signos) return [];
  const ahora = SIGNOS_VITALES.filter((clave) => !CAMPOS_VACIOS.includes(signos[clave]));
  if (ahora.length > 0) return ahora;
  return SIGNOS_VITALES_LEGADO.filter((clave) => !CAMPOS_VACIOS.includes(signos[clave]));
}

export default function Reportes() {
  const { id } = useParams();
  const { t } = useLocale();
  const seVe = useSeVe();
  const [reportes, setReportes] = useState(null);
  const [rangosVitales, setRangosVitales] = useState({});
  const [error, setError] = useState('');

  // El mismo interruptor que adentro del reporte. La Prestadora que no hace enfermería no toma
  // estos valores, y una columna de signos vacía a lo largo de toda la lista haría creer que
  // alguien los controla y no los carga.
  const veLosSignos = seVe('familia_signos_vitales');

  useEffect(() => {
    let activo = true;
    api
      .reportesDelPaciente(id)
      .then(({ reportes: data, rangosVitales: rangos }) => {
        if (!activo) return;
        setReportes(data);
        setRangosVitales(rangos || {});
      })
      .catch(() => {
        if (activo) setError(t.comun.error_generico);
      });
    return () => {
      activo = false;
    };
  }, [id]);

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (reportes === null) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;

  return (
    <div>
      <Link to={`/pacientes/${id}`} className="btn btn-secondary" style={{ marginBottom: '1rem', fontSize: '0.8rem', padding: '0.4rem 1rem' }}>
        <span aria-hidden="true">←</span> {t.comun.volver}
      </Link>
      <h1>{t.reportes.titulo}</h1>
      {reportes.length === 0 ? (
        <div className="estado-vacio" role="status">{t.reportes.sin_reportes}</div>
      ) : (
        reportes.map((r) => {
          const cara = caraDelAnimo(r.estado_animo);
          const signos = veLosSignos ? signosDelReporte(r.signos_vitales) : [];
          const huboIncidente = typeof r.incidentes === 'string' && r.incidentes.trim() !== '';
          return (
            <Link key={r.id} to={`/pacientes/${id}/reportes/${r.id}`} className="guardia-card" style={{ display: 'block', textDecoration: 'none' }}>
              <div className="guardia-card-paciente">{r.guardias?.fecha}</div>
              <div className="guardia-card-detalle">{r.guardias?.asistentes?.nombre}</div>

              {/* La cara es un apoyo y va callada: al lado está el mismo ánimo escrito, que es lo
                  que lee en voz alta un lector de pantalla. */}
              {cara && (
                <div className="escala-animo-lectura">
                  <span aria-hidden="true">{cara}</span>
                  <span>{t.reporte_detalle[`animo_${r.estado_animo}`]}</span>
                </div>
              )}

              {(huboIncidente || signos.length > 0) && (
                <div className="reporte-resumen">
                  {/* Qué pasó no se cuenta acá: se avisa que hay algo para leer y se lee adentro.
                      Un incidente resumido en una tarjeta se entiende mal justo el día que
                      importa. */}
                  {huboIncidente && <span className="badge badge-alerta">{t.reportes.hubo_incidente}</span>}
                  {signos.map((clave) => {
                    const color = colorSigno(r.signos_vitales[clave], rangosVitales[clave]);
                    return (
                      <span key={clave} className={color ? `signo-vital-${color}` : ''}>
                        {t.reporte_detalle[`signo_${clave}`]}: {r.signos_vitales[clave]}
                        {rangosVitales[clave] ? ` ${rangosVitales[clave].unidad}` : ''}
                      </span>
                    );
                  })}
                </div>
              )}
            </Link>
          );
        })
      )}
    </div>
  );
}
