import { useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useSupabaseTable } from '../hooks/useSupabaseTable';
import { usePrestadoraActual } from '../hooks/usePrestadoraActual';
import { useFiltros } from '../hooks/useFiltros';
import { useZonasCobertura } from '../hooks/useZonasCobertura';
import { EstadoLista } from '../components/layout/EstadoLista';
import { PostulacionDetalle } from './PostulacionDetalle';
import { contieneCodigo, traducirCodigos } from '../lib/postulacionCodigos';
import { claseBadge } from '../lib/tonos';

const ESTADOS = ['pendiente', 'en_revision', 'aprobado', 'rechazado'];

export function Postulaciones() {
  const { t } = useLocale();
  const prestadoraId = usePrestadoraActual();
  const { filas, estado, error, recargar } = useSupabaseTable('postulaciones');
  const { filas: zonas } = useZonasCobertura(prestadoraId);
  const zonasLabels = useMemo(
    () => Object.fromEntries(zonas.map((z) => [z.codigo, z.nombre])),
    [zonas],
  );
  const { f, set, limpiar, hayFiltros } = useFiltros({ busqueda: '', estado: '', especialidad: '', zona: '', disponibilidad: '' });
  const [seleccionada, setSeleccionada] = useState(null);

  const filasFiltradas = useMemo(() => {
    return filas.filter((p) => {
      const coincideBusqueda =
        !f.busqueda ||
        p.nombre?.toLowerCase().includes(f.busqueda.toLowerCase()) ||
        p.email?.toLowerCase().includes(f.busqueda.toLowerCase()) ||
        p.telefono?.toLowerCase().includes(f.busqueda.toLowerCase());
      const coincideEstado = !f.estado || p.estado === f.estado;
      return (
        coincideBusqueda &&
        coincideEstado &&
        contieneCodigo(p.especialidades, f.especialidad) &&
        contieneCodigo(p.zonas, f.zona) &&
        contieneCodigo(p.disponibilidad, f.disponibilidad)
      );
    });
  }, [filas, f]);

  return (
    <div>
      <h1>{t.postulaciones.titulo}</h1>

      <div className="panel-filtros">
        <input
          type="text"
          placeholder={t.comun.buscar}
          aria-label={t.comun.buscar}
          value={f.busqueda}
          onChange={(e) => set('busqueda', e.target.value)}
        />
        <select value={f.estado} onChange={(e) => set('estado', e.target.value)} aria-label={t.comun.filtro_estado}>
          <option value="">{t.comun.todos}</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>
              {t.postulaciones[`estado_${e}`]}
            </option>
          ))}
        </select>
        <select value={f.especialidad} onChange={(e) => set('especialidad', e.target.value)} aria-label={t.postulaciones.filtro_especialidad}>
          <option value="">{t.postulaciones.filtro_especialidad}</option>
          {Object.entries(t.postulaciones.especialidades_labels).map(([codigo, label]) => (
            <option key={codigo} value={codigo}>{label}</option>
          ))}
        </select>
        <select value={f.zona} onChange={(e) => set('zona', e.target.value)} aria-label={t.postulaciones.filtro_zona}>
          <option value="">{t.postulaciones.filtro_zona}</option>
          {zonas.map((z) => (
            <option key={z.codigo} value={z.codigo}>{z.nombre}</option>
          ))}
        </select>
        <select value={f.disponibilidad} onChange={(e) => set('disponibilidad', e.target.value)} aria-label={t.postulaciones.filtro_disponibilidad}>
          <option value="">{t.postulaciones.filtro_disponibilidad}</option>
          {Object.entries(t.postulaciones.disponibilidad_labels).map(([codigo, label]) => (
            <option key={codigo} value={codigo}>{label}</option>
          ))}
        </select>
      </div>

      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && filasFiltradas.length === 0} recargar={recargar} filtrado={hayFiltros} onLimpiarFiltros={limpiar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.postulaciones.col_nombre}</th>
              <th>{t.postulaciones.col_especialidades}</th>
              <th>{t.postulaciones.col_zonas}</th>
              <th>{t.postulaciones.col_fecha}</th>
              <th>{t.postulaciones.col_situacion_fiscal}</th>
              <th>{t.postulaciones.col_estado}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filasFiltradas.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td>{traducirCodigos(p.especialidades, t.postulaciones.especialidades_labels)}</td>
                <td>{traducirCodigos(p.zonas, zonasLabels)}</td>
                <td>{new Date(p.creado_en).toLocaleDateString()}</td>
                <td>{t.postulaciones.situacion_fiscal_labels[p.situacion_fiscal] ?? p.situacion_fiscal}</td>
                <td>
                  <span className={claseBadge(p.estado)}>{t.postulaciones[`estado_${p.estado}`]}</span>
                </td>
                <td>
                  <button onClick={() => setSeleccionada(p)}>{t.comun.ver_detalle}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {seleccionada && (
        <PostulacionDetalle
          postulacion={seleccionada}
          onClose={() => setSeleccionada(null)}
          onActualizada={() => {
            setSeleccionada(null);
            recargar();
          }}
        />
      )}
    </div>
  );
}
