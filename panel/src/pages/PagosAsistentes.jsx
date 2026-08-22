import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { usePermisos } from '../context/PermisosContext';
import { useConfirmarDestructivo } from '../context/TenantSessionContext';
import { traducirValor } from '../i18n/valores';
import { useFiltros } from '../hooks/useFiltros';
import { useEscalasLegales } from '../hooks/useEscalasLegales';
import { usePrestadoraActual } from '../hooks/usePrestadoraActual';
import { useMonedaActual } from '../hooks/useMonedaActual';
import { llamarApiLiquidaciones } from '../lib/apiLiquidaciones';
import {
  ALCANCES,
  ORIGENES,
  SIGNOS,
  UNIDADES,
  camposDelConcepto,
  conceptoParaGuardar,
  loQueFaltaDelConcepto,
} from '../lib/conceptosLiquidacion';
import { claseBadge } from '../lib/tonos';
import { formatearImporte } from '../lib/dinero';
import { mensajeDeError } from '../lib/errores';
import { esAdminOSuperior } from '../lib/roles';
import { EstadoLista } from '../components/layout/EstadoLista';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { useModalAccesible } from '../hooks/useModalAccesible';

/* Lo que la Prestadora le paga al Asistente, guardado.
   ==========================================================================

   QUÉ CAMBIÓ. Hasta acá esta pantalla hacía la cuenta en el momento, cada vez que se abría,
   con el valor hora que la ficha tuviera ESE día. O sea que corregir hoy el valor hora de
   alguien reescribía lo que se le pagó en marzo, y no había dónde anotar "este mes ya se
   pagó". Ahora la cuenta se hace una vez, queda escrita, y esta pantalla la lee.

   POR QUÉ NO SE CALCULA NADA ACÁ. La liquidación es una foto: se saca con los valores del día
   y no se vuelve a calcular. Si el navegador rehiciera la cuenta para mostrarla, la foto
   dejaría de serlo — bastaría con abrir la pantalla un mes después para ver otro número. Por
   eso todo lo que se ve son datos guardados, y el único botón que produce algo se los pide al
   motor. Los importes tampoco se suman de nuevo para el total: el total también está guardado.

   LAS DOS SOLAPAS. "Liquidaciones" es el mes: qué se le liquidó a cada uno y qué se pagó.
   "Conceptos" es el catálogo de sumas y restas de la Prestadora, que es lo que hace la cuenta
   distinta de una multiplicación. Van juntas porque una no se entiende sin la otra: cuando un
   número no cierra, lo primero que se mira es qué conceptos estaban activos.

   QUIÉN VE Y QUIÉN TOCA. Los importes son remuneraciones, o sea dato sensible (CLAUDE.md §6):
   se ven con el permiso `ver_pagos_asistente`, que la ruta ya exige. Generar, registrar un
   pago y administrar los conceptos es además de la administración de la Prestadora. Es la
   misma pareja de condiciones que las reglas de acceso de la base aplican a estas tablas, y
   por eso la pantalla no inventa una tercera: la refleja.

   LO QUE NO ES: un comprobante fiscal. El producto no emite facturas ni recibos con validez
   impositiva y no está previsto que lo haga (regla 14). Esto es una cuenta interna. */

const TABS = ['liquidaciones', 'conceptos'];

function mesActual() {
  return new Date().toISOString().slice(0, 7);
}

/** El mes de un `periodo` guardado, que en la base es siempre el primer día. */
function mesDelPeriodo(periodo) {
  return String(periodo ?? '').slice(0, 7);
}

function formatearHoras(valor, locale) {
  return `${(Math.round(Number(valor ?? 0) * 10) / 10).toLocaleString(locale)} h`;
}

