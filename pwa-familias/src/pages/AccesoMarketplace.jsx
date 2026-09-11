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
        </>
      )}
    </div>
  );
}
