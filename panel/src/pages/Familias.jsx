import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { usePermisos } from '../context/PermisosContext';
import { esAdminOSuperior } from '../lib/roles';
import { supabase } from '../lib/supabaseClient';
import { useFiltros } from '../hooks/useFiltros';
import { useCatalogoDeLugares } from '../hooks/useCatalogoDeLugares';
import { familiasConSuLocalidad, filtrarFamilias, localidadesConFamilias } from '../lib/familiasPorLocalidad';
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
  const { f, set, limpiar, hayFiltros } = useFiltros({ busqueda: '', lugar: '' });
  const [mostrarNueva, setMostrarNueva] = useState(false);
  // Los nombres de las localidades salen del catálogo y no de la ficha del Paciente: lo guardado
  // es cuál lugar, y corregir una vez cómo se llama lo corrige en todas las fichas que lo nombran.
  const catalogo = useCatalogoDeLugares();

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from('familias')
      .select('id, created_at, solicitudes!familias_solicitud_id_fkey(nombre, telefono, email, localidad), pacientes(id, lugar_id, deleted_at)')
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

  const nombreDeLugar = useMemo(() => {
    const porId = new Map((catalogo.lugares ?? []).map((lugar) => [lugar.id, lugar.nombre]));
    return (id) => porId.get(id) ?? '';
  }, [catalogo.lugares]);

  // Qué Familia está dónde, qué queda después de los filtros y qué localidades vale la pena
  // ofrecer sale de `lib/familiasPorLocalidad.js`, que es el punto único de verdad. Acá sólo se
  // dibuja.
  const familias = useMemo(() => familiasConSuLocalidad(filas, nombreDeLugar), [filas, nombreDeLugar]);
  const filasFiltradas = useMemo(() => filtrarFamilias(familias, f), [familias, f]);
  const lugaresConFamilias = useMemo(
    () => localidadesConFamilias(familias, catalogo.lugares),
    [familias, catalogo.lugares],
  );

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
        {lugaresConFamilias.length > 1 && (
          <select value={f.lugar} onChange={(e) => set('lugar', e.target.value)} aria-label={t.familias.col_localidad}>
            <option value="">{t.familias.filtro_localidad_todas}</option>
            {lugaresConFamilias.map((lugar) => (
              <option key={lugar.id} value={lugar.id}>{lugar.nombre}</option>
            ))}
          </select>
        )}
        {puedeAltaManual &&<Button onClick={() => setMostrarNueva(true)}>{t.familias.nueva.titulo}</Button>}
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
                  {/* Lo que se muestra son las localidades de sus Pacientes. Mientras no haya
                      ninguna elegida queda lo que dijo quien llamó, que es lo único que se sabe
                      de esa Familia hasta que alguien señale el lugar en la lista. */}
                  <p className="lista-tarjeta-subtitulo">
                    {fam.nombresDeLugares.join(', ') || fam.solicitudes?.localidad || '—'}
                  </p>
                </div>
                <span className="badge">{t.familias.col_pacientes}: {fam.cuantosPacientes}</span>
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
