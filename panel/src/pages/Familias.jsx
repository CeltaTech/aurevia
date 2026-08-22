import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { usePermisos } from '../context/PermisosContext';
import { esAdminOSuperior } from '../lib/roles';
import { supabase } from '../lib/supabaseClient';
import { useFiltros } from '../hooks/useFiltros';
import { EstadoLista } from '../components/layout/EstadoLista';
import { Button } from '../components/ui/Button';
import { NuevaFamiliaModal } from './familias/NuevaFamiliaModal';
import { mensajeDeError } from '../lib/errores';

export function Familias() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { usuario } = useAuth();
  const esAdmin = esAdminOSuperior(usuario?.rol);
  const { puede } = usePermisos();
  const puedeAltaManual = esAdmin || puede('alta_manual_familia');
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const { f, set, limpiar, hayFiltros } = useFiltros({ busqueda: '' });
  const [mostrarNueva, setMostrarNueva] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from('familias')
      .select('id, created_at, solicitudes!familias_solicitud_id_fkey(nombre, telefono, email, localidad), pacientes(id)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }

    setFilas(data ?? []);
    setEstado('listo');
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const filasFiltradas = useMemo(() => {
    // La fila se llama `fam` porque `f` ya es el objeto de filtros de la pantalla.
    return filas.filter((fam) => {
      if (!f.busqueda) return true;
      const b = f.busqueda.toLowerCase();
      return (
        fam.solicitudes?.nombre?.toLowerCase().includes(b) ||
        fam.solicitudes?.email?.toLowerCase().includes(b) ||
        fam.solicitudes?.telefono?.toLowerCase().includes(b)
      );
    });
  }, [filas, f]);

  return (
    <div>
      <h1>{t.familias.titulo}</h1>

      <div className="panel-filtros">
        <input
          type="text"
          placeholder={t.familias.buscar}
          aria-label={t.familias.buscar}
          value={f.busqueda}
          onChange={(e) => set('busqueda', e.target.value)}
        />
        {puedeAltaManual && <Button onClick={() => setMostrarNueva(true)}>{t.familias.nueva.titulo}</Button>}
      </div>

      {mostrarNueva && (
        <NuevaFamiliaModal
          onClose={() => setMostrarNueva(false)}
          onCreada={() => {
            setMostrarNueva(false);
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
        mensajeVacio={filas.length === 0 ? t.familias.vacio_texto : undefined}
        accionVacio={
          filas.length === 0 && puedeAltaManual ? (
            <Button onClick={() => setMostrarNueva(true)}>{t.familias.nueva.titulo}</Button>
          ) : undefined
        }
      >
        <div className="lista-tarjetas">
          {filasFiltradas.map((fam) => (
            <div className="lista-tarjeta" key={fam.id}>
              <div className="lista-tarjeta-header">
                <div>
                  <p className="lista-tarjeta-titulo">{fam.solicitudes?.nombre || '—'}</p>
                  <p className="lista-tarjeta-subtitulo">{fam.solicitudes?.localidad || '—'}</p>
                </div>
                <span className="badge">{t.familias.col_pacientes}: {fam.pacientes?.length ?? 0}</span>
              </div>
              <div className="lista-tarjeta-meta">
                <span><strong>{t.familias.col_telefono}:</strong> {fam.solicitudes?.telefono || '—'}</span>
                <span><strong>{t.familias.col_email}:</strong> {fam.solicitudes?.email || '—'}</span>
                <span><strong>{t.familias.col_fecha_alta}:</strong> {new Date(fam.created_at).toLocaleDateString()}</span>
              </div>
              <div className="lista-tarjeta-acciones">
                <Button variant="secondary" onClick={() => navigate(`/familias/${fam.id}`)}>{t.comun.ver_detalle}</Button>
              </div>
            </div>
          ))}
        </div>
      </EstadoLista>
    </div>
  );
}
