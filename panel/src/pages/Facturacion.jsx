import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { traducirValor } from '../i18n/valores';
import { useConfirmarDestructivo } from '../context/TenantSessionContext';
import { supabase } from '../lib/supabaseClient';
import { llamarApiCobros } from '../lib/apiCobros';
import { claseBadge } from '../lib/tonos';
import { formatearImporte } from '../lib/dinero';
import { hoyISO } from '../lib/horarios';
import { MEDIOS, loQueEstaMalEnElCobro } from '../lib/cobrosDeFamilia';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { FormField } from '../components/ui/FormField';
import { EstadoLista } from '../components/layout/EstadoLista';
import { mensajeDeError } from '../lib/errores';
import { useModalAccesible } from '../hooks/useModalAccesible';
import { usePrestadoraActual } from '../hooks/usePrestadoraActual';

/* Los saldos de las Familias: lo facturado, lo que entró y lo que falta.
   ==========================================================================

   LA RESTA NO SE HACE ACÁ. Hasta la etapa anterior esta pantalla mostraba el monto facturado y
   un estado de dos valores que alguien marcaba a mano, así que una Familia que había pagado la
   mitad se veía igual que una que no había pagado nada. Ahora el saldo sale de la vista
   `saldos_familia` de la base, que es el único lugar donde vive esa cuenta (regla 12 de
   CLAUDE.md §7). El navegador la pide y la muestra; no la rehace, porque dos cuentas que pueden
   dar distinto es peor que una sola.

   POR QUÉ EL ESTADO YA NO SE MARCA A MANO. El botón de "marcar como cobrado" desapareció, y no
   por prolijidad: el estado ahora se deduce de la resta y de la fecha de vencimiento, y la base
   lo recalcula sola cada vez que entra o se anula un cobro. Un botón que escribiera el estado
   sería un dato que la base pisa al instante.

   POR DÓNDE PUEDE ENTRAR LA PLATA. Acá se anota lo que se cobró en el mostrador o por
   transferencia, pero no es la única puerta: el motor tiene una entrada para lotes que vienen de
   un archivo importado, del sistema contable de la Prestadora o de una pasarela. Por eso al lado
   de cada saldo se muestra de dónde salió el dato y de cuándo es: un número que puso otro
   sistema tiene que poder distinguirse de uno que cargó una persona.

   LO QUE NO HACE. No emite comprobantes fiscales —el producto no los emite (regla 14)— y no
   decide nada: que una Familia deba plata no corta ningún Servicio. La pantalla avisa; lo demás
   lo resuelve una persona. */

function mesActual() {
  return hoyISO().slice(0, 7);
}

/** De dónde salieron los cobros de un saldo, en palabras. */
function textoDeOrigenes(origenes, t) {
  if (!origenes || origenes.length === 0) return t.facturacion.nunca_cobrado;
  return origenes.map((o) => traducirValor(t.facturacion, `origen_${o}`)).join(', ');
}

/** Un momento guardado, mostrado como fecha nada más: la hora no agrega nada acá. */
function soloLaFecha(momento) {
  return momento ? String(momento).slice(0, 10) : '—';
}

