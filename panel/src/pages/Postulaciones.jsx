import { useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useSupabaseTable } from '../hooks/useSupabaseTable';
import { usePrestadoraActual } from '../hooks/usePrestadoraActual';
import { useFiltros } from '../hooks/useFiltros';
import { useZonasCobertura } from '../hooks/useZonasCobertura';
import { useOpcionesPostulacion } from '../hooks/useOpcionesPostulacion';
import { useListaDeOpciones } from '../hooks/useListaDeOpciones';
import { EstadoLista } from '../components/layout/EstadoLista';
import { FiltroDeCatalogo } from '../components/layout/FiltroDeCatalogo';
import { PostulacionDetalle } from './PostulacionDetalle';
import { traducirCodigos } from '../lib/postulacionCodigos';
import { totalesDePostulaciones } from '../lib/totalesDePostulaciones';
import { filtrarPostulaciones } from '../lib/filtrarPostulaciones';
import { formatearImporte } from '../lib/dinero';
import { claseBadge } from '../lib/tonos';

const ESTADOS = ['pendiente', 'en_revision', 'aprobado', 'rechazado'];
const TIPOS_DE_SERVICIO = ['con_retiro', 'sin_retiro'];

const FILTROS_INICIALES = {
  busqueda: '',
  estado: '',
  especialidad: '',
  zona: '',
  disponibilidad: '',
  situacion_fiscal: '',
  urgencias: '',
  tipo_servicio: '',
  honorario_desde: '',
  honorario_hasta: '',
  distancia_desde: '',
};

