import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';

// ============================================================================
// Pendiente #102 — pantalla donde el Asistente lee y decide sobre el registro
// de su ubicación.
//
// Tres cosas de esta pantalla no son detalles de diseño, son el motivo por el
// que existe:
//
// 1. Se puede decir que NO, y el "no" se registra igual que el "sí". Un
//    consentimiento que no se puede negar no es libre, y si no es libre no es
//    válido. Por eso los dos botones pesan lo mismo y no hay ninguno resaltado.
// 2. No bloquea nada. Quien rechaza sigue usando la aplicación entera.
// 3. El texto completo está a la vista antes de decidir, no detrás de un
//    enlace. "Informado" quiere decir que lo pudo leer, no que se lo ofrecieron.
// ============================================================================

export default function Consentimientos({ onCambio }) {
  const { t, locale } = useLocale();
  const [items, setItems] = useState(null);
  const [error, setError] = useState('');
  const [guardando, setGuardando] = useState('');

  async function cargar() {
    try {
      const { consentimientos } = await api.consentimientos(locale);
      setItems(consentimientos);
      if (onCambio) onCambio(consentimientos);
    } catch {
      setError(t.comun.error_generico);
    }
  }

  useEffect(() => {
    cargar();
  }, [locale]);

  async function decidir(clave, decision) {
    setError('');
    setGuardando(`${clave}:${decision}`);
    try {
      await api.decidirConsentimiento(clave, decision, locale);
      await cargar();
    } catch {
      setError(t.comun.error_generico);
    } finally {
      setGuardando('');
    }
  }

  async function retirar(clave) {
    setError('');
    setGuardando(`${clave}:retirar`);
    try {
      await api.retirarConsentimiento(clave, null);
      await cargar();
    } catch {
      setError(t.comun.error_generico);
    } finally {
      setGuardando('');
    }
  }

  if (error && !items) return <div className="alert alert-error">{error}</div>;
  if (!items) return <div className="estado-cargando">{t.comun.cargando}</div>;
  // Sin texto cargado para el país de la Prestadora no hay nada que preguntar.
  // No es un error ni un vacío que haya que explicar: es el caso normal.
  if (items.length === 0) return null;

  return (
    <div>
      <h2 style={{ marginTop: '2rem' }}>{t.consentimientos.titulo}</h2>
      {error && <div className="alert alert-error">{error}</div>}

      {items.map((item) => {
        const otorgado = item.decision?.valor === 'otorgado' && !item.decision?.desactualizada;
        const rechazado = item.decision?.valor === 'rechazado' && !item.decision?.desactualizada;

        return (
          <section key={item.clave} className="tarjeta-consentimiento">
            {item.texto.es_borrador && (
              <div className="alert alert-error">{t.consentimientos.aviso_borrador}</div>
            )}

            <h3>{item.texto.titulo}</h3>

            {item.texto.puntos_clave.length > 0 && (
              <ul>
                {item.texto.puntos_clave.map((punto, i) => (
                  <li key={i}>{punto}</li>
                ))}
              </ul>
            )}

            <p style={{ whiteSpace: 'pre-line' }}>{item.texto.cuerpo}</p>

            {item.decision?.desactualizada && (
              <div className="alert">{t.consentimientos.texto_cambio}</div>
            )}

            {otorgado ? (
              <>
                <p>
                  <strong>{t.consentimientos.estado_otorgado}</strong>{' '}
                  {new Date(item.decision.decidido_at).toLocaleDateString(locale)}
                </p>
                <button
                  type="button"
                  className="btn"
                  disabled={guardando === `${item.clave}:retirar`}
                  onClick={() => retirar(item.clave)}
                >
                  {guardando === `${item.clave}:retirar` ? t.comun.guardando : t.consentimientos.retirar}
                </button>
                <p className="texto-ayuda">{t.consentimientos.retirar_ayuda}</p>
              </>
            ) : rechazado ? (
              <>
                <p>
                  <strong>{t.consentimientos.estado_rechazado}</strong>{' '}
                  {new Date(item.decision.decidido_at).toLocaleDateString(locale)}
                </p>
                <button
                  type="button"
                  className="btn"
                  disabled={guardando === `${item.clave}:otorgado`}
                  onClick={() => decidir(item.clave, 'otorgado')}
                >
                  {guardando === `${item.clave}:otorgado` ? t.comun.guardando : t.consentimientos.cambiar_a_acepto}
                </button>
              </>
            ) : (
              <>
                {/* Los dos botones con el mismo peso visual, a propósito. */}
                <div className="consentimiento-acciones">
                  <button
                    type="button"
                    className="btn"
                    disabled={!!guardando}
                    onClick={() => decidir(item.clave, 'otorgado')}
                  >
                    {guardando === `${item.clave}:otorgado` ? t.comun.guardando : t.consentimientos.acepto}
                  </button>
                  <button
                    type="button"
                    className="btn"
                    disabled={!!guardando}
                    onClick={() => decidir(item.clave, 'rechazado')}
                  >
                    {guardando === `${item.clave}:rechazado` ? t.comun.guardando : t.consentimientos.no_acepto}
                  </button>
                </div>
                <p className="texto-ayuda">{t.consentimientos.sin_consecuencias}</p>
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}