/**
 * Un valor que a veces es plata y a veces no.
 *
 * Un porcentaje no lleva moneda —no es plata— y por eso no puede pasar por `formatearImporte`,
 * que sin moneda muestra el número pelado: "11" al lado de un importe se lee como once pesos.
 * Se escribe con el signo del idioma de quien mira, sin ponerlo a mano en ningún lado.
 *
 * Vive acá y no en `lib/dinero.js` porque `dinero.js` es un original con copias idénticas en
 * las dos aplicaciones (regla 12), y esto lo usa una sola pantalla: agregarlo allá obligaría a
 * mover la misma función a tres lugares para que la use uno.
 */
function formatearValor(valor, unidad, moneda, locale) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (unidad === 'porcentaje') {
    return (Number(valor) / 100).toLocaleString(locale, { style: 'percent', maximumFractionDigits: 4 });
  }
  return formatearImporte(valor, moneda, locale);
}

export function PagosAsistentes() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const { puede, cargado } = usePermisos();
  const [tab, setTab] = useState('liquidaciones');

  const esAdmin = esAdminOSuperior(usuario?.rol);
  // El catálogo de conceptos es trabajo de la administración de punta a punta —no hay nada
  // para mirar sin poder tocarlo—, así que para el resto la solapa directamente no está.
  const tabsVisibles = esAdmin ? TABS : ['liquidaciones'];

  // La ruta ya exige el permiso antes de montar la pantalla. Esto es el segundo cerrojo: el
  // día que alguien mueva esta pantalla a otra ruta, los importes no quedan a la vista solos.
  if (cargado && !esAdmin && !puede('ver_pagos_asistente')) {
    return <Alert variant="error">{t.errores.sin_permiso}</Alert>;
  }

  return (
    <div>
      <h1>{t.pagos_asistentes.titulo}</h1>
      <p className="panel-explicacion">{t.pagos_asistentes.explicacion}</p>

      <Alert variant="info">
        <strong>{t.pagos_asistentes.aviso_titulo}.</strong> {t.pagos_asistentes.aviso_texto}
      </Alert>

      {tabsVisibles.length > 1 && (
        <div className="panel-tabs">
          {tabsVisibles.map((tabId) => (
            <button
              key={tabId}
              className={`panel-tab ${tab === tabId ? 'panel-tab-activo' : ''}`}
              onClick={() => setTab(tabId)}
            >
              {t.pagos_asistentes.tabs[tabId]}
            </button>
          ))}
        </div>
      )}

      <div className="panel-tab-contenido">
        {tab === 'liquidaciones' && <LiquidacionesTab esAdmin={esAdmin} />}
        {tab === 'conceptos' && esAdmin && <ConceptosTab />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Solapa 1 — las liquidaciones del mes
// ---------------------------------------------------------------------------------------

function LiquidacionesTab({ esAdmin }) {
  const { t, locale } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();

  const [mes, setMes] = useState(mesActual());
  const [liquidaciones, setLiquidaciones] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [generando, setGenerando] = useState(false);
  const [resultado, setResultado] = useState(null);
  const [abiertaId, setAbiertaId] = useState(null);
  const { f, set, limpiar, hayFiltros } = useFiltros({ busqueda: '', estado: 'todos' });

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const datos = await llamarApiLiquidaciones(`/?periodo=${mes}`);
      setLiquidaciones(Array.isArray(datos) ? datos : []);
      setEstado('listo');
    } catch (e) {
      setError(mensajeDeError(e, t, 'liquidaciones'));
      setEstado('error');
    }
  }, [mes, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  // Rehacer un mes borra y vuelve a escribir lo que ya estaba, así que se pregunta antes
  // (regla 4). Lo que ya figura pagado no se toca, y eso lo garantiza el motor, no el aviso.
  async function generar() {
    if (!(await confirmarDestructivo(t.pagos_asistentes.confirmar_generar))) return;
    setGenerando(true);
    setError(null);
    setResultado(null);
    try {
      setResultado(await llamarApiLiquidaciones('/generar', { method: 'POST', body: JSON.stringify({ periodo: mes }) }));
      await recargar();
    } catch (e) {
      setError(mensajeDeError(e, t, 'generar liquidaciones'));
    } finally {
      setGenerando(false);
    }
  }

  const filtradas = useMemo(() => {
    const buscado = f.busqueda.trim().toLowerCase();
    return liquidaciones.filter((l) => {
      if (f.estado !== 'todos' && l.estado !== f.estado) return false;
      if (!buscado) return true;
      return (l.asistente_nombre ?? '').toLowerCase().includes(buscado);
    });
  }, [liquidaciones, f]);

  return (
    <div>
      {estado !== 'error' && error && <Alert variant="error">{error}</Alert>}
      {resultado && <ResultadoGeneracion resultado={resultado} />}

      <div className="panel-filtros">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {t.pagos_asistentes.col_periodo}
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value || mesActual())} />
        </label>
        <input
          type="text"
          placeholder={t.pagos_asistentes.buscar}
          aria-label={t.pagos_asistentes.buscar}
          value={f.busqueda}
          onChange={(e) => set('busqueda', e.target.value)}
        />
        <select value={f.estado} onChange={(e) => set('estado', e.target.value)} aria-label={t.pagos_asistentes.col_estado}>
          <option value="todos">{t.pagos_asistentes.filtro_todos}</option>
          <option value="pendiente">{t.pagos_asistentes.estado_pendiente}</option>
          <option value="pagada">{t.pagos_asistentes.estado_pagada}</option>
        </select>
        {esAdmin ? (
          <Button onClick={generar} disabled={generando || estado === 'cargando'}>
            {generando ? t.pagos_asistentes.generando : t.pagos_asistentes.generar}
          </Button>
        ) : (
          <span className="panel-explicacion">{t.pagos_asistentes.solo_administracion}</span>
        )}
      </div>

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && filtradas.length === 0}
        recargar={recargar}
        filtrado={hayFiltros}
        onLimpiarFiltros={limpiar}
        mensajeVacio={t.pagos_asistentes.vacio_texto}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.pagos_asistentes.col_asistente}</th>
              <th>{t.pagos_asistentes.col_vinculo}</th>
              <th>{t.pagos_asistentes.col_horas}</th>
              <th>{t.pagos_asistentes.col_bruto}</th>
              <th>{t.pagos_asistentes.col_neto}</th>
              <th>{t.pagos_asistentes.col_moneda}</th>
              <th>{t.pagos_asistentes.col_estado}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtradas.map((l) => (
              <tr key={l.id}>
                <td>{l.asistente_nombre || '—'}</td>
                <td>{traducirValor(t.asistentes, `vinculo_${l.tipo_vinculo}`)}</td>
                <td>{formatearHoras(l.horas, locale)}</td>
                <td>{formatearImporte(l.bruto, l.moneda, locale)}</td>
                <td>{formatearImporte(l.neto, l.moneda, locale)}</td>
                {/* La moneda va también en su propia columna, escrita como se guarda. El
                    símbolo del importe se repite entre países —el peso argentino y el uruguayo
                    usan el mismo— y ahí un total se lee mal sin decir nada raro (regla 14). */}
                <td>{l.moneda}</td>
                <td>
                  <span className={claseBadge(l.estado)}>{traducirValor(t.pagos_asistentes, `estado_${l.estado}`)}</span>
                </td>
                <td>
                  <Button variant="secondary" onClick={() => setAbiertaId(l.id)}>
                    {t.comun.ver_detalle}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {abiertaId && (
        <DetalleLiquidacion
          id={abiertaId}
          esAdmin={esAdmin}
          onCerrar={() => setAbiertaId(null)}
          onCambio={() => {
            setAbiertaId(null);
            recargar();
          }}
        />
      )}
    </div>
  );
}

