import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { api } from '../lib/api';
import { useLocale } from '../i18n/LocaleContext';
import { traducirValor } from '../i18n/valores';
import { mensajeDeError } from '../lib/errores';

function minutosRestantes(fecha) {
  return Math.max(0, Math.ceil((new Date(fecha).getTime() - Date.now()) / 60000));
}

export default function AccesoMarketplace() {
  const { id } = useParams();
  const { t } = useLocale();
  const [acceso, setAcceso] = useState(undefined);
  const [error, setError] = useState('');
  const [generando, setGenerando] = useState(false);
  const [qr, setQr] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [cobrado, setCobrado] = useState(false);
  const [dandoDeBaja, setDandoDeBaja] = useState(false);
  const [baja, setBaja] = useState(null);
  const [errorBaja, setErrorBaja] = useState('');
  const pollRef = useRef(null);

  const cargar = useCallback(() => {
    api
      .accesoMarketplace(id)
      .then((data) => setAcceso(data.acceso))
      .catch((e) => setError(mensajeDeError(e, t, 'acceso del marketplace')));
  }, [id]);

  useEffect(() => {
    setAcceso(undefined);
    cargar();
  }, [cargar]);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  async function generarQr() {
    setGenerando(true);
    setError('');
    setCobrado(false);
    try {
      const { qr: nuevoQr } = await api.generarQrCobro({ acceso_id: acceso.id });
      setQr(nuevoQr);
      setQrDataUrl(await QRCode.toDataURL(nuevoQr.token, { width: 260, margin: 1 }));
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const { qr: estadoQr } = await api.estadoQrCobro(nuevoQr.id);
          if (estadoQr.cobro_id) {
            setCobrado(true);
            clearInterval(pollRef.current);
          } else if (new Date(estadoQr.expira_en).getTime() < Date.now()) {
            clearInterval(pollRef.current);
          }
        } catch {
          // el próximo ciclo de sondeo reintenta
        }
      }, 4000);
    } catch (e) {
      setError(mensajeDeError(e, t, 'generar el QR de cobro'));
    } finally {
      setGenerando(false);
    }
  }

  // La baja en un clic: un botón y nada más. No lleva una pantalla de confirmación a propósito —
  // el §3.2 del PRD pide que cancelar sea tan fácil como darse de alta—, y lo que hay que saber
  // antes de apretarlo está escrito arriba: qué se apaga y hasta cuándo sigue lo que ya se pagó.
  async function darDeBaja() {
    setDandoDeBaja(true);
    setErrorBaja('');
    try {
      const { baja: hecha } = await api.darDeBajaAcceso(acceso.id);
      setBaja(hecha);
      cargar();
    } catch (e) {
      setErrorBaja(mensajeDeError(e, t, 'dar de baja el acceso'));
    } finally {
      setDandoDeBaja(false);
    }
  }

  if (error) return <div className="alert alert-error" role="alert">{error}</div>;
  if (acceso === undefined) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;

  const qrVencido = qr && !cobrado && new Date(qr.expira_en).getTime() < Date.now();

  return (
    <div>
      <Link to={`/pacientes/${id}`} className="btn btn-secondary" style={{ marginBottom: '1rem', fontSize: '0.8rem', padding: '0.4rem 1rem' }}>
        {t.comun.volver}
      </Link>

      <h1>{t.acceso.titulo}</h1>

      {!acceso && <div className="estado-vacio" role="status">{t.acceso.sin_acceso}</div>}

      {acceso && (
        <>
          <div className="guardia-card-detalle">
            {traducirValor(t.acceso, `estado_${acceso.estado}`)}
          </div>
          <div className="guardia-card-detalle">
            {t.acceso.importe}: {acceso.importe}
          </div>
          {acceso.proximo_cobro && (
            <div className="guardia-card-detalle">
              {t.acceso.proximo_cobro}: {acceso.proximo_cobro}
            </div>
          )}

          {acceso.estado === 'vigente' && (
            <div style={{ marginTop: '1.5rem' }}>
              <h2>{t.acceso.generar_qr_titulo}</h2>
              <p className="guardia-card-detalle">{t.acceso.generar_qr_explicacion}</p>

              {cobrado && <div className="alert alert-success" role="status">{t.acceso.qr_cobrado}</div>}

              {!cobrado && qr && !qrVencido && qrDataUrl && (
                <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                  <img src={qrDataUrl} alt={t.acceso.generar_qr_titulo} />
                  <p className="mapa-actualizado">{t.acceso.qr_vence_en.replace('{minutos}', minutosRestantes(qr.expira_en))}</p>
                  <p className="mapa-actualizado">{t.acceso.qr_esperando_cobro}</p>
                </div>
              )}

              {qrVencido && <div className="alert alert-error" role="alert">{t.acceso.qr_vencido}</div>}

              {(!qr || qrVencido || cobrado) && (
                <button type="button" className="btn btn-primary btn-full" onClick={generarQr} disabled={generando} style={{ marginTop: '1rem' }}>
                  {generando ? t.acceso.generando_qr : (qr ? t.acceso.qr_generar_otro : t.acceso.generar_qr_boton)}
                </button>
              )}
            </div>
          )}

          {/* La baja sólo aparece donde hay una renovación que apagar. Una forma que se cobra una
              sola vez no se da de baja: no hay nada que cancelar. */}
          {acceso.renueva_sola && (
            <div style={{ marginTop: '1.5rem' }}>
              <h2>{t.acceso.baja_titulo}</h2>

              {acceso.cancelada_en || baja ? (
                <>
                  <div className="alert alert-success" role="status">{t.acceso.baja_hecha}</div>
                  <p className="guardia-card-detalle">
                    {t.acceso.baja_cancelada_el.replace('{fecha}', (baja?.cancelada_en || acceso.cancelada_en).slice(0, 10))}
                  </p>
                  {(baja?.vigente_hasta || acceso.vigente_hasta || acceso.gratis_hasta) && (
                    <p className="guardia-card-detalle">
                      {t.acceso.baja_hasta.replace('{fecha}', baja?.vigente_hasta || acceso.vigente_hasta || acceso.gratis_hasta)}
                    </p>
                  )}
                </>
              ) : (
                <>
                  <p className="guardia-card-detalle">{t.acceso.baja_explicacion}</p>
                  {errorBaja && <div className="alert alert-error" role="alert">{errorBaja}</div>}
                  <button type="button" className="btn btn-secondary btn-full" onClick={darDeBaja} disabled={dandoDeBaja} style={{ marginTop: '1rem' }}>
                    {dandoDeBaja ? t.acceso.dando_de_baja : t.acceso.baja_boton}
                  </button>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
