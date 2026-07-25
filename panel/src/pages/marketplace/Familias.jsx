import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';

const API_URL = import.meta.env.VITE_API_URL;
const LECTOR_ID = 'lector-qr-cobro-efectivo';

async function llamarApi(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/marketplace${path}`, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session?.access_token}`,
      ...opciones.headers,
    },
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.error);
  return resultado;
}

function fechaHoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export function MarketplaceFamilias() {
  const { t } = useLocale();
  const [suscripciones, setSuscripciones] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [expandida, setExpandida] = useState(null);
  const [cobrosPorSuscripcion, setCobrosPorSuscripcion] = useState({});
  const [formEfectivo, setFormEfectivo] = useState(null);
  const [guardandoEfectivo, setGuardandoEfectivo] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [mensajeCanje, setMensajeCanje] = useState(null);
  const lectorRef = useRef(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { suscripciones: filas } = await llamarApi('/suscripciones');
      setSuscripciones(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function verCobros(suscripcionId) {
    if (expandida === suscripcionId) {
      setExpandida(null);
      return;
    }
    setExpandida(suscripcionId);
    setFormEfectivo(null);
    if (!cobrosPorSuscripcion[suscripcionId]) {
      const { cobros } = await llamarApi(`/suscripciones/${suscripcionId}/cobros`);
      setCobrosPorSuscripcion((c) => ({ ...c, [suscripcionId]: cobros }));
    }
  }

  async function recargarCobros(suscripcionId) {
    const { cobros } = await llamarApi(`/suscripciones/${suscripcionId}/cobros`);
    setCobrosPorSuscripcion((c) => ({ ...c, [suscripcionId]: cobros }));
  }

  async function guardarEfectivo() {
    setGuardandoEfectivo(true);
    setError(null);
    try {
      await llamarApi('/cobros/efectivo-manual', {
        method: 'POST',
        body: JSON.stringify({
          suscripcion_id: formEfectivo.suscripcionId,
          monto: formEfectivo.monto,
          periodo: formEfectivo.periodo,
          fecha_cobro: formEfectivo.fechaCobro,
        }),
      });
      await recargarCobros(formEfectivo.suscripcionId);
      setFormEfectivo(null);
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoEfectivo(false);
    }
  }

  useEffect(() => {
    if (!escaneando) return undefined;
    let cancelado = false;
    const lector = new Html5Qrcode(LECTOR_ID);
    lectorRef.current = lector;

    async function detener() {
      try {
        await lector.stop();
        lector.clear();
      } catch {
        // la cámara ya pudo haberse detenido
      }
    }

    lector
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: 250 },
        async (token) => {
          if (cancelado) return;
          cancelado = true;
          await detener();
          setEscaneando(false);
          try {
            const { monto } = await llamarApi('/qr-cobro/canjear', {
              method: 'POST',
              body: JSON.stringify({ token }),
            });
            setMensajeCanje(t.marketplace.canjear_qr_exitoso.replace('{monto}', monto));
            setExpandida(null);
            recargar();
          } catch (err) {
            setError(err.message);
          }
        },
        () => {}
      )
      .catch(() => {
        setError(t.comun.error_generico);
        setEscaneando(false);
      });

    return () => {
      cancelado = true;
      detener();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [escaneando]);

  return (
    <div>
      <h1>{t.marketplace.familias_titulo}</h1>
      <p className="panel-explicacion">{t.marketplace.familias_explicacion}</p>

      {mensajeCanje && <Alert variant="success">{mensajeCanje}</Alert>}
      {error && <Alert variant="error">{error}</Alert>}

      <div style={{ marginBottom: '1.5rem' }}>
        <h2>{t.marketplace.canjear_qr_titulo}</h2>
        <p className="panel-explicacion">{t.marketplace.canjear_qr_explicacion}</p>
        {!escaneando && (
          <Button
            onClick={() => {
              setMensajeCanje(null);
              setError(null);
              setEscaneando(true);
            }}
          >
            {t.marketplace.canjear_qr_iniciar}
          </Button>
        )}
        {escaneando && (
          <div>
            <div id={LECTOR_ID} style={{ width: '100%', maxWidth: 320, borderRadius: '12px', overflow: 'hidden' }} />
            <Button variant="secondary" onClick={() => setEscaneando(false)}>{t.comun.cancelar}</Button>
          </div>
        )}
      </div>

      <EstadoLista estado={estado} error={null} vacio={estado === 'listo' && suscripciones.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.marketplace.col_familia}</th>
              <th>{t.marketplace.col_paciente}</th>
              <th>{t.marketplace.col_asistente}</th>
              <th>{t.marketplace.col_estado}</th>
              <th>{t.marketplace.col_monto}</th>
              <th>{t.marketplace.col_proximo_cobro}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {suscripciones.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td>{s.familia_nombre || '—'}</td>
                  <td>{s.paciente_nombre || '—'}</td>
                  <td>{s.asistente_nombre || '—'}</td>
                  <td>{t.marketplace[`estado_${s.estado}`] || s.estado}</td>
                  <td>{s.monto_mensual}</td>
                  <td>{s.proximo_cobro || '—'}</td>
                  <td>
                    <Button variant="secondary" onClick={() => verCobros(s.id)}>{t.marketplace.ver_cobros}</Button>
                  </td>
                </tr>
                {expandida === s.id && (
                  <tr>
                    <td colSpan={7}>
                      <h3>{t.marketplace.cobros_titulo}</h3>
                      <table className="panel-tabla">
                        <thead>
                          <tr>
                            <th>{t.marketplace.cobros_col_periodo}</th>
                            <th>{t.marketplace.cobros_col_medio}</th>
                            <th>{t.marketplace.cobros_col_monto}</th>
                            <th>{t.marketplace.cobros_col_estado}</th>
                            <th>{t.marketplace.cobros_col_fecha}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(cobrosPorSuscripcion[s.id] || []).map((c) => (
                            <tr key={c.id}>
                              <td>{c.periodo}</td>
                              <td>{t.marketplace[`medio_${c.medio}`] || c.medio}</td>
                              <td>{c.monto}</td>
                              <td>{t.marketplace[`cobro_${c.estado_cobro}`] || c.estado_cobro}</td>
                              <td>{c.fecha_cobro || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      {formEfectivo?.suscripcionId === s.id ? (
                        <div>
                          <FormField
                            label={t.marketplace.registrar_cobro_efectivo_monto}
                            name="monto"
                            type="number"
                            value={formEfectivo.monto}
                            onChange={(e) => setFormEfectivo((f) => ({ ...f, monto: e.target.value }))}
                          />
                          <FormField
                            label={t.marketplace.registrar_cobro_efectivo_periodo}
                            name="periodo"
                            type="month"
                            value={formEfectivo.periodo}
                            onChange={(e) => setFormEfectivo((f) => ({ ...f, periodo: e.target.value }))}
                          />
                          <FormField
                            label={t.marketplace.registrar_cobro_efectivo_fecha}
                            name="fecha_cobro"
                            type="date"
                            value={formEfectivo.fechaCobro}
                            onChange={(e) => setFormEfectivo((f) => ({ ...f, fechaCobro: e.target.value }))}
                          />
                          <Button onClick={guardarEfectivo} disabled={guardandoEfectivo}>
                            {guardandoEfectivo ? t.comun.guardando : t.marketplace.registrar_cobro_efectivo_guardar}
                          </Button>{' '}
                          <Button variant="secondary" onClick={() => setFormEfectivo(null)} disabled={guardandoEfectivo}>
                            {t.comun.cancelar}
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="secondary"
                          onClick={() => setFormEfectivo({ suscripcionId: s.id, monto: '', periodo: '', fechaCobro: fechaHoyISO() })}
                        >
                          {t.marketplace.registrar_cobro_efectivo}
                        </Button>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </EstadoLista>
    </div>
  );
}
