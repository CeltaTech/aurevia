import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { claseBadge } from '../lib/tonos';
import { useFiltros } from '../hooks/useFiltros';
import { EstadoLista } from '../components/layout/EstadoLista';
import { mensajeDeError } from '../lib/errores';

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function diasHasta(fechaISO) {
  const hoy = new Date(`${hoyISO()}T00:00:00`);
  const fecha = new Date(`${fechaISO}T00:00:00`);
  return Math.round((fecha.getTime() - hoy.getTime()) / 86400000);
}

function estadoDocumento(fechaVencimiento, diasAviso) {
  const dias = diasHasta(fechaVencimiento);
  if (dias < 0) return 'vencido';
  if (dias <= diasAviso) return 'por_vencer';
  return 'vigente';
}

export function Documentacion() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const [filas, setFilas] = useState([]);
  // No es un filtro de la lista: lo trae el servidor (configuración de la Prestadora) y sirve
  // para calcular el estado de cada documento, no para elegir qué se muestra.
  const [diasAviso, setDiasAviso] = useState(30);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  // La pantalla abre ya filtrada a lo vencido o por vencer: ese es el valor de arranque y el
  // punto de comparación, así que dejarlo así no cuenta como filtro puesto.
  const { f, set, limpiar, hayFiltros } = useFiltros({ filtro: 'vencido_o_por_vencer' });

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);

    const [{ data: docsData, error: errorDocs }, { data: prestadoraData }] = await Promise.all([
      supabase
        .from('documentos_asistente')
        .select('id, fecha_vencimiento, tipos_documento_asistente(nombre, requiere_vencimiento), asistentes(nombre, estado)')
        .not('fecha_vencimiento', 'is', null),
      supabase.from('prestadoras').select('dias_aviso_vencimiento_documentos').eq('id', usuario.prestadora_id).single(),
    ]);

    if (errorDocs) {
      setError(mensajeDeError(errorDocs, t));
      setEstado('error');
      return;
    }

    const aviso = prestadoraData?.dias_aviso_vencimiento_documentos ?? 30;
    setDiasAviso(aviso);

    const filasConEstado = (docsData ?? [])
      .filter((d) => d.tipos_documento_asistente?.requiere_vencimiento && d.asistentes?.estado === 'activo')
      .map((d) => ({
        id: d.id,
        asistente_nombre: d.asistentes?.nombre || '—',
        tipo_nombre: d.tipos_documento_asistente?.nombre || '—',
        fecha_vencimiento: d.fecha_vencimiento,
        dias: diasHasta(d.fecha_vencimiento),
        estado_documento: estadoDocumento(d.fecha_vencimiento, aviso),
      }))
      .sort((a, b) => a.dias - b.dias);

    setFilas(filasConEstado);
    setEstado('listo');
  }, [usuario.prestadora_id, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const filasFiltradas = useMemo(() => {
    if (f.filtro === 'todos') return filas;
    if (f.filtro === 'vencido_o_por_vencer') return filas.filter((d) => d.estado_documento !== 'vigente');
    return filas.filter((d) => d.estado_documento === f.filtro);
  }, [filas, f]);

  return (
    <div>
      <h1>{t.documentacion.titulo}</h1>
      <p className="panel-explicacion">{t.documentacion.explicacion}</p>

      <div className="panel-filtros">
        <select value={f.filtro} onChange={(e) => set('filtro', e.target.value)}>
          <option value="vencido_o_por_vencer">{t.documentacion.filtro_vencido_o_por_vencer}</option>
          <option value="vencido">{t.documentacion.estado_vencido}</option>
          <option value="por_vencer">{t.documentacion.estado_por_vencer}</option>
          <option value="todos">{t.comun.todos}</option>
        </select>
      </div>

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && filasFiltradas.length === 0}
        recargar={recargar}
        filtrado={hayFiltros}
        onLimpiarFiltros={limpiar}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.documentacion.col_asistente}</th>
              <th>{t.documentacion.col_documento}</th>
              <th>{t.documentacion.col_vencimiento}</th>
              <th>{t.documentacion.col_estado}</th>
            </tr>
          </thead>
          <tbody>
            {filasFiltradas.map((d) => (
              <tr key={d.id}>
                <td>{d.asistente_nombre}</td>
                <td>{d.tipo_nombre}</td>
                <td>{d.fecha_vencimiento}</td>
                <td><span className={claseBadge(d.estado_documento)}>{t.documentacion[`estado_${d.estado_documento}`]}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>
    </div>
  );
}
