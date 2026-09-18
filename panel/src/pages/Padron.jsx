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

  // Cómo se nombra cada renglón. La persona física por apellido y nombre; la jurídica por su razón
  // social entera, que no se parte en dos. Está acá, en un solo lugar, porque lo usan el título de
  // la tarjeta, la búsqueda y el renglón del Apoderado.
  const comoSeLlama = useCallback(
    (fila) => (fila?.clase === 'juridica' ? fila.nombre : `${fila?.apellido ?? ''}, ${fila?.nombre ?? ''}`),
    [],
  );

  // El Apoderado es otro Legajo de este mismo Padrón, así que su nombre ya está cargado y no hace
  // falta volver a pedirlo.
  const nombrePorId = useMemo(
    () => new Map(filas.map((fila) => [fila.id, comoSeLlama(fila)])),
    [filas, comoSeLlama],
  );

  // La búsqueda primero, la clase después, y por separado: así se puede decir cuántas hay de cada
  // clase entre lo que se está mirando. Contar sobre el total diría siempre lo mismo, y contar
  // después del filtro de clase diría cero en las otras dos posiciones.
  const buscadas = useMemo(() => {
    const buscado = f.busqueda.trim().toLowerCase();
    if (!buscado) return filas;
    return filas.filter((fila) => (
      `${fila.apellido ?? ''} ${fila.nombre ?? ''}`.toLowerCase().includes(buscado)
      || String(fila.numero_legajo).includes(buscado)
      || (fila.documento_numero ?? '').toLowerCase().includes(buscado)
    ));
  }, [filas, f.busqueda]);

  const cuantas = useMemo(() => ({
    todas: buscadas.length,
    fisica: buscadas.filter((fila) => fila.clase === 'fisica').length,
    juridica: buscadas.filter((fila) => fila.clase === 'juridica').length,
  }), [buscadas]);

  const filtradas = useMemo(
    () => (f.clase ? buscadas.filter((fila) => fila.clase === f.clase) : buscadas),
    [buscadas, f.clase],
  );

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
          {/* Cada posición dice cuántas hay: así se sabe si vale la pena cambiar de filtro antes
              de cambiarlo, y que no hay ninguna empresa cargada deja de ser algo que se descubre
              recién al elegir esa posición y ver la lista vacía. */}
          <option value="">{t.padron.filtro_clase_todas} ({cuantas.todas})</option>
          <option value="fisica">{t.padron.clase_fisica} ({cuantas.fisica})</option>
          <option value="juridica">{t.padron.clase_juridica} ({cuantas.juridica})</option>
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
              {/* La tarjeta muestra lo que le corresponde a su clase. Las dos comparten la lista,
                  porque contratan y pagan igual, pero no son la misma cosa: una entidad tiene razón
                  social, clave fiscal y alguien que firma por ella; una persona tiene apellido,
                  nombre y documento, y se representa sola. */}
              <div className="lista-tarjeta-header">
                <div>
                  <p className="lista-tarjeta-titulo">{comoSeLlama(fila)}</p>
                  <p className="lista-tarjeta-subtitulo">
                    {fila.documento_tipo
                      ? `${siglaDeTipo(fila.documento_tipo)} ${fila.documento_numero}`
                      : t.padron.sin_documento}
                  </p>
                </div>
              </div>
              <div className="lista-tarjeta-meta">
                {fila.clase === 'juridica' && (
                  <span>
                    <strong>{t.padron.apoderado}:</strong>{' '}
                    {nombrePorId.get(fila.apoderado_legajo_id) || t.padron.apoderado_sin_elegir}
                  </span>
                )}
                <span><strong>{t.padron.telefono}:</strong> {fila.telefono || '—'}</span>
                <span><strong>{t.padron.email}:</strong> {fila.email || '—'}</span>
                <span>
                  <strong>{t.padron.domicilio}:</strong>{' '}
                  {renglonDelDomicilio(partesDesdeFila(fila), catalogo.lugares, palabrasDelDomicilio(t)) || '—'}
                </span>
              </div>
              {puedeEditar && (
                <div className="lista-tarjeta-acciones">
                  <Button variant="secondary" onClick={() => setEnEdicion(fila)}>{t.comun.editar}</Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </EstadoLista>
    </div>
  );
}
