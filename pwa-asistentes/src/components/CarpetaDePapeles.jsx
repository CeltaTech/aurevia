import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { con } from '../lib/textos';

// ============================================================================
// Mis papeles, y mi Certificado de Aptitud.
//
// POR QUÉ ESTA PANTALLA EXISTE
// Un papel vencido termina en que dejan de asignarle guardias. Si él no lo ve
// venir, lo único que nota es que dejaron de llamarlo. Acá ve qué le exige su
// Prestadora, qué tiene, qué le falta y qué está por caerse, con tiempo de ir a
// buscarlo.
//
// ACÁ SÍ VAN LOS NOMBRES, Y ES LO QUE LA DIFERENCIA DE LA VISTA DE LA FAMILIA
// A la Familia se le cuentan cuentas y nunca cuál papel es cuál, porque el
// nombre de un tipo de documento puede ser dato de salud. Acá el que mira es el
// dueño de esos papeles: decirle «le falta uno» sin decirle cuál sería pedirle
// que adivine.
//
// SE MIRA, NO SE CARGA
// Los papeles los carga la Prestadora, que es la que los recibe y los comprueba.
// Por eso no hay botón: el texto del pie dice a dónde llevarlos, que es lo que
// hay que hacer de verdad. La Matrícula sí se carga desde el teléfono, y por eso
// tiene su propio bloque aparte.
//
// SI LA PRESTADORA NO EXIGE NINGUNO, NO APARECE NADA
// Un bloque vacío que diga «no hay papeles» es ruido en una pantalla de teléfono.
// ============================================================================

/** Los papeles se muestran con el problema arriba: lo vencido, lo que falta, y después el resto. */
const ORDEN_DE_ESTADOS = ['vencido', 'sin_cargar', 'falta_fecha', 'por_vencer', 'vigente'];

/**
 * Con qué gravedad se pinta el cartel del resumen. Lo vencido es rojo porque hoy lo puede dejar
 * sin guardias; lo que falta y lo que está por vencer avisan; lo demás confirma que está bien,
 * que también hace falta decirlo: una pantalla que sólo habla cuando algo anda mal deja a la
 * persona sin saber si el silencio es bueno o es que no cargó.
 */
const CLASE_DEL_RESUMEN = {
  al_dia: 'alert alert-info',
  sin_exigencias: 'alert alert-info',
  por_vencer: 'alert alert-alerta',
  incompleta: 'alert alert-alerta',
  vencida: 'alert alert-error',
};

export default function CarpetaDePapeles() {
  const { t, locale } = useLocale();
  const tp = t.papeles;
  const [datos, setDatos] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let activo = true;
    api
      .papeles()
      .then((respuesta) => {
        if (activo) setDatos(respuesta);
      })
      .catch(() => {
        if (activo) setError(t.comun.error_generico);
      })
      .finally(() => {
        if (activo) setCargando(false);
      });
    return () => {
      activo = false;
    };
  }, []);

  if (cargando) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;
  if (error) return <div className="alert alert-error" role="alert">{error}</div>;

  const carpeta = datos?.carpeta;
  const certificado = datos?.certificado ?? null;
  const papeles = carpeta?.papeles ?? [];
  // Sin papeles exigidos y sin Certificado no hay nada que contar.
  if (!papeles.length && !certificado) return null;

  function fecha(dia) {
    return dia ? new Date(`${dia}T00:00:00`).toLocaleDateString(locale) : null;
  }

  const ordenados = [...papeles].sort(
    (a, b) => ORDEN_DE_ESTADOS.indexOf(a.estado) - ORDEN_DE_ESTADOS.indexOf(b.estado)
  );

  return (
    <div>
      <h2 style={{ marginTop: '2rem' }}>{tp.titulo}</h2>

      {/* El resumen de la carpeta entera, con la misma palabra que usa el resto del producto.
          Va arriba porque es lo que contesta la pregunta con la que se entra: ¿estoy bien? */}
      {papeles.length > 0 && (
        <div className={CLASE_DEL_RESUMEN[carpeta.resumen] ?? 'alert'}>
          {tp[`resumen_${carpeta.resumen}`]}
        </div>
      )}

      {ordenados.length > 0 && (
        <ul>
          {ordenados.map((papel) => (
            <li key={papel.tipo_documento_id}>
              <strong>{papel.nombre}</strong> · {tp[`estado_${papel.estado}`]}
              {papel.fecha_vencimiento && ` · ${con(tp.vence_el, { fecha: fecha(papel.fecha_vencimiento) })}`}
              {!papel.requiere_vencimiento && ` · ${tp.sin_vencimiento}`}
            </li>
          ))}
        </ul>
      )}

      {/* El Certificado va abajo de la carpeta y con su propio título: no es uno más de los
          papeles que se exigen, es lo que la Prestadora emite cuando los demás están. */}
      <h3 style={{ marginTop: '1.5rem' }}>{tp.certificado_titulo}</h3>
      {!certificado ? (
        <p>{tp.certificado_sin_certificado}</p>
      ) : (
        <p>
          {tp[`certificado_estado_${certificado.estado}`]}
          {certificado.fecha_emision && ` · ${con(tp.certificado_emitido_el, { fecha: fecha(certificado.fecha_emision) })}`}
          {certificado.fecha_vencimiento && ` · ${con(tp.vence_el, { fecha: fecha(certificado.fecha_vencimiento) })}`}
        </p>
      )}

      <p className="texto-ayuda">{tp.los_recibe_la_prestadora}</p>
    </div>
  );
}
