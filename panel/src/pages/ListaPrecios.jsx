import { useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { esAdminOSuperior } from '../lib/roles';
import { claseBadge } from '../lib/tonos';
import { useSupabaseTable } from '../hooks/useSupabaseTable';
import { useFiltros } from '../hooks/useFiltros';
import { EstadoLista } from '../components/layout/EstadoLista';
import { Button } from '../components/ui/Button';
import { ListaPrecioDetalle } from './ListaPrecioDetalle';

export function ListaPrecios() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const { filas, estado, error, recargar } = useSupabaseTable('lista_precios', { orderBy: 'created_at' });
  const { f, set, limpiar, hayFiltros } = useFiltros({ busqueda: '' });
  const [seleccionado, setSeleccionado] = useState(null);
  const [creandoNuevo, setCreandoNuevo] = useState(false);

  const esAdmin = esAdminOSuperior(usuario?.rol);

  const filasFiltradas = useMemo(() => {
    return filas.filter((p) => {
      if (!f.busqueda) return true;
      const b = f.busqueda.toLowerCase();
      return p.tipo_servicio?.toLowerCase().includes(b) || p.modalidad?.toLowerCase().includes(b);
    });
  }, [filas, f]);

  return (
    <div>
      <h1>{t.lista_precios.titulo}</h1>
      <p className="panel-explicacion">{t.lista_precios.explicacion}</p>

      <div className="panel-filtros">
        <input
          type="text"
          placeholder={t.lista_precios.buscar}
          aria-label={t.lista_precios.buscar}
          value={f.busqueda}
          onChange={(e) => set('busqueda', e.target.value)}
        />
        {esAdmin && <Button onClick={() => setCreandoNuevo(true)}>{t.lista_precios.nuevo}</Button>}
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
              <th>{t.lista_precios.col_tipo_servicio}</th>
              <th>{t.lista_precios.col_modalidad}</th>
              <th>{t.lista_precios.col_precio}</th>
              <th>{t.lista_precios.col_vigente_desde}</th>
              <th>{t.lista_precios.col_activo}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filasFiltradas.map((p) => (
              <tr key={p.id}>
                <td>{p.tipo_servicio}</td>
                <td>{p.modalidad}</td>
                <td>{p.precio}</td>
                <td>{new Date(p.vigente_desde).toLocaleDateString()}</td>
                <td>
                  <span className={claseBadge(p.activo ? 'activo' : 'inactivo')}>
                    {p.activo ? t.lista_precios.activo_si : t.lista_precios.activo_no}
                  </span>
                </td>
                <td>
                  <button onClick={() => setSeleccionado(p)}>
                    {esAdmin ? t.comun.editar : t.comun.ver_detalle}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {(seleccionado || creandoNuevo) && (
        <ListaPrecioDetalle
          precio={seleccionado}
          soloLectura={!esAdmin}
          onClose={() => {
            setSeleccionado(null);
            setCreandoNuevo(false);
          }}
          onActualizada={() => {
            setSeleccionado(null);
            setCreandoNuevo(false);
            recargar();
          }}
        />
      )}
    </div>
  );
}
