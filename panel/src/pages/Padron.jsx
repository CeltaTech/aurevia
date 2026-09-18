import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { usePermisos } from '../context/PermisosContext';
import { usePrestadoraActual } from '../hooks/usePrestadoraActual';
import { esAdminOSuperior } from '../lib/roles';
import { supabase } from '../lib/supabaseClient';
import { useFiltros } from '../hooks/useFiltros';
import { useCatalogoDeLugares } from '../hooks/useCatalogoDeLugares';
import { useTiposDeDocumento } from '../hooks/useTiposDeDocumento';
import { EstadoLista } from '../components/layout/EstadoLista';
import { Button } from '../components/ui/Button';
import { LegajoModal } from './padron/LegajoModal';
import { mensajeDeError } from '../lib/errores';
import { palabrasDelDomicilio, partesDesdeFila, renglonDelDomicilio } from '../lib/partesDeDomicilio';

/* El Padrón de la Prestadora.
   ==========================================================================

   La lista de todas las Personas con las que la Prestadora tiene algo que ver: quien contrata,
   quien paga, quien recibe el cuidado, quien acompaña, y también su propia gente. Una Persona, un
   Legajo, aunque con el tiempo le toquen varios roles.

   EL LEGAJO NO GUARDA NINGÚN ROL. Guarda quién es esa Persona y nada más. Qué rol le toca se
   resuelve donde ocurre —la contratación, el Servicio, la Familia— y desde ahí se señala cuál
   Legajo es. Así, la misma Persona que hoy contrata para una Familia y mañana necesita cuidados
   sigue siendo un solo Legajo, con todo su historial junto.

   NADIE BORRA UN LEGAJO, y por eso esta pantalla no ofrece hacerlo. Lo que se pierde el día que
   alguien borra «porque ya no está activa» es justamente el historial de cómo se comportó esa
   Persona en cada rol.

   LA LISTA ES DE LA PRESTADORA. Quién ve cada fila lo decide la base con la política, no esta
   pantalla: acá el candado sirve para no mostrar un renglón de menú que después va a fallar. */
export function Padron() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const prestadoraId = usePrestadoraActual();
  const esAdmin = esAdminOSuperior(usuario?.rol);
  const { puede } = usePermisos();
  const puedeEditar = esAdmin || puede('editar_padron');

  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const { f, set, limpiar, hayFiltros } = useFiltros({ busqueda: '', clase: '' });
  // `null` es «cerrado»; `'nuevo'` es un alta; una fila es la corrección de ese Legajo.
  const [enEdicion, setEnEdicion] = useState(null);

  const catalogo = useCatalogoDeLugares();
  const documentos = useTiposDeDocumento(prestadoraId);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from('legajos')
      .select('*')
      .order('apellido', { ascending: true })
      .order('nombre', { ascending: true });

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

  const siglaDeTipo = useMemo(() => {
    const todos = [...(documentos.porClase.fisica ?? []), ...(documentos.porClase.juridica ?? [])];
    const porCodigo = new Map(todos.map((uno) => [uno.codigo, uno.sigla]));
    return (codigo) => porCodigo.get(codigo) ?? '';
  }, [documentos.porClase]);

  const filtradas = useMemo(() => {
    const buscado = f.busqueda.trim().toLowerCase();
    return filas.filter((fila) => {
      if (f.clase && fila.clase !== f.clase) return false;
      if (!buscado) return true;
      const nombreEntero = `${fila.apellido ?? ''} ${fila.nombre ?? ''}`.toLowerCase();
      return (
        nombreEntero.includes(buscado)
        || String(fila.numero_legajo).includes(buscado)
        || (fila.documento_numero ?? '').toLowerCase().includes(buscado)
      );
    });
  }, [filas, f]);

  return (
    <div>
      <h1>{t.padron.titulo}</h1>
      <p className="panel-explicacion">{t.padron.explicacion}</p>

      <div className="panel-filtros">
        <input
          type="text"
          placeholder={t.padron.buscar}
          aria-label={t.padron.buscar}
          value={f.busqueda}
          onChange={(e) => set('busqueda', e.target.value)}
        />
        <select value={f.clase} onChange={(e) => set('clase', e.target.value)} aria-label={t.padron.clase}>
          <option value="">{t.padron.filtro_clase_todas}</option>
          <option value="fisica">{t.padron.clase_fisica}</option>
          <option value="juridica">{t.padron.clase_juridica}</option>
        </select>
        {puedeEditar && <Button onClick={() => setEnEdicion('nuevo')}>{t.padron.nuevo_titulo}</Button>}
      </div>

      {enEdicion && (
        <LegajoModal
          legajo={enEdicion === 'nuevo' ? null : enEdicion}
          prestadoraId={prestadoraId}
          tiposDeDocumento={documentos.porClase}
          onClose={() => setEnEdicion(null)}
          onGuardado={() => {
            setEnEdicion(null);
            recargar();
          }}
        />
      )}

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && filtradas.length === 0}
        recargar={recargar}
        filtrado={hayFiltros}
        onLimpiarFiltros={limpiar}
        mensajeVacio={filas.length === 0 ? t.padron.vacio_titulo : undefined}
        ayudaVacio={filas.length === 0 ? t.padron.vacio_ayuda : undefined}
        accionVacio={
          filas.length === 0 && puedeEditar ? (
            <Button onClick={() => setEnEdicion('nuevo')}>{t.padron.nuevo_titulo}</Button>
          ) : undefined
        }
      >
        <div className="lista-tarjetas">
          {filtradas.map((fila) => (
            <div className="lista-tarjeta" key={fila.id}>
              <div className="lista-tarjeta-header">
                <div>
                  <p className="lista-tarjeta-titulo">
                    {fila.clase === 'juridica' ? fila.nombre : `${fila.apellido}, ${fila.nombre}`}
                  </p>
                  <p className="lista-tarjeta-subtitulo">
                    {fila.documento_tipo
                      ? `${siglaDeTipo(fila.documento_tipo)} ${fila.documento_numero}`
                      : t.padron.sin_documento}
                  </p>
                </div>
                <span className="badge">{t.padron.numero}: {fila.numero_legajo}</span>
              </div>
              <div className="lista-tarjeta-meta">
                <span><strong>{t.padron.clase}:</strong> {fila.clase === 'juridica' ? t.padron.clase_juridica : t.padron.clase_fisica}</span>
                <span><strong>{t.padron.telefono}:</strong> {fila.telefono || '—'}</span>
                <span><strong>{t.padron.email}:</strong> {fila.email || '—'}</span>
                <span>
                  <strong>{t.padron.domicilio}:</strong>{' '}
                  {renglonDelDomicilio(partesDesdeFila(fila), catalogo.lugares, palabrasDelDomicilio(t)) || '—'}
                </span>
              </div>
              {puedeEditar && (
                <div className="lista-tarjeta-acciones">
                  <Button variant="secondary" onClick={() => setEnEdicion(fila)}>{t.padron.corregir_titulo}</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </EstadoLista>
    </div>
  );
}