/**
 * Qué pasó al generar.
 *
 * Un "listo" solo no sirve: lo que hace falta saber es a quién le quedó liquidación y a quién
 * no, y por qué. Las cuatro cosas que pueden haber quedado afuera se dicen con nombre y
 * apellido, porque cada una tiene un arreglo distinto —cargar el valor en la ficha, cargar la
 * escala— y sin el nombre hay que salir a buscarlo.
 */
function ResultadoGeneracion({ resultado }) {
  const { t } = useLocale();
  const lista = (valor) => (Array.isArray(valor) ? valor : []);
  const conNombres = [
    { texto: t.pagos_asistentes.resultado_ya_pagadas, nombres: lista(resultado.omitidas_ya_pagadas) },
    { texto: t.pagos_asistentes.resultado_sin_dato_base, nombres: lista(resultado.sin_dato_base) },
    // El motor explica cada salteo en una línea que empieza con el nombre del concepto. Acá se
    // muestra el nombre y el porqué lo pone la frase traducida: la explicación del motor está
    // escrita en un solo idioma y nombra unidades internas, así que no se le pasa a nadie.
    {
      texto: t.pagos_asistentes.resultado_sin_escala,
      nombres: lista(resultado.sin_escala).map((aviso) => String(aviso).split(':')[0]),
    },
  ];

  return (
    <Alert variant="info">
      <p>{t.pagos_asistentes.resultado_generadas.replace('{n}', String(resultado.generadas ?? 0))}</p>
      {Number(resultado.rehechas ?? 0) > 0 && (
        <p>{t.pagos_asistentes.resultado_rehechas.replace('{n}', String(resultado.rehechas))}</p>
      )}
      {conNombres.map(({ texto, nombres }) =>
        nombres.length === 0 ? null : (
          <p key={texto}>
            {texto.replace('{n}', String(nombres.length))} {nombres.join(' · ')}
          </p>
        )
      )}
    </Alert>
  );
}

