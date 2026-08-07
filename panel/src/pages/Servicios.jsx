import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { traducirValor } from '../i18n/valores';
import { supabase } from '../lib/supabaseClient';
import { claseBadge } from '../lib/tonos';
import { useFiltros } from '../hooks/useFiltros';
import { EstadoLista } from '../components/layout/EstadoLista';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';

// Se piden `paciente_id` de las prestaciones y de las guardias, y no un conteo, porque de
// esas dos listas sale la tercera cifra de la tarjeta: a cuántos Pacientes cubre el
// Servicio. Es la misma persona contada una sola vez aunque tenga veinte guardias.
const CONSULTA =
  'id, etiqueta, estado, created_at, familia_id, ' +
  'familias(id, solicitudes!familias_solicitud_id_fkey(nombre, localidad)), ' +
  'prestaciones(paciente_id), guardias(paciente_id)';

export function Servicios() {
  const { t } = useLocale();
  const navigate = useNavigate();
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const { f, set, limpiar, hayFiltros } = useFiltros({ busqueda: '', estado: 'todos' });

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from('servicios')
      .select(CONSULTA)
      .order('created_at', { ascending: false });

    if (errorConsulta) {
      setError(errorConsulta.message);
      setEstado('error');
      return;
    }

    setFilas(data ?? []);
    setEstado('listo');
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const filasFiltradas = useMemo(() => {
    return filas.filter((s) => {
      if (f.estado !== 'todos' && s.estado !== f.estado) return false;
      if (!f.busqueda) return true;
      const b = f.busqueda.toLowerCase();
      return (
        s.etiqueta?.toLowerCase().includes(b) ||
        s.familias?.solicitudes?.nombre?.toLowerCase().includes(b)
      );
    });
  }, [filas, f]);

  return (
    <div>
      <h1>{t.servicios.titulo}</h1>

      <Alert variant="info">
        <strong>{t.servicios.solo_lectura_titulo}.</strong> {t.servicios.solo_lectura_texto}
      </Alert>

      <div className="panel-filtros">
        <input
          type="text"
          placeholder={t.servicios.buscar}
          value={f.busqueda}
          onChange={(e) => set('busqueda', e.target.value)}
        />
        <select aria-label={t.servicios.filtro_estado} value={f.estado} onChange={(e) => set('estado', e.target.value)}>
          <option value="todos">{t.servicios.filtro_todos}</option>
          <option value="vigente">{t.servicios.estado_vigente}</option>
          <option value="de_baja">{t.servicios.estado_de_baja}</option>
        </select>
      </div>

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && filasFiltradas.length === 0}
        recargar={recargar}
        filtrado={hayFiltros}
        onLimpiarFiltros={limpiar}
        mensajeVacio={filas.length === 0 ? t.servicios.vacio_texto : undefined}
      >
        <div className="lista-tarjetas">
          {filasFiltradas.map((s) => {
            const prestaciones = s.prestaciones ?? [];
            const guardias = s.guardias ?? [];
            const pacientes = new Set(
              [...prestaciones, ...guardias].map((r) => r.paciente_id).filter(Boolean),
            );
            return (
              <div className="lista-tarjeta" key={s.id}>
                <div className="lista-tarjeta-header">
                  <div>
                    <p className="lista-tarjeta-titulo">{s.etiqueta || '—'}</p>
                    <p className="lista-tarjeta-subtitulo">
                      {t.servicios.col_cliente}: {s.familias?.solicitudes?.nombre || '—'}
                    </p>
                  </div>
                  <span className={claseBadge(s.estado)}>
                    {traducirValor(t.servicios, `estado_${s.estado}`)}
                  </span>
                </div>
                <div className="lista-tarjeta-meta">
                  <span><strong>{t.servicios.col_pacientes}:</strong> {pacientes.size}</span>
                  <span><strong>{t.servicios.col_prestaciones}:</strong> {prestaciones.length}</span>
                  <span><strong>{t.servicios.col_guardias}:</strong> {guardias.length}</span>
                  <span><strong>{t.servicios.col_alta}:</strong> {new Date(s.created_at).toLocaleDateString()}</span>
                </div>
                <div className="lista-tarjeta-acciones">
                  <Button variant="secondary" onClick={() => navigate(`/servicios/${s.id}`)}>
                    {t.comun.ver_detalle}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </EstadoLista>
    </div>
  );
}
