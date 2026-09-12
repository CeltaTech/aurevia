import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { traducirValor } from '../i18n/valores';
import { mensajeDeError } from '../lib/errores';
import { formatearImporte } from '../lib/dinero';
import { periodoEnPalabras } from '../lib/fechaEnPalabras';

// Lo que se le cobra a la Familia, período por período.
//
// Los tres números de cada renglón —lo facturado, lo que entró y lo que falta— salen hechos de la
// base, de la vista que ya hace esa resta para todo el producto. Acá no se resta nada: una cuenta
// hecha dos veces son dos respuestas posibles para la misma pregunta, y ésta es justo la pregunta
// que alguien va a discutir por teléfono.
export default function Facturas() {
  const { t, locale } = useLocale();
  const [facturas, setFacturas] = useState(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    let activo = true;
    api
      .facturas()
      .then(({ facturas: data }) => {
        if (activo) setFacturas(data);
      })
      .catch((e) => {
        if (activo) setError(mensajeDeError(e, t, 'facturas de la Familia'));
      });
    return () => {
      activo = false;
    };
  }, []);

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (facturas === undefined) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;

  return (
    <div>
      <h1>{t.facturas.titulo}</h1>
      <p className="guardia-card-detalle">{t.facturas.explicacion}</p>

      {facturas.length === 0 ? (
        <div className="estado-vacio" role="status">{t.facturas.sin_facturas}</div>
      ) : (
        facturas.map((f) => (
          <Link
            key={f.factura_id}
            to={`/facturas/${f.factura_id}`}
            className="guardia-card"
            style={{ display: 'block', textDecoration: 'none' }}
          >
            <div className="guardia-card-paciente">{periodoEnPalabras(f.periodo, locale)}</div>
            <div className="guardia-card-detalle">
              {t.facturas.col_saldo}: {formatearImporte(f.saldo, f.moneda, locale)}
              {' · '}
              {traducirValor(t.facturas, `estado_${f.estado}`)}
            </div>
            <div className="guardia-card-detalle">
              {t.facturas.col_facturado}: {formatearImporte(f.monto_total, f.moneda, locale)}
              {' · '}
              {t.facturas.col_cobrado}: {formatearImporte(f.cobrado, f.moneda, locale)}
            </div>
          </Link>
        ))
      )}
    </div>
  );
}