/**
 * Una liquidación abierta: de dónde salió cada número y qué se hace con ella.
 *
 * Los renglones se muestran tal como se guardaron, con el nombre y el valor que tenía el
 * concepto ese día. El único renglón que no se muestra copiado es el de la base: el motor lo
 * guarda con el detalle de la cuenta para poder explicarlo años después, y la etiqueta que se
 * lee sale de `base_unidad`, que sí está en los tres idiomas.
 */
function DetalleLiquidacion({ id, esAdmin, onCerrar, onCambio }) {
  const modal = useModalAccesible(onCerrar);
  const { t, locale } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();

  const [liquidacion, setLiquidacion] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [pago, setPago] = useState({ fecha_pago: '', forma_pago: '', referencia_pago: '' });
  const [ocupado, setOcupado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      setLiquidacion(await llamarApiLiquidaciones(`/${id}`));
      setEstado('listo');
    } catch (e) {
      setError(mensajeDeError(e, t, 'detalle de liquidación'));
      setEstado('error');
    }
  }, [id, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function registrarPago() {
    setOcupado(true);
    setError(null);
    try {
      await llamarApiLiquidaciones(`/${id}/pagar`, { method: 'POST', body: JSON.stringify(pago) });
      onCambio();
    } catch (e) {
      setError(mensajeDeError(e, t, 'registrar pago'));
      setOcupado(false);
    }
  }

  async function borrar() {
    if (!(await confirmarDestructivo(t.pagos_asistentes.confirmar_borrar))) return;
    setOcupado(true);
    setError(null);
    try {
      await llamarApiLiquidaciones(`/${id}`, { method: 'DELETE' });
      onCambio();
    } catch (e) {
      setError(mensajeDeError(e, t, 'borrar liquidación'));
      setOcupado(false);
    }
  }

  const pendiente = liquidacion?.estado === 'pendiente';
  const items = liquidacion?.items ?? [];

  return (
    <div className="panel-modal-fondo" onClick={onCerrar}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.pagos_asistentes.detalle_titulo}</h2>
        {estado !== 'error' && error && <Alert variant="error">{error}</Alert>}

        <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
          {liquidacion && (
            <>
              <dl className="panel-detalle-lista">
                <dt>{t.pagos_asistentes.col_asistente}</dt>
                <dd>{liquidacion.asistente?.nombre || '—'}</dd>
                <dt>{t.pagos_asistentes.col_periodo}</dt>
                <dd>{mesDelPeriodo(liquidacion.periodo)}</dd>
                <dt>{t.pagos_asistentes.col_vinculo}</dt>
                <dd>{traducirValor(t.asistentes, `vinculo_${liquidacion.tipo_vinculo}`)}</dd>
                <dt>{t.pagos_asistentes.detalle_base}</dt>
                <dd>
                  {formatearImporte(liquidacion.base_valor, liquidacion.moneda, locale)}{' '}
                  {traducirValor(t.pagos_asistentes, `base_${liquidacion.base_unidad}`)}
                </dd>
                <dt>{t.pagos_asistentes.col_horas}</dt>
                <dd>{formatearHoras(liquidacion.horas, locale)}</dd>
                <dt>{t.pagos_asistentes.col_guardias}</dt>
                <dd>{liquidacion.guardias_contadas}</dd>
                <dt>{t.pagos_asistentes.col_estado}</dt>
                <dd>
                  <span className={claseBadge(liquidacion.estado)}>
                    {traducirValor(t.pagos_asistentes, `estado_${liquidacion.estado}`)}
                  </span>
                </dd>
              </dl>

              <table className="panel-tabla">
                <thead>
                  <tr>
                    <th>{t.pagos_asistentes.col_concepto}</th>
                    <th>{t.pagos_asistentes.col_unidad}</th>
                    <th>{t.pagos_asistentes.col_valor_aplicado}</th>
                    <th>{t.pagos_asistentes.col_signo}</th>
                    <th>{t.pagos_asistentes.col_importe}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td>
                        {item.unidad === 'base'
                          ? traducirValor(t.pagos_asistentes, `base_${liquidacion.base_unidad}`)
                          : item.descripcion}
                      </td>
                      <td>{traducirValor(t.pagos_asistentes, `unidad_${item.unidad}`)}</td>
                      <td>{formatearValor(item.valor_aplicado, item.unidad, item.moneda, locale)}</td>
                      <td>{traducirValor(t.pagos_asistentes, `signo_${item.signo}`)}</td>
                      <td>{formatearImporte(item.monto, item.moneda, locale)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>{t.pagos_asistentes.total_bruto}</td>
                    <td>{formatearImporte(liquidacion.bruto, liquidacion.moneda, locale)}</td>
                  </tr>
                  <tr>
                    <td colSpan={4}>{t.pagos_asistentes.total_sumas}</td>
                    <td>{formatearImporte(liquidacion.total_sumas, liquidacion.moneda, locale)}</td>
                  </tr>
                  <tr>
                    <td colSpan={4}>{t.pagos_asistentes.total_restas}</td>
                    <td>{formatearImporte(liquidacion.total_restas, liquidacion.moneda, locale)}</td>
                  </tr>
                  <tr>
                    <td colSpan={4}>
                      <strong>{t.pagos_asistentes.total_neto}</strong>
                    </td>
                    <td>
                      <strong>{formatearImporte(liquidacion.neto, liquidacion.moneda, locale)}</strong>
                    </td>
                  </tr>
                </tfoot>
              </table>

              {/* Una liquidación pagada es el registro de una plata que ya salió: se lee y no
                  se toca. Ni el formulario de pago ni el botón de borrar existen para ella. */}
              {!pendiente && (
                <p className="panel-explicacion">
                  {t.pagos_asistentes.pagada_el.replace('{fecha}', liquidacion.fecha_pago ?? '—')}
                  {liquidacion.forma_pago
                    ? ` · ${t.pagos_asistentes.pagar_forma}: ${liquidacion.forma_pago}`
                    : ''}
                  {liquidacion.referencia_pago
                    ? ` · ${t.pagos_asistentes.pagar_referencia}: ${liquidacion.referencia_pago}`
                    : ''}
                </p>
              )}

              {pendiente && esAdmin && (
                <div>
                  <h3>{t.pagos_asistentes.pagar_titulo}</h3>
                  <FormField
                    label={t.pagos_asistentes.pagar_fecha}
                    name="liquidacion_fecha_pago"
                    type="date"
                    value={pago.fecha_pago}
                    onChange={(e) => setPago({ ...pago, fecha_pago: e.target.value })}
                    required
                  />
                  <FormField
                    label={t.pagos_asistentes.pagar_forma}
                    name="liquidacion_forma_pago"
                    value={pago.forma_pago}
                    onChange={(e) => setPago({ ...pago, forma_pago: e.target.value })}
                  />
                  <FormField
                    label={t.pagos_asistentes.pagar_referencia}
                    name="liquidacion_referencia_pago"
                    value={pago.referencia_pago}
                    onChange={(e) => setPago({ ...pago, referencia_pago: e.target.value })}
                    ayuda={t.pagos_asistentes.pagar_referencia_ayuda}
                  />
                </div>
              )}
            </>
          )}
        </EstadoLista>

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onCerrar} disabled={ocupado}>
            {t.comun.cerrar}
          </Button>
          {pendiente && esAdmin && (
            <>
              <Button variant="secondary" onClick={borrar} disabled={ocupado}>
                {t.comun.borrar}
              </Button>
              {/* Sin fecha, "pagada" no dice nada: la fecha es la mitad del dato, y la base
                  tampoco la acepta sin ella. */}
              <Button onClick={registrarPago} disabled={ocupado || !pago.fecha_pago}>
                {ocupado ? t.comun.guardando : t.pagos_asistentes.pagar}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// Solapa 2 — el catálogo de conceptos de la Prestadora
// ---------------------------------------------------------------------------------------

function ConceptosTab() {
  const { t, locale } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();

  const [conceptos, setConceptos] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [ocupadoId, setOcupadoId] = useState(null);
  const [editando, setEditando] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const datos = await llamarApiLiquidaciones('/conceptos');
      setConceptos(Array.isArray(datos) ? datos : []);
      setEstado('listo');
    } catch (e) {
      setError(mensajeDeError(e, t, 'conceptos de liquidación'));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  /* Un concepto no se borra nunca: dar de baja es dejarlo inactivo. Borrarlo dejaría a los
     renglones ya liquidados apuntando al vacío, y esos renglones son la explicación de un pago
     que ya se hizo. Reactivar no necesita aviso; dar de baja sí, porque cambia lo que se va a
     liquidar de acá en adelante (regla 4). */
  async function alternarActivo(concepto) {
    if (concepto.activo && !(await confirmarDestructivo(t.pagos_asistentes.confirmar_baja))) return;
    setOcupadoId(concepto.id);
    setError(null);
    try {
      await llamarApiLiquidaciones(`/conceptos/${concepto.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo: !concepto.activo }),
      });
      await recargar();
    } catch (e) {
      setError(mensajeDeError(e, t, 'baja de concepto'));
    } finally {
      setOcupadoId(null);
    }
  }

  return (
    <div>
      <h2>{t.pagos_asistentes.conceptos_titulo}</h2>
      <p className="panel-explicacion">{t.pagos_asistentes.conceptos_explicacion}</p>
      {estado !== 'error' && error && <Alert variant="error">{error}</Alert>}

      <div className="panel-filtros">
        <Button onClick={() => setEditando({})}>{t.pagos_asistentes.conceptos_nuevo}</Button>
      </div>

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && conceptos.length === 0}
        recargar={recargar}
        mensajeVacio={t.pagos_asistentes.conceptos_vacio}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.pagos_asistentes.conceptos_col_nombre}</th>
              <th>{t.pagos_asistentes.col_signo}</th>
              <th>{t.pagos_asistentes.col_unidad}</th>
              <th>{t.pagos_asistentes.conceptos_col_valor}</th>
              <th>{t.pagos_asistentes.conceptos_col_alcance}</th>
              <th>{t.pagos_asistentes.conceptos_col_activo}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {conceptos.map((c) => (
              <tr key={c.id}>
                <td>{c.nombre}</td>
                <td>{traducirValor(t.pagos_asistentes, `signo_${c.signo}`)}</td>
                <td>{traducirValor(t.pagos_asistentes, `unidad_${c.unidad}`)}</td>
                <td>
                  {c.origen_valor === 'escala_legal'
                    ? `${t.pagos_asistentes.origen_escala_legal} · ${c.escala_tipo}`
                    : formatearValor(c.valor, c.unidad, c.moneda, locale)}
                </td>
                <td>{traducirValor(t.pagos_asistentes, `alcance_${c.aplica_a}`)}</td>
                <td>{c.activo ? t.comun.si : t.comun.no}</td>
                <td>
                  <Button variant="secondary" onClick={() => setEditando(c)} disabled={ocupadoId === c.id}>
                    {t.comun.editar}
                  </Button>{' '}
                  <Button variant="secondary" onClick={() => alternarActivo(c)} disabled={ocupadoId === c.id}>
                    {c.activo ? t.pagos_asistentes.dar_de_baja : t.pagos_asistentes.reactivar}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {editando && (
        <ConceptoModal
          concepto={editando}
          onCerrar={() => setEditando(null)}
          onGuardado={() => {
            setEditando(null);
            recargar();
          }}
        />
      )}
    </div>
  );
}

/**
 * El alta y la edición de un concepto.
 *
 * Los campos que se ven cambian con lo que se va eligiendo, y esa decisión no está escrita acá:
 * la toma `lib/conceptosLiquidacion.js`, que es la misma regla que tiene la base escrita como
 * restricción. La idea es que la combinación imposible —un porcentaje con moneda, una escala
 * legal con valor propio— no llegue a existir, en vez de que la rechacen después de completar
 * el formulario entero con un error que no dice cuál de los datos sobraba.
 */
function ConceptoModal({ concepto, onCerrar, onGuardado }) {
  const modal = useModalAccesible(onCerrar);
  const { t } = useLocale();
  const prestadoraId = usePrestadoraActual();
  const moneda = useMonedaActual();
  const { filas: escalas, estado: estadoEscalas } = useEscalasLegales(prestadoraId);

  const [datos, setDatos] = useState({
    nombre: concepto.nombre ?? '',
    signo: concepto.signo ?? 'suma',
    unidad: concepto.unidad ?? 'monto_fijo_mensual',
    origen_valor: concepto.origen_valor ?? 'propio',
    valor: concepto.valor ?? '',
    escala_tipo: concepto.escala_tipo ?? '',
    aplica_a: concepto.aplica_a ?? 'todos',
    orden: concepto.orden ?? 100,
  });
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  const cambiar = (campo, valor) => setDatos((previo) => ({ ...previo, [campo]: valor }));

  // La moneda no se elige: es la de la Prestadora, la misma en la que se liquida. Se muestra
  // igual, porque un valor sin moneda a la vista no se puede leer (regla 14).
  const paraGuardar = { ...datos, moneda };
  const campos = camposDelConcepto(datos);
  const falta = loQueFaltaDelConcepto(paraGuardar);

  // Un tipo de escala no se escribe a mano: se elige de las que CeltaTech tiene cargadas para
  // el país de la Prestadora. Escrito a mano, un error de tipeo hace un concepto que nunca va a
  // encontrar su escala y que se saltea en silencio todos los meses.
  const tiposDeEscala = useMemo(() => [...new Set(escalas.map((e) => e.tipo))].sort(), [escalas]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      const cuerpo = JSON.stringify(conceptoParaGuardar(paraGuardar));
      if (concepto.id) await llamarApiLiquidaciones(`/conceptos/${concepto.id}`, { method: 'PATCH', body: cuerpo });
      else await llamarApiLiquidaciones('/conceptos', { method: 'POST', body: cuerpo });
      onGuardado();
    } catch (e) {
      setError(mensajeDeError(e, t, 'guardar concepto'));
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onCerrar}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{concepto.id ? t.comun.editar : t.pagos_asistentes.conceptos_nuevo}</h2>
        {error && <Alert variant="error">{error}</Alert>}

        <FormField
          label={t.pagos_asistentes.concepto_nombre}
          name="concepto_nombre"
          value={datos.nombre}
          onChange={(e) => cambiar('nombre', e.target.value)}
          required
        />

        <FormField
          label={t.pagos_asistentes.col_signo}
          name="concepto_signo"
          type="select"
          value={datos.signo}
          onChange={(e) => cambiar('signo', e.target.value)}
        >
          {SIGNOS.map((signo) => (
            <option key={signo} value={signo}>
              {traducirValor(t.pagos_asistentes, `signo_${signo}`)}
            </option>
          ))}
        </FormField>

        <FormField
          label={t.pagos_asistentes.col_unidad}
          name="concepto_unidad"
          type="select"
          value={datos.unidad}
          onChange={(e) => cambiar('unidad', e.target.value)}
        >
          {UNIDADES.map((unidad) => (
            <option key={unidad} value={unidad}>
              {traducirValor(t.pagos_asistentes, `unidad_${unidad}`)}
            </option>
          ))}
        </FormField>

        <FormField
          label={t.pagos_asistentes.concepto_origen}
          name="concepto_origen"
          type="select"
          value={datos.origen_valor}
          onChange={(e) => cambiar('origen_valor', e.target.value)}
        >
          {ORIGENES.map((origen) => (
            <option key={origen} value={origen}>
              {traducirValor(t.pagos_asistentes, `origen_${origen}`)}
            </option>
          ))}
        </FormField>

        {campos.valor && (
          <FormField
            label={t.pagos_asistentes.concepto_valor}
            name="concepto_valor"
            type="number"
            step="0.0001"
            value={datos.valor}
            onChange={(e) => cambiar('valor', e.target.value)}
            required
          />
        )}

        {campos.moneda && (
          <FormField
            label={t.pagos_asistentes.concepto_moneda}
            name="concepto_moneda"
            value={moneda ?? ''}
            readOnly
            disabled
            ayuda={t.pagos_asistentes.concepto_moneda_ayuda}
          />
        )}

        {campos.escala_tipo && (
          <FormField
            label={t.pagos_asistentes.concepto_escala}
            name="concepto_escala"
            type="select"
            value={datos.escala_tipo}
            onChange={(e) => cambiar('escala_tipo', e.target.value)}
            required
            ayuda={
              estadoEscalas === 'listo' && tiposDeEscala.length === 0
                ? t.pagos_asistentes.concepto_sin_escalas
                : t.pagos_asistentes.concepto_escala_ayuda
            }
          >
            <option value="">{t.comun.seleccionar}</option>
            {tiposDeEscala.map((tipo) => (
              <option key={tipo} value={tipo}>
                {tipo}
              </option>
            ))}
          </FormField>
        )}

        <FormField
          label={t.pagos_asistentes.conceptos_col_alcance}
          name="concepto_alcance"
          type="select"
          value={datos.aplica_a}
          onChange={(e) => cambiar('aplica_a', e.target.value)}
        >
          {ALCANCES.map((alcance) => (
            <option key={alcance} value={alcance}>
              {traducirValor(t.pagos_asistentes, `alcance_${alcance}`)}
            </option>
          ))}
        </FormField>

        <FormField
          label={t.pagos_asistentes.concepto_orden}
          name="concepto_orden"
          type="number"
          value={datos.orden}
          onChange={(e) => cambiar('orden', e.target.value)}
          ayuda={t.pagos_asistentes.concepto_orden_ayuda}
        />

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onCerrar} disabled={guardando}>
            {t.comun.cancelar}
          </Button>
          <Button onClick={guardar} disabled={guardando || falta.length > 0}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}
