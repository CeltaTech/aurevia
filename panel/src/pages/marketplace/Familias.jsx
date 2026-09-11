import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useLocale } from '../../i18n/LocaleContext';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { llamarApiMarketplace as llamarApi } from '../../lib/apiMarketplace';

const LECTOR_ID = 'lector-qr-cobro-efectivo';

function fechaHoyISO() {
  return new Date().toISOString().slice(0, 10);
}

export function MarketplaceFamilias() {
  const { t } = useLocale();
  const [accesos, setAccesos] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [expandida, setExpandida] = useState(null);
  const [cobrosPorAcceso, setCobrosPorAcceso] = useState({});
  const [formEfectivo, setFormEfectivo] = useState(null);
  const [guardandoEfectivo, setGuardandoEfectivo] = useState(false);
  const [escaneando, setEscaneando] = useState(false);
  const [mensajeCanje, setMensajeCanje] = useState(null);
  const [rielesConectados, setRielesConectados] = useState([]);
  const [rielElegido, setRielElegido] = useState({});
  const [dandoAlta, setDandoAlta] = useState(null);
  const lectorRef = useRef(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      // Las pasarelas se piden junto con los accesos porque de ellas depende qué se puede hacer
      // en esta pantalla: con ninguna conectada no hay alta posible, y con más de una hay que
      // elegir cuál cobra. Elegir por la Prestadora sería decidir con qué cobra.
      const [{ accesos: filas }, { pasarelas }] = await Promise.all([
        llamarApi('/accesos'),
        llamarApi('/pasarela'),
      ]);
      setAccesos(filas);
      setRielesConectados((pasarelas || []).filter((p) => p.estado_conexion === 'conectada').map((p) => p.proveedor));
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function verCobros(accesoId) {
    if (expandida === accesoId) {
      setExpandida(null);
      return;
    }
    setExpandida(accesoId);
    setFormEfectivo(null);
    if (!cobrosPorAcceso[accesoId]) {
      const { cobros } = await llamarApi(`/accesos/${accesoId}/cobros`);
      setCobrosPorAcceso((c) => ({ ...c, [accesoId]: cobros }));
    }
  }

  async function recargarCobros(accesoId) {
    const { cobros } = await llamarApi(`/accesos/${accesoId}/cobros`);
    setCobrosPorAcceso((c) => ({ ...c, [accesoId]: cobros }));
  }

  async function guardarEfectivo() {
    setGuardandoEfectivo(true);
    setError(null);
    try {
      await llamarApi('/cobros/efectivo-manual', {
        method: 'POST',
        body: JSON.stringify({
          acceso_id: formEfectivo.accesoId,
          monto: formEfectivo.monto,
          periodo: formEfectivo.periodo,
          fecha_cobro: formEfectivo.fechaCobro,
        }),
      });
      await recargarCobros(formEfectivo.accesoId);
      setFormEfectivo(null);
      recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardandoEfectivo(false);
    }
  }

  async function darDeAlta(accesoId) {
    setDandoAlta(accesoId);
    setError(null);
    setMensajeCanje(null);
    try {
      // El riel sólo se manda cuando hay más de uno conectado; con uno solo lo resuelve el motor.
      const elegido = rielesConectados.length > 1 ? rielElegido[accesoId] : null;
      await llamarApi(`/accesos/${accesoId}/alta-en-pasarela`, {
        method: 'POST',
        body: JSON.stringify(elegido ? { proveedor: elegido } : {}),
      });
      setMensajeCanje(t.marketplace.alta_pasarela_exitosa);
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setDandoAlta(null);
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
            setError(mensajeDeError(err, t));
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

      <EstadoLista estado={estado} error={null} vacio={estado === 'listo' && accesos.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.marketplace.col_familia}</th>
              <th>{t.marketplace.col_paciente}</th>
              <th>{t.marketplace.col_asistente}</th>
              <th>{t.marketplace.col_estado}</th>
              <th>{t.marketplace.col_monto}</th>
              <th>{t.marketplace.col_proximo_cobro}</th>
              <th>{t.marketplace.col_cobro}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {accesos.map((s) => (
              <Fragment key={s.id}>
                <tr>
                  <td>{s.familia_nombre || '—'}</td>
                  <td>{s.paciente_nombre || '—'}</td>
                  <td>{s.asistente_nombre || '—'}</td>
                  <td>{t.marketplace[`estado_${s.estado}`] || s.estado}</td>
                  <td>{s.importe}</td>
                  <td>{s.proximo_cobro || '—'}</td>
                  <td>
                    {s.alta_en_pasarela
                      ? t.marketplace[`medio_${s.proveedor}`] || s.proveedor
                      : t.marketplace.alta_pasarela_pendiente}
                  </td>
                  <td>
                    <Button variant="secondary" onClick={() => verCobros(s.id)}>{t.marketplace.ver_cobros}</Button>
                  </td>
                </tr>
                {expandida === s.id && (
                  <tr>
                    <td colSpan={8}>
                      <div style={{ marginBottom: '1.5rem' }}>
                        <h3>{t.marketplace.alta_pasarela_titulo}</h3>
                        {s.alta_en_pasarela ? (
                          <p className="panel-explicacion">
                            {t.marketplace.alta_pasarela_hecha.replace(
                              '{proveedor}',
                              t.marketplace[`medio_${s.proveedor}`] || s.proveedor
                            )}
                            {s.url_accion && (
                              <>
                                {' '}
                                <a href={s.url_accion} target="_blank" rel="noreferrer">
                                  {t.marketplace.alta_pasarela_link}
                                </a>
                              </>
                            )}
                          </p>
                        ) : (
                          <>
                            <p className="panel-explicacion">{t.marketplace.alta_pasarela_explicacion}</p>
                            {rielesConectados.length === 0 ? (
                              <Alert variant="warning">{t.errores.motivos.sin_pasarela_conectada}</Alert>
                            ) : (
                              <>
                                {rielesConectados.length > 1 && (
                                  <FormField
                                    label={t.marketplace.alta_pasarela_riel}
                                    name={`riel-${s.id}`}
                                    type="select"
                                    value={rielElegido[s.id] || ''}
                                    onChange={(e) => setRielElegido((r) => ({ ...r, [s.id]: e.target.value }))}
                                  >
                                    <option value="">{t.comun.seleccionar}</option>
                                    {rielesConectados.map((riel) => (
                                      <option key={riel} value={riel}>
                                        {t.marketplace[`medio_${riel}`] || riel}
                                      </option>
                                    ))}
                                  </FormField>
                                )}
                                <Button
                                  onClick={() => darDeAlta(s.id)}
                                  disabled={
                                    dandoAlta === s.id || (rielesConectados.length > 1 && !rielElegido[s.id])
                                  }
                                >
                                  {dandoAlta === s.id ? t.comun.guardando : t.marketplace.alta_pasarela_boton}
                                </Button>
                              </>
                            )}
                          </>
                        )}
                      </div>

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
                          {(cobrosPorAcceso[s.id] || []).map((c) => (
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

                      {formEfectivo?.accesoId === s.id ? (
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
                          onClick={() => setFormEfectivo({ accesoId: s.id, monto: '', periodo: '', fechaCobro: fechaHoyISO() })}
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
