import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { useConfirmarDestructivo } from '../context/TenantSessionContext';
import { supabase } from '../lib/supabaseClient';
import { claseBadge } from '../lib/tonos';
import { useFiltros } from '../hooks/useFiltros';
import { EstadoLista } from '../components/layout/EstadoLista';
import { Button } from '../components/ui/Button';
import { mensajeDeError } from '../lib/errores';

// Alertas de la IA Nivel 2 (backend/src/utils/revisarAlertasIA.js): la IA lee los últimos
// reportes de cada Paciente y, si detecta un patrón preocupante, deja una alerta con dos
// textos — uno para la Familia (descripcion) y otro para el Coordinador
// (detalle_coordinador). Hasta esta pantalla el segundo no lo leía nadie: el aviso de
// WhatsApp decía "ver detalle en el Panel" y el Panel no tenía dónde mostrarlo.

// Rojo primero, después amarillo: la lista se ordena por gravedad, no solo por fecha.
const ORDEN_NIVEL = { roja: 0, amarilla: 1, verde: 2 };

// Cada nivel se pinta por lo que significa, no por su color de origen.

export function Alertas() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const confirmarDestructivo = useConfirmarDestructivo();
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const { f, set, limpiar, hayFiltros } = useFiltros({ estado: 'pendientes', nivel: 'todos' });
  const [abierta, setAbierta] = useState(null);
  const [resolviendoId, setResolviendoId] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);

    const { data, error: errorConsulta } = await supabase
      .from('alertas')
      .select(
        'id, created_at, nivel, descripcion, detalle_coordinador, campos_preocupantes, reportes_relacionados, resuelta, resuelta_at, paciente_id, pacientes(nombre)',
      )
      .order('created_at', { ascending: false });

    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }

    setFilas(
      (data ?? []).map((a) => ({
        ...a,
        paciente_nombre: a.pacientes?.nombre || '—',
      })),
    );
    setEstado('listo');
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function resolver(alerta) {
    if (!(await confirmarDestructivo(t.alertas.confirmar_resolver))) return;
    setResolviendoId(alerta.id);
    try {
      const { error: errorUpdate } = await supabase
        .from('alertas')
        .update({ resuelta: true, resuelta_por: usuario.id, resuelta_at: new Date().toISOString() })
        .eq('id', alerta.id);
      if (errorUpdate) throw errorUpdate;
      setAbierta(null);
      recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setResolviendoId(null);
    }
  }

  const filasFiltradas = useMemo(() => {
    return filas
      .filter((a) => {
        if (f.estado === 'pendientes' && a.resuelta) return false;
        if (f.estado === 'resueltas' && !a.resuelta) return false;
        if (f.nivel !== 'todos' && a.nivel !== f.nivel) return false;
        return true;
      })
      .sort((a, b) => {
        const porNivel = (ORDEN_NIVEL[a.nivel] ?? 9) - (ORDEN_NIVEL[b.nivel] ?? 9);
        if (porNivel !== 0) return porNivel;
        return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      });
  }, [filas, f]);

  const pendientesRojas = useMemo(
    () => filas.filter((a) => !a.resuelta && a.nivel === 'roja').length,
    [filas],
  );

  return (
    <div>
      <h1>{t.alertas.titulo}</h1>
      <p className="panel-explicacion">{t.alertas.explicacion}</p>

      {pendientesRojas > 0 && (
        <p className="panel-explicacion">
          <span className="badge badge-critico">
            {t.alertas.resumen_rojas.replace('{cantidad}', pendientesRojas)}
          </span>
        </p>
      )}

      <div className="panel-filtros">
        <select value={f.estado} onChange={(e) => set('estado', e.target.value)}>
          <option value="pendientes">{t.alertas.filtro_pendientes}</option>
          <option value="resueltas">{t.alertas.filtro_resueltas}</option>
          <option value="todas">{t.comun.todos}</option>
        </select>
        <select value={f.nivel} onChange={(e) => set('nivel', e.target.value)}>
          <option value="todos">{t.alertas.filtro_todos_los_niveles}</option>
          <option value="roja">{t.alertas.nivel_roja}</option>
          <option value="amarilla">{t.alertas.nivel_amarilla}</option>
        </select>
      </div>

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && filasFiltradas.length === 0}
        recargar={recargar}
        filtrado={hayFiltros}
        onLimpiarFiltros={limpiar}
        mensajeVacio={t.alertas.vacio}
      >
        <>
          <table className="panel-tabla">
            <thead>
              <tr>
                <th>{t.alertas.col_fecha}</th>
                <th>{t.alertas.col_paciente}</th>
                <th>{t.alertas.col_nivel}</th>
                <th>{t.alertas.col_descripcion}</th>
                <th>{t.alertas.col_estado}</th>
                <th>{t.alertas.col_detalle}</th>
              </tr>
            </thead>
            <tbody>
              {filasFiltradas.map((a) => (
                <tr key={a.id}>
                  <td>{a.created_at?.slice(0, 10)}</td>
                  <td>{a.paciente_nombre}</td>
                  <td>
                    <span className={claseBadge(a.nivel)}>
                      {t.alertas[`nivel_${a.nivel}`] ?? a.nivel}
                    </span>
                  </td>
                  <td>{a.descripcion || '—'}</td>
                  <td>{a.resuelta ? t.alertas.estado_resuelta : t.alertas.estado_pendiente}</td>
                  <td>
                    <Button variant="secondary" onClick={() => setAbierta(abierta === a.id ? null : a.id)}>
                      {abierta === a.id ? t.alertas.ocultar_detalle : t.alertas.ver_detalle}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {abierta && (
            <DetalleAlerta
              alerta={filasFiltradas.find((a) => a.id === abierta)}
              resolviendo={resolviendoId === abierta}
              onResolver={resolver}
              onCerrar={() => setAbierta(null)}
            />
          )}
        </>
      </EstadoLista>
    </div>
  );
}

function DetalleAlerta({ alerta, resolviendo, onResolver, onCerrar }) {
  const { t } = useLocale();
  if (!alerta) return null;

  const cantidadReportes = alerta.reportes_relacionados?.length ?? 0;

  return (
    <section className="panel-detalle">
      <div className="panel-detalle-encabezado">
        <h2>{t.alertas.detalle_titulo}</h2>
        <Button variant="secondary" onClick={onCerrar}>
          {t.comun.cerrar}
        </Button>
      </div>
      <p className="panel-explicacion">
        {alerta.created_at?.slice(0, 10)} · {alerta.paciente_nombre}
      </p>

      <div className="reporte-preview-campo">
        <label>{t.alertas.campo_detalle_coordinador}</label>
        <div>{alerta.detalle_coordinador || t.alertas.sin_datos}</div>
      </div>

      <div className="reporte-preview-campo">
        <label>{t.alertas.campo_descripcion_familia}</label>
        <div>{alerta.descripcion || t.alertas.sin_datos}</div>
      </div>

      <div className="reporte-preview-campo">
        <label>{t.alertas.campo_campos_preocupantes}</label>
        {alerta.campos_preocupantes?.length > 0 ? (
          <div>{alerta.campos_preocupantes.join(' · ')}</div>
        ) : (
          <div>{t.alertas.sin_datos}</div>
        )}
      </div>

      <div className="reporte-preview-campo">
        <label>{t.alertas.campo_reportes_analizados}</label>
        <div>{t.alertas.reportes_analizados_texto.replace('{cantidad}', cantidadReportes)}</div>
      </div>

      {!alerta.resuelta && (
        <div className="panel-modal-acciones">
          <Button onClick={() => onResolver(alerta)} disabled={resolviendo}>
            {t.alertas.marcar_resuelta}
          </Button>
        </div>
      )}
    </section>
  );
}
