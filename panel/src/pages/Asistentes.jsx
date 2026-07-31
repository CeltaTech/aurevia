import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { usePermisos } from '../context/PermisosContext';
import { esAdminOSuperior } from '../lib/roles';
import { claseBadge } from '../lib/tonos';
import { useSupabaseTable } from '../hooks/useSupabaseTable';
import { useFiltros } from '../hooks/useFiltros';
import { EstadoLista } from '../components/layout/EstadoLista';
import { Button } from '../components/ui/Button';
import { NuevoAsistenteModal } from './asistentes/NuevoAsistenteModal';

const ESTADOS = ['activo', 'inactivo', 'cesado'];

export function Asistentes() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const esAdmin = esAdminOSuperior(usuario?.rol);
  const { puede } = usePermisos();
  const puedeAltaManual = esAdmin || puede('alta_manual_asistente');
  // Coordinador consulta la vista sin vínculo laboral/score de riesgo — ver schema_etapa2i.sql.
  const { filas, estado, error, recargar } = useSupabaseTable(esAdmin ? 'asistentes' : 'asistentes_coordinador', { orderBy: 'created_at' });
  const { f, set, limpiar, hayFiltros } = useFiltros({ busqueda: '', estado: '' });
  const [mostrarNuevo, setMostrarNuevo] = useState(false);

  const filasFiltradas = useMemo(() => {
    return filas.filter((a) => {
      const coincideBusqueda =
        !f.busqueda ||
        a.nombre?.toLowerCase().includes(f.busqueda.toLowerCase()) ||
        a.email?.toLowerCase().includes(f.busqueda.toLowerCase());
      const coincideEstado = !f.estado || a.estado === f.estado;
      return coincideBusqueda && coincideEstado;
    });
  }, [filas, f]);

  return (
    <div>
      <h1>{t.asistentes.titulo}</h1>

      <div className="panel-filtros">
        <input
          type="text"
          placeholder={t.asistentes.buscar}
          value={f.busqueda}
          onChange={(e) => set('busqueda', e.target.value)}
        />
        <select value={f.estado} onChange={(e) => set('estado', e.target.value)}>
          <option value="">{t.comun.todos}</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>
              {t.asistentes[`estado_${e}`]}
            </option>
          ))}
        </select>
        {puedeAltaManual && <Button onClick={() => setMostrarNuevo(true)}>{t.asistentes.nuevo.titulo}</Button>}
      </div>

      {mostrarNuevo && (
        <NuevoAsistenteModal
          onClose={() => setMostrarNuevo(false)}
          onCreado={() => {
            setMostrarNuevo(false);
            recargar();
          }}
        />
      )}

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && filasFiltradas.length === 0}
        recargar={recargar}
        filtrado={hayFiltros}
        onLimpiarFiltros={limpiar}
        mensajeVacio={filas.length === 0 ? t.asistentes.vacio_texto : undefined}
        accionVacio={
          filas.length === 0 && puedeAltaManual ? (
            <Button onClick={() => setMostrarNuevo(true)}>{t.asistentes.nuevo.titulo}</Button>
          ) : undefined
        }
      >
        <div className="lista-tarjetas">
          {filasFiltradas.map((a) => (
            <div className="lista-tarjeta" key={a.id}>
              <div className="lista-tarjeta-header">
                <div>
                  <p className="lista-tarjeta-titulo">{a.nombre}</p>
                  <p className="lista-tarjeta-subtitulo">{(a.especialidades || []).join(', ') || '—'}</p>
                </div>
                <span className={claseBadge(a.estado)}>
                  {t.asistentes[`estado_${a.estado}`]}
                </span>
              </div>
              <div className="lista-tarjeta-meta">
                <span><strong>{t.asistentes.col_zonas}:</strong> {(a.zonas || []).join(', ') || '—'}</span>
                {esAdmin && <span><strong>{t.asistentes.col_vinculo}:</strong> {t.asistentes[`vinculo_${a.tipo_vinculo}`]}</span>}
                {esAdmin && <span><strong>{t.asistentes.col_score_riesgo}:</strong> {a.score_riesgo_reclasificacion}</span>}
              </div>
              <div className="lista-tarjeta-acciones">
                <Button variant="secondary" onClick={() => navigate(`/asistentes/${a.id}`)}>{t.comun.ver_detalle}</Button>
              </div>
            </div>
          ))}
        </div>
      </EstadoLista>
    </div>
  );
}
