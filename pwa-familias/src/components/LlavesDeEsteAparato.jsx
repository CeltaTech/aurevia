/**
 * Las llaves que esta persona guarda en sus aparatos.
 * ===================================================
 *
 * ORIGINAL. La copia de `pwa-familias/` se regenera con `scripts/sincronizar_copias.mjs` y nunca
 * se edita a mano. Por eso acá no hay una sola palabra propia de ninguna de las dos aplicaciones:
 * los cuatro pedidos salen de `lib/api.js`, que cada una tiene con su propia dirección, y los
 * textos de `t.llaves`, que están en las dos con las mismas claves.
 *
 * QUÉ SE HACE DESDE ACÁ. Ver qué aparatos quedaron habilitados, habilitar éste, y sacar el que ya
 * no se usa. Entrar con la huella no está acá: eso pasa antes de tener sesión, en la pantalla de
 * ingreso.
 *
 * LO QUE VUELVE SON FECHAS Y NADA MÁS. Ni la credencial ni la mitad pública de la llave salen del
 * motor. Para reconocer cuál aparato es cuál alcanza con cuándo se guardó y cuándo se usó por
 * última vez, y cualquier otra cosa sería un dato de más dando vueltas.
 *
 * SACAR NO BORRA. El motor marca la llave como revocada y deja constancia; desde afuera se ve
 * igual, porque la lista muestra sólo las que siguen sirviendo.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { con } from '../lib/textos';
import { esteAparatoGuardaLlaves, guardarLaLlaveEnEsteAparato, loCancelaronAMano } from '../lib/llaveDelDispositivo';

export default function LlavesDeEsteAparato() {
  const { t, locale } = useLocale();
  const [llaves, setLlaves] = useState(null);
  const [error, setError] = useState('');
  const [puedeGuardar, setPuedeGuardar] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [sacando, setSacando] = useState('');
  const [aviso, setAviso] = useState('');
  const [errorDeAccion, setErrorDeAccion] = useState('');

  useEffect(() => {
    let activo = true;
    api
      .llaves()
      .then(({ llaves: lista }) => {
        if (activo) setLlaves(lista || []);
      })
      .catch(() => {
        if (activo) setError(t.comun.error_generico);
      });
    esteAparatoGuardaLlaves().then((puede) => {
      if (activo) setPuedeGuardar(puede);
    });
    return () => {
      activo = false;
    };
  }, []);

  function enPalabras(fecha) {
    if (!fecha) return null;
    const dia = new Date(fecha);
    if (Number.isNaN(dia.getTime())) return null;
    return dia.toLocaleDateString(locale);
  }

  async function alGuardar() {
    setAviso('');
    setErrorDeAccion('');
    setGuardando(true);
    try {
      const { llave } = await guardarLaLlaveEnEsteAparato({
        desafio: api.desafioDeLlave,
        guardar: api.guardarLlave,
      });
      setLlaves((anteriores) => [llave, ...(anteriores || [])]);
      setAviso(t.llaves.agregada);
    } catch (errorAlta) {
      // Cancelar no es fallar: quien cierra el pedido del aparato a propósito ya sabe lo que hizo.
      setErrorDeAccion(loCancelaronAMano(errorAlta) ? '' : t.llaves.error_alta);
      if (loCancelaronAMano(errorAlta)) setAviso(t.llaves.cancelado);
    } finally {
      setGuardando(false);
    }
  }

  async function alSacar(id) {
    if (!window.confirm(t.llaves.sacar_confirmar)) return;
    setAviso('');
    setErrorDeAccion('');
    setSacando(id);
    try {
      await api.sacarLlave(id);
      setLlaves((anteriores) => (anteriores || []).filter((llave) => llave.id !== id));
      setAviso(t.llaves.sacada);
    } catch {
      setErrorDeAccion(t.llaves.error_baja);
    } finally {
      setSacando('');
    }
  }

  return (
    <>
      <h2 style={{ marginTop: '2rem' }}>{t.llaves.titulo}</h2>
      <p className="guardia-card-detalle">{t.llaves.explicacion}</p>

      {error && <div className="alert alert-error" role="alert">{error}</div>}
      {!error && llaves === null && <div className="estado-cargando" role="status">{t.comun.cargando}</div>}

      {!error && llaves !== null && (
        <>
          {llaves.length === 0 ? (
            <p className="guardia-card-detalle">{t.llaves.ninguna}</p>
          ) : (
            <ul className="llaves-lista">
              {llaves.map((llave) => (
                <li key={llave.id} className="llave-item">
                  <span className="llave-fechas">
                    <span>{con(t.llaves.agregada_el, { fecha: enPalabras(llave.agregadaEn) || '—' })}</span>
                    <span>
                      {llave.ultimoUsoEn
                        ? con(t.llaves.ultimo_uso, { fecha: enPalabras(llave.ultimoUsoEn) })
                        : t.llaves.nunca_usada}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    disabled={sacando === llave.id}
                    onClick={() => alSacar(llave.id)}
                  >
                    {sacando === llave.id ? t.llaves.sacando : t.llaves.sacar}
                  </button>
                </li>
              ))}
            </ul>
          )}

          {puedeGuardar ? (
            <button
              type="button"
              className="btn btn-primary btn-full"
              style={{ marginTop: '1rem' }}
              disabled={guardando}
              onClick={alGuardar}
            >
              {guardando ? t.llaves.agregando : t.llaves.agregar}
            </button>
          ) : (
            <p className="guardia-card-detalle" style={{ marginTop: '1rem' }}>{t.llaves.no_disponible}</p>
          )}

          {aviso && <div className="alert" role="status">{aviso}</div>}
          {errorDeAccion && <div className="alert alert-error" role="alert">{errorDeAccion}</div>}
        </>
      )}
    </>
  );
}
