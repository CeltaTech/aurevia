import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { useConfirmarDestructivo } from '../context/TenantSessionContext';
import { supabase } from '../lib/supabaseClient';
import { claseBadge } from '../lib/tonos';
import { diasParaVencer } from '../lib/reglaVencimientos';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { EstadoLista } from '../components/layout/EstadoLista';
import { mensajeDeError } from '../lib/errores';

function primerDiaDelMes(fechaISO) {
  return `${fechaISO.slice(0, 7)}-01`;
}

function mesActualISO() {
  return primerDiaDelMes(new Date().toISOString().slice(0, 10));
}

export function Facturacion() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const confirmarDestructivo = useConfirmarDestructivo();

  const [periodo, setPeriodo] = useState(mesActualISO());
  const [vencimiento, setVencimiento] = useState('');
  const [facturas, setFacturas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [generando, setGenerando] = useState(false);
  const [avisoGeneracion, setAvisoGeneracion] = useState(null);
  const [actualizandoId, setActualizandoId] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);

    const { data, error: errorConsulta } = await supabase
      .from('facturas_familia')
      .select('id, periodo, monto_total, estado, fecha_emision, fecha_vencimiento, familias(solicitudes!familias_solicitud_id_fkey(nombre))')
      .order('periodo', { ascending: false })
      .order('fecha_emision', { ascending: false });

    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }

    setFacturas(data ?? []);
    setEstado('listo');
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const facturasDelPeriodo = useMemo(() => facturas.filter((f) => f.periodo === periodo), [facturas, periodo]);

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
          prestadora_id: usuario.prestadora_id,
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

  async function handleMarcarPagada(factura) {
    setActualizandoId(factura.id);
    const { error: errorUpdate } = await supabase.from('facturas_familia').update({ estado: 'pagada' }).eq('id', factura.id);
    setActualizandoId(null);
    if (errorUpdate) {
      setError(mensajeDeError(errorUpdate, t));
      return;
    }
    recargar();
  }

  return (
    <div>
      <h1>{t.facturacion.titulo}</h1>
      <p className="panel-explicacion">{t.facturacion.explicacion}</p>

      <Alert variant="info">
        <strong>{t.facturacion.aviso_titulo}.</strong> {t.facturacion.aviso_texto}
      </Alert>

      {error && <Alert variant="error">{error}</Alert>}
      {avisoGeneracion && <Alert variant="info">{avisoGeneracion}</Alert>}

      <div className="panel-filtros">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {t.facturacion.col_periodo}
          <input type="month" value={periodo.slice(0, 7)} onChange={(e) => setPeriodo(primerDiaDelMes(`${e.target.value}-01`))} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {t.facturacion.col_vencimiento}
          <input type="date" value={vencimiento} onChange={(e) => setVencimiento(e.target.value)} />
        </label>
        <Button onClick={handleGenerar} disabled={generando}>
          {generando ? t.facturacion.generando : t.facturacion.generar}
        </Button>
      </div>

      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && facturasDelPeriodo.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.facturacion.col_familia}</th>
              <th>{t.facturacion.col_monto}</th>
              <th>{t.facturacion.col_estado}</th>
              <th>{t.facturacion.col_emision}</th>
              <th>{t.facturacion.col_vencimiento}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {facturasDelPeriodo.map((f) => {
              // El estado guardado solo distingue cobrado de pendiente. Que un saldo esté
              // vencido se deduce de la fecha en el momento de mirarlo, con la misma cuenta de
              // días que usa el resto del Panel (regla 12, §7): nadie lo marca ni lo actualiza.
              const estadoVisible = f.estado === 'pendiente' && diasParaVencer(f.fecha_vencimiento) < 0 ? 'vencida' : f.estado;
              return (
              <tr key={f.id}>
                <td>{f.familias?.solicitudes?.nombre || '—'}</td>
                <td>{Number(f.monto_total).toLocaleString(undefined, { style: 'currency', currency: 'ARS' })}</td>
                <td><span className={claseBadge(estadoVisible)}>{t.facturacion[`estado_${estadoVisible}`]}</span></td>
                <td>{f.fecha_emision}</td>
                <td>{f.fecha_vencimiento || '—'}</td>
                <td>
                  {f.estado === 'pendiente' && (
                    <Button variant="secondary" onClick={() => handleMarcarPagada(f)} disabled={actualizandoId === f.id}>
                      {actualizandoId === f.id ? t.comun.guardando : t.facturacion.marcar_pagada}
                    </Button>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </EstadoLista>
    </div>
  );
}