export function Postulaciones() {
  const { t, locale } = useLocale();
  const prestadoraId = usePrestadoraActual();
  const { filas, estado, error, recargar } = useSupabaseTable('postulaciones');
  // Los cuatro estados de cada catálogo van al filtro que alimenta: quien filtra tiene que poder
  // distinguir «todavía no llegó» de «falló» de «esta Prestadora no tiene ninguna».
  const zonasDeCobertura = useZonasCobertura(prestadoraId);
  const zonas = zonasDeCobertura.filas;
  const zonasLabels = useMemo(
    () => Object.fromEntries(zonas.map((z) => [z.codigo, z.nombre])),
    [zonas],
  );
  // Las especialidades son las que cargó esta Prestadora, no dos escritas en las traducciones.
  const lasEspecialidades = useOpcionesPostulacion(prestadoraId, 'especialidad');
  const especialidadesLabels = lasEspecialidades.labels;
  // La disponibilidad y la situación fiscal salían del archivo de traducciones, recorridas con un
  // bucle. Ahora son dos listas del registro de opciones, así que cada Prestadora puede agregar
  // sus turnos sin que haga falta publicar una versión nueva del Panel.
  const laDisponibilidad = useListaDeOpciones('disponibilidad');
  const laSituacionFiscal = useListaDeOpciones('situacion_fiscal');
  const { f, set, limpiar, hayFiltros } = useFiltros(FILTROS_INICIALES);
  const [seleccionada, setSeleccionada] = useState(null);

  const filasFiltradas = useMemo(() => filtrarPostulaciones(filas, f), [filas, f]);

  // Los números son de todas las postulaciones traídas y no de las que quedaron después de los
  // filtros: contados sobre lo filtrado, elegir una situación dejaría las otras cuatro en cero.
  const totales = useMemo(() => totalesDePostulaciones(filas, ESTADOS), [filas]);

  return (
    <div>
      <h1>{t.postulaciones.titulo}</h1>

      {/* Cuántas hay y en qué situación está cada una. Cada número filtra por esa situación, y el
          primero saca el filtro: es la pregunta que se hace después de mirar el número. */}
      {estado === 'listo' && (
        <div className="panel-kpis">
          <button
            type="button"
            className="panel-kpi-card"
            onClick={() => set('estado', '')}
            aria-pressed={f.estado === ''}
          >
            <div className="panel-kpi-valor">{totales.total}</div>
            <div className="panel-kpi-etiqueta">{t.postulaciones.titulo}</div>
          </button>
          {ESTADOS.map((clave) => (
            <button
              key={clave}
              type="button"
              className="panel-kpi-card"
              onClick={() => set('estado', clave)}
              aria-pressed={f.estado === clave}
            >
              <div className="panel-kpi-valor">{totales.porEstado[clave]}</div>
              <div className="panel-kpi-etiqueta">{t.postulaciones[`estado_${clave}`]}</div>
            </button>
          ))}
        </div>
      )}

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
        <FiltroDeCatalogo
          etiqueta={t.postulaciones.filtro_especialidad}
          valor={f.especialidad}
          onCambiar={(v) => set('especialidad', v)}
          opciones={lasEspecialidades.filas.map((e) => ({ valor: e.clave, texto: e.etiqueta }))}
          estado={lasEspecialidades.estado}
          error={lasEspecialidades.error}
          recargar={lasEspecialidades.recargar}
        />
        <FiltroDeCatalogo
          etiqueta={t.postulaciones.filtro_zona}
          valor={f.zona}
          onCambiar={(v) => set('zona', v)}
          opciones={zonas.map((z) => ({ valor: z.codigo, texto: z.nombre }))}
          estado={zonasDeCobertura.estado}
          error={zonasDeCobertura.error}
          recargar={zonasDeCobertura.recargar}
        />
        <FiltroDeCatalogo
          etiqueta={t.postulaciones.filtro_disponibilidad}
          valor={f.disponibilidad}
          onCambiar={(v) => set('disponibilidad', v)}
          opciones={laDisponibilidad.opciones.map((o) => ({ valor: o.clave, texto: o.texto }))}
          estado={laDisponibilidad.estado}
          error={laDisponibilidad.error}
          recargar={laDisponibilidad.recargar}
        />
        <FiltroDeCatalogo
          etiqueta={t.postulaciones.filtro_situacion_fiscal}
          valor={f.situacion_fiscal}
          onCambiar={(v) => set('situacion_fiscal', v)}
          opciones={laSituacionFiscal.opciones.map((o) => ({ valor: o.clave, texto: o.texto }))}
          estado={laSituacionFiscal.estado}
          error={laSituacionFiscal.error}
          recargar={laSituacionFiscal.recargar}
        />
        <select value={f.urgencias} onChange={(e) => set('urgencias', e.target.value)} aria-label={t.postulaciones.filtro_urgencias}>
          <option value="">{t.postulaciones.filtro_urgencias}</option>
          <option value="si">{t.postulaciones.filtro_urgencias_si}</option>
        </select>
        <select value={f.tipo_servicio} onChange={(e) => set('tipo_servicio', e.target.value)} aria-label={t.postulaciones.filtro_tipo_servicio}>
          <option value="">{t.postulaciones.filtro_tipo_servicio}</option>
          {TIPOS_DE_SERVICIO.map((clave) => (
            <option key={clave} value={clave}>{t.postulaciones[`tipo_servicio_${clave}`]}</option>
          ))}
        </select>
        {/* El honorario y la distancia se escriben, no se eligen: son números que dependen de cada
            Prestadora y de cada zona, y una lista de rangos armada de antemano sería un valor
            operativo escrito en el código. */}
        <input
          type="number"
          min="0"
          placeholder={t.postulaciones.filtro_honorario_desde}
          aria-label={t.postulaciones.filtro_honorario_desde}
          value={f.honorario_desde}
          onChange={(e) => set('honorario_desde', e.target.value)}
        />
        <input
          type="number"
          min="0"
          placeholder={t.postulaciones.filtro_honorario_hasta}
          aria-label={t.postulaciones.filtro_honorario_hasta}
          value={f.honorario_hasta}
          onChange={(e) => set('honorario_hasta', e.target.value)}
        />
        <input
          type="number"
          min="0"
          placeholder={t.postulaciones.filtro_distancia_desde}
          aria-label={t.postulaciones.filtro_distancia_desde}
          value={f.distancia_desde}
          onChange={(e) => set('distancia_desde', e.target.value)}
        />
      </div>

      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && filasFiltradas.length === 0} recargar={recargar} filtrado={hayFiltros} onLimpiarFiltros={limpiar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.postulaciones.col_nombre}</th>
              <th>{t.postulaciones.col_especialidades}</th>
              <th>{t.postulaciones.col_zonas}</th>
              <th>{t.postulaciones.col_fecha}</th>
              <th>{t.postulaciones.col_honorario_pretendido}</th>
              <th>{t.postulaciones.anios_experiencia}</th>
              <th>{t.postulaciones.col_situacion_fiscal}</th>
              <th>{t.postulaciones.col_urgencias}</th>
              <th>{t.postulaciones.como_conocio}</th>
              <th>{t.postulaciones.col_estado}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filasFiltradas.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre}</td>
                <td>{traducirCodigos(p.especialidades, especialidadesLabels)}</td>
                <td>{traducirCodigos(p.zonas, zonasLabels)}</td>
                <td>{new Date(p.creado_en).toLocaleDateString(locale)}</td>
                {/* La moneda sale de la fila, no de la Prestadora de quien mira: el importe está
                    guardado con la suya. Sin dato, `formatearImporte` escribe un guión. */}
                <td>{formatearImporte(p.honorario_pretendido, p.moneda, locale)}</td>
                <td>{p.anios_experiencia ?? '—'}</td>
                {/* Lo guardado es la clave; el texto sale del catálogo. Una clave sin opción
                    cargada se muestra tal cual: lo que ya se escribió no depende de que el
                    catálogo de hoy la siga teniendo. */}
                <td>{laSituacionFiscal.textos[p.situacion_fiscal] ?? p.situacion_fiscal}</td>
                <td>{p.disponible_urgencias ? t.comun.si : '—'}</td>
                <td>{p.como_conocio || '—'}</td>
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