export function Facturacion() {
  const { t, locale } = useLocale();
  const prestadoraId = usePrestadoraActual();
  const confirmarDestructivo = useConfirmarDestructivo();

  const [mes, setMes] = useState(mesActual());
  const [vencimiento, setVencimiento] = useState('');
  const [saldos, setSaldos] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [generando, setGenerando] = useState(false);
  const [avisoGeneracion, setAvisoGeneracion] = useState(null);
  const [detalleId, setDetalleId] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      setSaldos(await llamarApiCobros(`/saldos?periodo=${mes}`));
      setEstado('listo');
    } catch (e) {
      setError(mensajeDeError(e, t, 'saldos de familias'));
      setEstado('error');
    }
  }, [mes, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  // Un saldo sin fecha de vencimiento no se puede reclamar ni mostrar como vencido, así que
  // la fecha se pide antes de generar en vez de ponerle una por defecto: hasta cuándo tiene
  // para pagar cada Familia lo acordó la Prestadora, no lo decide el sistema (regla 1, §7).
  async function handleGenerar() {
    if (!vencimiento) {
      setError(t.facturacion.falta_vencimiento);
      return;
    }

    const confirmado = await confirmarDestructivo(t.facturacion.confirmar_generar);
    if (!confirmado) return;

    setGenerando(true);
    setAvisoGeneracion(null);
    setError(null);

    const periodo = `${mes}-01`;

    const { data: familiasData, error: errorFamilias } = await supabase
      .from('familias')
      .select('id, pacientes(id, nombre)')
      .is('deleted_at', null);

    if (errorFamilias) {
      setError(mensajeDeError(errorFamilias, t));
      setGenerando(false);
      return;
    }

    const pacienteIds = (familiasData ?? []).flatMap((f) => f.pacientes.map((p) => p.id));

    const { data: prestacionesData, error: errorPrestaciones } = pacienteIds.length
      ? await supabase
          .from('prestaciones')
          .select('id, paciente_id, tipo_servicio, precio_final')
          .eq('estado', 'vigente')
          .in('paciente_id', pacienteIds)
      : { data: [], error: null };

    if (errorPrestaciones) {
      setError(mensajeDeError(errorPrestaciones, t));
      setGenerando(false);
      return;
    }

    const { data: existentesData } = await supabase.from('facturas_familia').select('familia_id').eq('periodo', periodo);
    const familiasYaFacturadas = new Set((existentesData ?? []).map((f) => f.familia_id));

    const prestacionesPorPaciente = {};
    for (const p of prestacionesData ?? []) {
      (prestacionesPorPaciente[p.paciente_id] ??= []).push(p);
    }

    let generadas = 0;
    let sinPrestaciones = 0;

    for (const familia of familiasData ?? []) {
      if (familiasYaFacturadas.has(familia.id)) continue;

      const items = familia.pacientes.flatMap((paciente) =>
        (prestacionesPorPaciente[paciente.id] ?? []).map((p) => ({
          paciente_id: paciente.id,
          descripcion: `${p.tipo_servicio} — ${paciente.nombre}`,
          monto: p.precio_final,
        }))
      );

      if (items.length === 0) {
        sinPrestaciones += 1;
        continue;
      }

      const montoTotal = items.reduce((acc, i) => acc + Number(i.monto), 0);

      const { data: facturaCreada, error: errorFactura } = await supabase
        .from('facturas_familia')
        .insert({
          prestadora_id: prestadoraId,
          familia_id: familia.id,
          periodo,
          monto_total: montoTotal,
          fecha_vencimiento: vencimiento,
        })
        .select('id')
        .single();

      if (errorFactura) {
        setError(mensajeDeError(errorFactura, t));
        setGenerando(false);
        return;
      }

      const { error: errorItems } = await supabase
        .from('facturas_familia_items')
        .insert(items.map((i) => ({ ...i, factura_id: facturaCreada.id })));

      if (errorItems) {
        setError(mensajeDeError(errorItems, t));
        setGenerando(false);
        return;
      }

      generadas += 1;
    }

    setGenerando(false);
    setAvisoGeneracion(t.facturacion.resultado_generacion.replace('{generadas}', generadas).replace('{sinPrestaciones}', sinPrestaciones));
    recargar();
  }

  return (
    <div>
      <h1>{t.facturacion.titulo}</h1>
      <p className="panel-explicacion">{t.facturacion.explicacion}</p>

      <Alert variant="info">
        <strong>{t.facturacion.aviso_titulo}.</strong> {t.facturacion.aviso_texto}
      </Alert>

      {error && estado !== 'error' && <Alert variant="error">{error}</Alert>}
      {avisoGeneracion && <Alert variant="info">{avisoGeneracion}</Alert>}

      <div className="panel-filtros">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {t.facturacion.col_periodo}
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {t.facturacion.col_vencimiento}
          <input type="date" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} />
        </label>
        <Button onClick={handleGenerar} disabled={generando}>
          {generando ? t.facturacion.generando : t.facturacion.generar}
        </Button>
      </div>

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && saldos.length === 0}
        mensajeVacio={t.facturacion.vacio_texto}
        recargar={recargar}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.facturacion.col_familia}</th>
              <th>{t.facturacion.col_facturado}</th>
              <th>{t.facturacion.col_cobrado}</th>
              <th>{t.facturacion.col_saldo}</th>
              <th>{t.facturacion.col_estado}</th>
              <th>{t.facturacion.col_emision}</th>
              <th>{t.facturacion.col_vencimiento}</th>
              <th>{t.facturacion.col_origen}</th>
              <th>{t.facturacion.col_actualizado}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {saldos.map((s) => (
              <tr key={s.factura_id}>
                <td>{s.familia_nombre || '—'}</td>
                <td>{formatearImporte(s.monto_total, s.moneda, locale)}</td>
                <td>{formatearImporte(s.cobrado, s.moneda, locale)}</td>
                <td>{formatearImporte(s.saldo, s.moneda, locale)}</td>
                <td>
                  <span className={claseBadge(s.estado)}>{traducirValor(t.facturacion, `estado_${s.estado}`)}</span>
                </td>
                <td>{s.fecha_emision || '—'}</td>
                <td>{s.fecha_vencimiento || '—'}</td>
                <td>{textoDeOrigenes(s.origenes, t)}</td>
                <td>{soloLaFecha(s.actualizado_en)}</td>
                <td>
                  <Button variant="secondary" onClick={() => setDetalleId(s.factura_id)}>
                    {t.comun.ver_detalle}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {detalleId && (
        <DetalleDeSaldo facturaId={detalleId} onCerrar={() => setDetalleId(null)} onCambio={recargar} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// El detalle de un saldo: qué se facturó y todos los cobros que lo fueron bajando
// ---------------------------------------------------------------------------------------

/* Los cobros anulados se muestran igual que los vigentes, tachados en su estado pero presentes.
   Anular no es borrar: una plata que desaparece sin rastro es indistinguible de una que nunca
   existió, y con plata de un tercero eso es justo lo que no puede pasar. */
function DetalleDeSaldo({ facturaId, onCerrar, onCambio }) {
  const modal = useModalAccesible(onCerrar);
  const { t, locale } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();

  const [detalle, setDetalle] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [procesando, setProcesando] = useState(false);
  const [aAnular, setAAnular] = useState(null);
  const [motivo, setMotivo] = useState('');
  // El aviso de que falta el motivo aparece recién cuando alguien escribió y borró, no apenas
  // se abre el formulario: un campo en rojo antes de tocarlo se lee como un error propio.
  const [motivoTocado, setMotivoTocado] = useState(false);
  const [cobro, setCobro] = useState({
    monto: '',
    fecha_cobro: hoyISO(),
    medio: MEDIOS[0],
    referencia_externa: '',
    observaciones: '',
  });

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      setDetalle(await llamarApiCobros(`/facturas/${facturaId}`));
      setEstado('listo');
    } catch (e) {
      setError(mensajeDeError(e, t, 'detalle del saldo'));
      setEstado('error');
    }
  }, [facturaId, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  // La misma comprobación que hace el motor antes de escribir, leída del archivo compartido:
  // así el botón no ofrece guardar algo que después se rechaza (regla 12, §7).
  const loQueFalta = loQueEstaMalEnElCobro(cobro);

  async function registrarCobro() {
    setProcesando(true);
    setError(null);
    try {
      await llamarApiCobros(`/facturas/${facturaId}/cobros`, {
        method: 'POST',
        body: JSON.stringify({
          monto: Number(cobro.monto),
          fecha_cobro: cobro.fecha_cobro,
          medio: cobro.medio,
          referencia_externa: cobro.referencia_externa.trim() || null,
          observaciones: cobro.observaciones.trim() || null,
        }),
      });
      setCobro({ ...cobro, monto: '', referencia_externa: '', observaciones: '' });
      await recargar();
      await onCambio();
    } catch (e) {
      setError(mensajeDeError(e, t, 'anotar un cobro'));
    }
    setProcesando(false);
  }

  async function anularCobro() {
    if (!(await confirmarDestructivo(t.facturacion.confirmar_anular))) return;

    setProcesando(true);
    setError(null);
    try {
      await llamarApiCobros(`/cobros/${aAnular.id}/anular`, {
        method: 'POST',
        body: JSON.stringify({ motivo: motivo.trim() }),
      });
      setAAnular(null);
      setMotivo('');
      await recargar();
      await onCambio();
    } catch (e) {
      setError(mensajeDeError(e, t, 'anular un cobro'));
    }
    setProcesando(false);
  }

  return (
    <div className="panel-modal-fondo" onClick={onCerrar}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.facturacion.detalle_titulo}</h2>

        {error && estado !== 'error' && <Alert variant="error">{error}</Alert>}

        <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
          {detalle && (
            <>
              <dl className="panel-detalle-lista">
                <dt>{t.facturacion.col_familia}</dt>
                <dd>{detalle.familia_nombre || '—'}</dd>
                <dt>{t.facturacion.col_facturado}</dt>
                <dd>{formatearImporte(detalle.monto_total, detalle.moneda, locale)}</dd>
                <dt>{t.facturacion.col_cobrado}</dt>
                <dd>{formatearImporte(detalle.cobrado, detalle.moneda, locale)}</dd>
                <dt>{t.facturacion.col_saldo}</dt>
                <dd>{formatearImporte(detalle.saldo, detalle.moneda, locale)}</dd>
                <dt>{t.facturacion.col_estado}</dt>
                <dd>
                  <span className={claseBadge(detalle.estado)}>
                    {traducirValor(t.facturacion, `estado_${detalle.estado}`)}
                  </span>
                </dd>
                <dt>{t.facturacion.col_vencimiento}</dt>
                <dd>{detalle.fecha_vencimiento || '—'}</dd>
                <dt>{t.facturacion.col_origen}</dt>
                <dd>
                  {detalle.ultimo_cobro_fecha
                    ? t.facturacion.ultimo_cobro.replace('{fecha}', detalle.ultimo_cobro_fecha)
                    : t.facturacion.nunca_cobrado}
                </dd>
              </dl>

              {detalle.cobros.length === 0 ? (
                <p className="panel-dato-vacio">{t.facturacion.sin_cobros}</p>
              ) : (
                <table className="panel-tabla">
                  <thead>
                    <tr>
                      <th>{t.facturacion.col_fecha_cobro}</th>
                      <th>{t.facturacion.col_importe}</th>
                      <th>{t.facturacion.col_medio}</th>
                      <th>{t.facturacion.col_referencia}</th>
                      <th>{t.facturacion.col_origen}</th>
                      <th>{t.facturacion.col_estado}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {detalle.cobros.map((c) => (
                      <tr key={c.id}>
                        <td>{c.fecha_cobro}</td>
                        <td>{formatearImporte(c.monto, c.moneda, locale)}</td>
                        <td>{traducirValor(t.facturacion, `medio_${c.medio}`)}</td>
                        <td>{c.referencia_externa || '—'}</td>
                        <td>{traducirValor(t.facturacion, `origen_${c.origen}`)}</td>
                        <td>
                          <span className={claseBadge(c.estado)}>
                            {c.estado === 'anulado'
                              ? t.facturacion.cobro_estado_anulado
                              : t.facturacion.cobro_estado_registrado}
                          </span>
                          {c.estado === 'anulado' && c.motivo_anulacion && (
                            <small className="form-ayuda">
                              {t.facturacion.anulado_motivo.replace('{motivo}', c.motivo_anulacion)}
                            </small>
                          )}
                        </td>
                        <td>
                          {c.estado !== 'anulado' && (
                            <Button
                              variant="secondary"
                              onClick={() => {
                                setAAnular(c);
                                setMotivo('');
                                setMotivoTocado(false);
                              }}
                              disabled={procesando}
                            >
                              {t.facturacion.anular}
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Anular pide por qué, y el motivo queda guardado. Se pregunta acá adentro y no en
                  otra ventana encima de esta, que taparía justamente la fila que se está por
                  anular. */}
              {aAnular ? (
                <>
                  <h3>{t.facturacion.anular_titulo}</h3>
                  <dl className="panel-detalle-lista">
                    <dt>{t.facturacion.col_fecha_cobro}</dt>
                    <dd>{aAnular.fecha_cobro}</dd>
                    <dt>{t.facturacion.col_importe}</dt>
                    <dd>{formatearImporte(aAnular.monto, aAnular.moneda, locale)}</dd>
                  </dl>
                  <FormField
                    label={t.facturacion.anular_motivo}
                    name="motivo_anulacion"
                    type="textarea"
                    required
                    rows={2}
                    value={motivo}
                    ayuda={t.facturacion.anular_motivo_ayuda}
                    error={motivoTocado && motivo.trim() === '' ? t.facturacion.falta_motivo : undefined}
                    onChange={(e) => {
                      setMotivo(e.target.value);
                      setMotivoTocado(true);
                    }}
                  />
                  <div className="panel-modal-acciones">
                    <Button onClick={anularCobro} disabled={procesando || motivo.trim() === ''}>
                      {procesando ? t.comun.guardando : t.facturacion.anular}
                    </Button>
                    <Button variant="secondary" onClick={() => setAAnular(null)} disabled={procesando}>
                      {t.comun.cancelar}
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <h3>{t.facturacion.cobro_titulo}</h3>
                  <FormField
                    label={t.facturacion.campo_monto}
                    name="monto"
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={cobro.monto}
                    ayuda={t.facturacion.campo_monto_ayuda}
                    error={cobro.monto !== '' && loQueFalta ? t.facturacion.monto_invalido : undefined}
                    onChange={(e) => setCobro({ ...cobro, monto: e.target.value })}
                  />
                  <FormField
                    label={t.facturacion.campo_fecha}
                    name="fecha_cobro"
                    type="date"
                    required
                    value={cobro.fecha_cobro}
                    ayuda={t.facturacion.campo_fecha_ayuda}
                    onChange={(e) => setCobro({ ...cobro, fecha_cobro: e.target.value })}
                  />
                  <FormField
                    label={t.facturacion.campo_medio}
                    name="medio"
                    type="select"
                    required
                    value={cobro.medio}
                    onChange={(e) => setCobro({ ...cobro, medio: e.target.value })}
                  >
                    {MEDIOS.map((m) => (
                      <option key={m} value={m}>
                        {traducirValor(t.facturacion, `medio_${m}`)}
                      </option>
                    ))}
                  </FormField>
                  <FormField
                    label={t.facturacion.campo_referencia}
                    name="referencia_externa"
                    value={cobro.referencia_externa}
                    ayuda={t.facturacion.campo_referencia_ayuda}
                    onChange={(e) => setCobro({ ...cobro, referencia_externa: e.target.value })}
                  />
                  <FormField
                    label={t.facturacion.campo_observaciones}
                    name="observaciones"
                    type="textarea"
                    rows={2}
                    value={cobro.observaciones}
                    onChange={(e) => setCobro({ ...cobro, observaciones: e.target.value })}
                  />
                  <div className="panel-modal-acciones">
                    <Button onClick={registrarCobro} disabled={procesando || loQueFalta !== null}>
                      {procesando ? t.comun.guardando : t.facturacion.guardar_cobro}
                    </Button>
                    <Button variant="secondary" onClick={onCerrar} disabled={procesando}>
                      {t.comun.cerrar}
                    </Button>
                  </div>
                </>
              )}
            </>
          )}
        </EstadoLista>
      </div>
    </div>
  );
}
