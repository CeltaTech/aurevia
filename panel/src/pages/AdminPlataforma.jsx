import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { supabase } from '../lib/supabaseClient';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { EstadoLista } from '../components/layout/EstadoLista';
import { useConfirmarDestructivo } from '../context/TenantSessionContext';
import { traducirValor } from '../i18n/valores';

const API_URL = import.meta.env.VITE_API_URL;

async function llamarApi(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/admin-plataforma${path}`, {
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

const TABS = ['resumen', 'licenciatarias', 'planes', 'facturacion'];

export function AdminPlataforma() {
  const { t } = useLocale();
  const [tab, setTab] = useState('resumen');

  return (
    <div>
      <h1>{t.adminPlataforma.titulo}</h1>
      <p className="panel-explicacion">{t.adminPlataforma.explicacion}</p>

      <div className="panel-tabs">
        {TABS.map((tabId) => (
          <button
            key={tabId}
            className={`panel-tab ${tab === tabId ? 'panel-tab-activo' : ''}`}
            onClick={() => setTab(tabId)}
          >
            {t.adminPlataforma[`tab_${tabId}`]}
          </button>
        ))}
      </div>

      <div className="panel-tab-contenido">
        {tab === 'resumen' && <TabResumen />}
        {tab === 'licenciatarias' && <TabLicenciatarias />}
        {tab === 'planes' && <TabPlanes />}
        {tab === 'facturacion' && <TabFacturacion />}
      </div>
    </div>
  );
}

function TabResumen() {
  const { t } = useLocale();
  const [datos, setDatos] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const resultado = await llamarApi('/resumen');
      setDatos(resultado);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return (
    <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
      {datos && (
        <div className="panel-kpis">
          <div className="panel-kpi-card">
            <div className="panel-kpi-valor">${datos.mrrTotal.toLocaleString('es-AR')}</div>
            <div className="panel-kpi-etiqueta">{t.adminPlataforma.kpi_mrr}</div>
          </div>
          <div className="panel-kpi-card">
            <div className="panel-kpi-valor">{datos.prestadorasActivas}</div>
            <div className="panel-kpi-etiqueta">{t.adminPlataforma.kpi_activas}</div>
          </div>
          <div className="panel-kpi-card">
            <div className="panel-kpi-valor">{datos.nuevasEsteMes}</div>
            <div className="panel-kpi-etiqueta">{t.adminPlataforma.kpi_nuevas_mes}</div>
          </div>
          <div className="panel-kpi-card">
            <div className="panel-kpi-valor">{datos.addonsContratados}</div>
            <div className="panel-kpi-etiqueta">{t.adminPlataforma.kpi_addons}</div>
          </div>
        </div>
      )}
    </EstadoLista>
  );
}

function TabLicenciatarias() {
  const { t } = useLocale();
  const [tenants, setTenants] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [tenantAbierto, setTenantAbierto] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { tenants: filas } = await llamarApi('/tenants');
      setTenants(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return (
    <>
      {error && <Alert variant="error">{error}</Alert>}
      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && tenants.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.adminPlataforma.col_nombre}</th>
              <th>{t.adminPlataforma.col_pais}</th>
              <th>{t.adminPlataforma.col_estado}</th>
              <th>{t.adminPlataforma.col_plan}</th>
              <th>{t.adminPlataforma.col_estado_pago}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant) => (
              <tr key={tenant.id}>
                <td>{tenant.nombre_fantasia}</td>
                <td>{tenant.pais}</td>
                <td>
                  <span className={`badge badge-${tenant.estado}`}>
                    {traducirValor(t.adminPlataforma, `estado_${tenant.estado}`)}
                  </span>
                </td>
                <td>{tenant.plan?.nombre ?? t.adminPlataforma.sin_plan}</td>
                <td>
                  <span className={`badge badge-${tenant.estadoPago}`}>
                    {t.adminPlataforma[`estado_pago_${tenant.estadoPago}`]}
                  </span>
                </td>
                <td>
                  <Button variant="secondary" onClick={() => setTenantAbierto(tenant)}>
                    {t.adminPlataforma.ver_modulos}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {tenantAbierto && (
        <TenantDetalleModal
          tenant={tenantAbierto}
          onClose={() => setTenantAbierto(null)}
          onCambiado={recargar}
        />
      )}
    </>
  );
}

function TenantDetalleModal({ tenant, onClose, onCambiado }) {
  const { t } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();
  const [modulos, setModulos] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [cambiando, setCambiando] = useState(null);

  const [planes, setPlanes] = useState([]);
  const [planSeleccionado, setPlanSeleccionado] = useState('');
  const [preview, setPreview] = useState(null);
  const [cargandoPreview, setCargandoPreview] = useState(false);
  const [aplicandoPlan, setAplicandoPlan] = useState(false);
  const [errorPlan, setErrorPlan] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { modulos: filas } = await llamarApi(`/tenants/${tenant.id}/modulos`);
      setModulos(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, [tenant.id]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  useEffect(() => {
    llamarApi('/planes')
      .then(({ planes: filas }) => setPlanes(filas))
      .catch(() => setPlanes([]));
  }, []);

  async function handleToggle(modulo) {
    setCambiando(modulo.key);
    setError(null);
    try {
      await llamarApi(`/tenants/${tenant.id}/modulos/${modulo.key}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo: !modulo.activo }),
      });
      await recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setCambiando(null);
    }
  }

  async function handleVerCambios() {
    if (!planSeleccionado) return;
    setCargandoPreview(true);
    setErrorPlan(null);
    setPreview(null);
    try {
      const resultado = await llamarApi(`/tenants/${tenant.id}/plan-preview/${planSeleccionado}`);
      setPreview(resultado);
    } catch (err) {
      setErrorPlan(err.message);
    } finally {
      setCargandoPreview(false);
    }
  }

  async function handleConfirmarPlan() {
    if (!(await confirmarDestructivo(t.adminPlataforma.cambiar_plan_confirmar))) return;
    setAplicandoPlan(true);
    setErrorPlan(null);
    try {
      await llamarApi(`/tenants/${tenant.id}/plan`, {
        method: 'PATCH',
        body: JSON.stringify({ planId: planSeleccionado }),
      });
      setPreview(null);
      setPlanSeleccionado('');
      await recargar();
      await onCambiado();
    } catch (err) {
      setErrorPlan(err.message);
    } finally {
      setAplicandoPlan(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.adminPlataforma.detalle_titulo.replace('{prestadora}', tenant.nombre_fantasia)}</h2>

        {tenant.riesgo && <Alert variant="error">{t.adminPlataforma.riesgo_alerta}</Alert>}

        <h3>{t.adminPlataforma.uso_titulo}</h3>
        <div className="panel-kpis">
          <div className="panel-kpi-card">
            <div className="panel-kpi-valor">{tenant.uso.asistentes}</div>
            <div className="panel-kpi-etiqueta">{t.adminPlataforma.uso_asistentes}</div>
          </div>
          <div className="panel-kpi-card">
            <div className="panel-kpi-valor">{tenant.uso.pacientes}</div>
            <div className="panel-kpi-etiqueta">{t.adminPlataforma.uso_pacientes}</div>
          </div>
          <div className="panel-kpi-card">
            <div className="panel-kpi-valor">{tenant.uso.usuariosPanel}</div>
            <div className="panel-kpi-etiqueta">{t.adminPlataforma.uso_usuarios_panel}</div>
          </div>
        </div>

        <h3>{t.adminPlataforma.modulos_seccion_titulo}</h3>
        <p className="panel-explicacion">{t.adminPlataforma.modulos_explicacion}</p>

        {error && <Alert variant="error">{error}</Alert>}

        <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
          <div className="panel-modulos-lista">
            {modulos.map((modulo) => (
              <div className="panel-modulo-fila" key={modulo.key}>
                <div className="panel-modulo-fila-info">
                  <strong>{modulo.nombre}</strong>
                  {modulo.origen && (
                    <span className="panel-modulo-fila-origen">
                      {modulo.origen === 'plan' ? t.adminPlataforma.origen_plan : t.adminPlataforma.origen_addon}
                    </span>
                  )}
                </div>
                <Button
                  variant={modulo.activo ? 'primary' : 'secondary'}
                  onClick={() => handleToggle(modulo)}
                  disabled={cambiando === modulo.key}
                >
                  {modulo.activo ? t.comun.si : t.comun.no}
                </Button>
              </div>
            ))}
          </div>
        </EstadoLista>

        <h3>{t.adminPlataforma.cambiar_plan_titulo}</h3>
        <p className="panel-explicacion">{t.adminPlataforma.cambiar_plan_explicacion}</p>

        {errorPlan && <Alert variant="error">{errorPlan}</Alert>}

        <div className="panel-form-fila">
          <select
            value={planSeleccionado}
            onChange={(e) => {
              setPlanSeleccionado(e.target.value);
              setPreview(null);
            }}
          >
            <option value="">{t.adminPlataforma.cambiar_plan_seleccionar}</option>
            {planes.map((plan) => (
              <option key={plan.id} value={plan.id}>
                {plan.nombre}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            onClick={handleVerCambios}
            disabled={!planSeleccionado || cargandoPreview}
          >
            {t.adminPlataforma.cambiar_plan_ver_cambios}
          </Button>
        </div>

        {preview && (
          <div className="panel-plan-preview">
            {preview.ganadas.length === 0 && preview.perdidas.length === 0 ? (
              <p>{t.adminPlataforma.cambiar_plan_sin_cambios}</p>
            ) : (
              <>
                {preview.ganadas.length > 0 && (
                  <p>
                    <strong>{t.adminPlataforma.cambiar_plan_ganadas}:</strong> {preview.ganadas.join(', ')}
                  </p>
                )}
                {preview.perdidas.length > 0 && (
                  <p>
                    <strong>{t.adminPlataforma.cambiar_plan_perdidas}:</strong> {preview.perdidas.join(', ')}
                  </p>
                )}
              </>
            )}
            <Button variant="primary" onClick={handleConfirmarPlan} disabled={aplicandoPlan}>
              {t.adminPlataforma.cambiar_plan_confirmar}
            </Button>
          </div>
        )}

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose}>
            {t.comun.cerrar}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabPlanes() {
  const { t } = useLocale();
  const [planes, setPlanes] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { planes: filas } = await llamarApi('/planes');
      setPlanes(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return (
    <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && planes.length === 0} recargar={recargar}>
      <table className="panel-tabla">
        <thead>
          <tr>
            <th>{t.adminPlataforma.col_plan_nombre}</th>
            <th>{t.adminPlataforma.col_plan_precio}</th>
            <th>{t.adminPlataforma.col_plan_modulos}</th>
          </tr>
        </thead>
        <tbody>
          {planes.map((plan) => (
            <tr key={plan.id}>
              <td>{plan.nombre}</td>
              <td>{plan.moneda} {Number(plan.precio).toLocaleString('es-AR')}</td>
              <td>{plan.modulos.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </EstadoLista>
  );
}

function TabFacturacion() {
  const { t } = useLocale();
  const [facturas, setFacturas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { facturas: filas } = await llamarApi('/facturas');
      setFacturas(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return (
    <>
      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && facturas.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.adminPlataforma.col_factura_prestadora}</th>
              <th>{t.adminPlataforma.col_factura_concepto}</th>
              <th>{t.adminPlataforma.col_factura_monto}</th>
              <th>{t.adminPlataforma.col_factura_estado}</th>
              <th>{t.adminPlataforma.col_factura_emision}</th>
              <th>{t.adminPlataforma.col_factura_vencimiento}</th>
            </tr>
          </thead>
          <tbody>
            {facturas.map((factura) => (
              <tr key={factura.id}>
                <td>{factura.prestadoras?.nombre_fantasia}</td>
                <td>{factura.concepto}</td>
                <td>{factura.moneda} {Number(factura.monto).toLocaleString('es-AR')}</td>
                <td>
                  <span className={`badge badge-${factura.estado}`}>
                    {t.adminPlataforma[`factura_estado_${factura.estado}`]}
                  </span>
                </td>
                <td>{factura.fecha_emision}</td>
                <td>{factura.fecha_vencimiento ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      <CambiosPrecioIASeccion />
      <UsoIASeccion />
    </>
  );
}

// Pendiente #84 (docs/PENDIENTES.md): cambios de precio de IA detectados por la rutina
// mensual (verificarPreciosIA.js) — nunca se aplican solos, quedan acá esperando
// confirmación explícita (CLAUDE.md §6).
function CambiosPrecioIASeccion() {
  const { t } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();
  const [cambios, setCambios] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [resolviendo, setResolviendo] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { cambios: filas } = await llamarApi('/cambios-precio-ia');
      setCambios(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function handleConfirmar(cambio) {
    if (!(await confirmarDestructivo(t.adminPlataforma.uso_ia_precio_confirmar))) return;
    setResolviendo(cambio.id);
    try {
      await llamarApi(`/cambios-precio-ia/${cambio.id}/confirmar`, { method: 'POST' });
      await recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setResolviendo(null);
    }
  }

  async function handleDescartar(cambio) {
    setResolviendo(cambio.id);
    try {
      await llamarApi(`/cambios-precio-ia/${cambio.id}/descartar`, { method: 'POST' });
      await recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setResolviendo(null);
    }
  }

  if (estado === 'listo' && cambios.length === 0) return null;

  return (
    <div className="dashboard-seccion">
      <div className="dashboard-seccion-header">
        <h2 className="dashboard-seccion-titulo">{t.adminPlataforma.uso_ia_precios_pendientes_titulo}</h2>
        <p className="dashboard-seccion-subtitulo">{t.adminPlataforma.uso_ia_precios_pendientes_subtitulo}</p>
      </div>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        {error && <Alert variant="error">{error}</Alert>}
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.adminPlataforma.col_precio_ia_proveedor}</th>
              <th>{t.adminPlataforma.col_precio_ia_modelo}</th>
              <th>{t.adminPlataforma.col_precio_ia_actual}</th>
              <th>{t.adminPlataforma.col_precio_ia_detectado}</th>
              <th>{t.adminPlataforma.col_precio_ia_acciones}</th>
            </tr>
          </thead>
          <tbody>
            {cambios.map((cambio) => (
              <tr key={cambio.id}>
                <td>{cambio.proveedor}</td>
                <td>{cambio.modelo}</td>
                <td>${cambio.precio_entrada_actual} / ${cambio.precio_salida_actual}</td>
                <td>${cambio.precio_entrada_detectado} / ${cambio.precio_salida_detectado}</td>
                <td>
                  <Button onClick={() => handleConfirmar(cambio)} disabled={resolviendo === cambio.id}>
                    {t.adminPlataforma.uso_ia_precio_confirmar_boton}
                  </Button>{' '}
                  <Button variant="secondary" onClick={() => handleDescartar(cambio)} disabled={resolviendo === cambio.id}>
                    {t.adminPlataforma.uso_ia_precio_descartar_boton}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>
    </div>
  );
}

// Pendiente #84: resumen de costo real de IA por Prestadora — nunca visible en el panel
// de la propia Prestadora (CLAUDE.md §2), solo acá.
function UsoIASeccion() {
  const { t } = useLocale();
  const [resumen, setResumen] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { resumen: filas } = await llamarApi('/uso-ia');
      setResumen(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return (
    <div className="dashboard-seccion">
      <div className="dashboard-seccion-header">
        <h2 className="dashboard-seccion-titulo">{t.adminPlataforma.uso_ia_titulo}</h2>
        <p className="dashboard-seccion-subtitulo">{t.adminPlataforma.uso_ia_subtitulo}</p>
      </div>
      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && resumen.length === 0}
        recargar={recargar}
        mensajeVacio={t.adminPlataforma.uso_ia_vacio}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.adminPlataforma.col_uso_ia_prestadora}</th>
              <th>{t.adminPlataforma.col_uso_ia_llamadas}</th>
              <th>{t.adminPlataforma.col_uso_ia_costo}</th>
            </tr>
          </thead>
          <tbody>
            {resumen.map((fila) => (
              <tr key={fila.prestadoraId}>
                <td>{fila.nombre}</td>
                <td>{fila.llamadas}</td>
                <td>USD {fila.costoTotalUsd.toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>
    </div>
  );
}
