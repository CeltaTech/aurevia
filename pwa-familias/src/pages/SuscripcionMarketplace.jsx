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

export default function SuscripcionMarketplace() {
  const { id } = useParams();
  const { t } = useLocale();
  const [suscripcion, setSuscripcion] = useState(undefined);
  const [error, setError] = useState('');
  const [generando, setGenerando] = useState(false);
  const [qr, setQr] = useState(null);
  const [qrDataUrl, setQrDataUrl] = useState(null);
  const [cobrado, setCobrado] = useState(false);
  const pollRef = useRef(null);

  const cargar = useCallback(() => {
    api
      .suscripcionMarketplace(id)
      .then((data) => setSuscripcion(data.suscripcion))
      .catch((e) => setError(mensajeDeError(e, t, 'suscripción del marketplace')));
  }, [id]);

  useEffect(() => {
    setSuscripcion(undefined);
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
      const { qr: nuevoQr } = await api.generarQrCobro({ suscripcion_id: suscripcion.id });
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
  if (suscripcion === undefined) return <div className="estado-cargando" role="status">{t.comun.cargando}</div>;

  const qrVencido = qr && !cobrado && new Date(qr.expira_en).getTime() < Date.now();

  return (
    <div>
      <Link to={`/pacientes/${id}`} className="btn btn-secondary" style={{ marginBottom: '1rem', fontSize: '0.8rem', padding: '0.4rem 1rem' }}>
        {t.comun.volver}
      </Link>

      <h1>{t.suscripcion.titulo}</h1>

      {!suscripcion && <div className="estado-vacio" role="status">{t.suscripcion.sin_suscripcion}</div>}

      {suscripcion && (
        <>
          <div className="guardia-card-detalle">
            {traducirValor(t.suscripcion, `estado_${suscripcion.estado}`)}
          </div>
          <div className="guardia-card-detalle">
            {t.suscripcion.monto_mensual}: {suscripcion.monto_mensual}
          </div>
          {suscripcion.proximo_cobro && (
            <div className="guardia-card-detalle">
              {t.suscripcion.proximo_cobro}: {suscripcion.proximo_cobro}
            </div>
          )}

          {(suscripcion.estado === 'activa' || suscripcion.estado === 'trial') && (
            <div style={{ marginTop: '1.5rem' }}>
              <h2>{t.suscripcion.generar_qr_titulo}</h2>
              <p className="guardia-card-detalle">{t.suscripcion.generar_qr_explicacion}</p>

              {cobrado && <div className="alert alert-success" role="status">{t.suscripcion.qr_cobrado}</div>}

              {!cobrado && qr && !qrVencido && qrDataUrl && (
                <div style={{ textAlign: 'center', marginTop: '1rem' }}>
                  <img src={qrDataUrl} alt={t.suscripcion.generar_qr_titulo} />
                  <p className="mapa-actualizado">{t.suscripcion.qr_vence_en.replace('{minutos}', minutosRestantes(qr.expira_en))}</p>
                  <p className="mapa-actualizado">{t.suscripcion.qr_esperando_cobro}</p>
                </div>
              )}

              {qrVencido && <div className="alert alert-error" role="alert">{t.suscripcion.qr_vencido}</div>}

              {(!qr || qrVencido || cobrado) && (
                <button type="button" className="btn btn-primary btn-full" onClick={generarQr} disabled={generando} style={{ marginTop: '1rem' }}>
                  {generando ? t.suscripcion.generando_qr : (qr ? t.suscripcion.qr_generar_otro : t.suscripcion.generar_qr_boton)}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
