import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { supabase } from '../lib/supabaseClient';
import { Button } from '../components/ui/Button';
import { Alert } from '../components/ui/Alert';
import { EstadoLista } from '../components/layout/EstadoLista';
import { useConfirmarDestructivo } from '../context/TenantSessionContext';
import { mensajeDeError } from '../lib/errores';

// Etapa 2 de la separación CeltaTech / Careonys (2026-07-28, docs/ETAPA_2_INVENTARIO.md §5):
// estas dos secciones venían adentro de AdminPlataforma.jsx, el panel comercial del SaaS.
// Ese panel se fue entero: planes, licenciatarias y facturación son de CeltaTech, no de este
// producto. El costo de IA se queda porque no es comercial — mide un costo de infraestructura
// y vigila que el precio oficial del proveedor no cambie sin aviso. Es mantenimiento técnico
// de la plataforma, o sea superadmin (CLAUDE.md §5).
const API_URL = import.meta.env.VITE_API_URL;

async function llamarApi(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/costos-ia${path}`, {
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

export function CostosIA() {
  const { t } = useLocale();

  return (
    <div>
      <h1>{t.costosIA.titulo}</h1>
      <p className="panel-explicacion">{t.costosIA.explicacion}</p>

      <CambiosPrecioIASeccion />
      <UsoIASeccion />
    </div>
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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function handleConfirmar(cambio) {
    if (!(await confirmarDestructivo(t.costosIA.uso_ia_precio_confirmar))) return;
    setResolviendo(cambio.id);
    try {
      await llamarApi(`/cambios-precio-ia/${cambio.id}/confirmar`, { method: 'POST' });
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
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
      setError(mensajeDeError(err, t));
    } finally {
      setResolviendo(null);
    }
  }

  if (estado === 'listo' && cambios.length === 0) return null;

  return (
    <div className="dashboard-seccion">
      <div className="dashboard-seccion-header">
        <h2 className="dashboard-seccion-titulo">{t.costosIA.uso_ia_precios_pendientes_titulo}</h2>
        <p className="dashboard-seccion-subtitulo">{t.costosIA.uso_ia_precios_pendientes_subtitulo}</p>
      </div>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        {error && <Alert variant="error">{error}</Alert>}
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.costosIA.col_precio_ia_proveedor}</th>
              <th>{t.costosIA.col_precio_ia_modelo}</th>
              <th>{t.costosIA.col_precio_ia_actual}</th>
              <th>{t.costosIA.col_precio_ia_detectado}</th>
              <th>{t.costosIA.col_precio_ia_acciones}</th>
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
                    {t.costosIA.uso_ia_precio_confirmar_boton}
                  </Button>{' '}
                  <Button variant="secondary" onClick={() => handleDescartar(cambio)} disabled={resolviendo === cambio.id}>
                    {t.costosIA.uso_ia_precio_descartar_boton}
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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return (
    <div className="dashboard-seccion">
      <div className="dashboard-seccion-header">
        <h2 className="dashboard-seccion-titulo">{t.costosIA.uso_ia_titulo}</h2>
        <p className="dashboard-seccion-subtitulo">{t.costosIA.uso_ia_subtitulo}</p>
      </div>
      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && resumen.length === 0}
        recargar={recargar}
        mensajeVacio={t.costosIA.uso_ia_vacio}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.costosIA.col_uso_ia_prestadora}</th>
              <th>{t.costosIA.col_uso_ia_llamadas}</th>
              <th>{t.costosIA.col_uso_ia_costo}</th>
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
