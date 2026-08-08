import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabaseClient';
import { useFiltros } from '../hooks/useFiltros';
import { EstadoLista } from '../components/layout/EstadoLista';
import { Button } from '../components/ui/Button';
import {
  SIGNOS_VITALES,
  SIGNOS_VITALES_LEGADO,
  colorSigno,
  armarBuscadorDeRangos,
  tieneSignoFueraDeRango,
} from '../lib/signosVitales';

// Tope de filas por consulta. Con el rango de fechas por defecto (una semana) no se alcanza
// nunca; existe para que un rango muy ancho no traiga miles de filas de golpe.
const TOPE_FILAS = 300;

function fechaISO(desplazamientoDias = 0) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + desplazamientoDias);
  return fecha.toISOString().slice(0, 10);
}

export function Reportes() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const [filas, setFilas] = useState([]);
  const [rangoDe, setRangoDe] = useState(() => () => null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const { f, set, limpiar, hayFiltros } = useFiltros({ desde: fechaISO(-7), hasta: fechaISO(0), filtro: 'todos' });
  const [abierto, setAbierto] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    setAbierto(null);

    const [{ data: reportesData, error: errorReportes }, { data: rangosData }] = await Promise.all([
      supabase
        .from('reportes')
        // El reporte dice de qué Paciente habla, así que se pide directo. Antes había que
        // traer la lista entera del turno y mostrar todos los nombres juntos en la misma fila.
        .select(
          'id, created_at, texto_libre, alimentacion, medicacion, signos_vitales, estado_animo, incidentes, observaciones, foto_url, confirmado_asistente, pacientes!inner(id, nombre), guardias!inner(fecha, hora_inicio, hora_fin, asistentes(nombre))',
        )
        .gte('guardias.fecha', f.desde)
        .lte('guardias.fecha', f.hasta)
        .order('created_at', { ascending: false })
        .limit(TOPE_FILAS),
      supabase
        .from('rangos_referencia_vitales')
        .select('signo, paciente_id, valor_min, valor_max, unidad')
        .eq('prestadora_id', usuario.prestadora_id),
    ]);

    if (errorReportes) {
      setError(errorReportes.message);
      setEstado('error');
      return;
    }

    const buscador = armarBuscadorDeRangos(rangosData);
    setRangoDe(() => buscador);

    setFilas(
      (reportesData ?? []).map((r) => ({
        ...r,
        paciente_id: r.pacientes?.id ?? null,
        paciente_nombre: r.pacientes?.nombre || '—',
        asistente_nombre: r.guardias?.asistentes?.nombre || '—',
        fecha: r.guardias?.fecha ?? null,
        fuera_de_rango: tieneSignoFueraDeRango(r.signos_vitales, r.pacientes?.id ?? null, buscador),
      })),
    );
    setEstado('listo');
    // Solo las dos fechas, no el objeto de filtros entero: el desplegable filtra las filas ya
    // traídas, y si dependiera de `f` cambiarlo volvería a pedirle todo al servidor.
  }, [f.desde, f.hasta, usuario.prestadora_id]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const filasFiltradas = useMemo(() => {
    if (f.filtro === 'incidentes') return filas.filter((r) => r.incidentes);
    if (f.filtro === 'fuera_rango') return filas.filter((r) => r.fuera_de_rango);
    if (f.filtro === 'sin_confirmar') return filas.filter((r) => !r.confirmado_asistente);
    return filas;
  }, [filas, f]);

  return (
    <div>
      <h1>{t.reportes.titulo}</h1>
      <p className="panel-explicacion">{t.reportes.explicacion}</p>

      <div className="panel-filtros">
        <label>
          {t.reportes.desde}{' '}
          <input type="date" value={f.desde} max={f.hasta} onChange={(e) => set('desde', e.target.value)} />
        </label>
        <label>
          {t.reportes.hasta}{' '}
          <input type="date" value={f.hasta} min={f.desde} onChange={(e) => set('hasta', e.target.value)} />
        </label>
        <select value={f.filtro} onChange={(e) => set('filtro', e.target.value)}>
          <option value="todos">{t.comun.todos}</option>
          <option value="incidentes">{t.reportes.filtro_incidentes}</option>
          <option value="fuera_rango">{t.reportes.filtro_fuera_rango}</option>
          <option value="sin_confirmar">{t.reportes.filtro_sin_confirmar}</option>
        </select>
      </div>

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && filasFiltradas.length === 0}
        recargar={recargar}
        filtrado={hayFiltros}
        onLimpiarFiltros={limpiar}
        mensajeVacio={t.reportes.vacio}
      >
        <>
          {filas.length === TOPE_FILAS && <p className="panel-explicacion">{t.reportes.aviso_tope}</p>}
          <table className="panel-tabla">
            <thead>
              <tr>
                <th>{t.reportes.col_fecha}</th>
                <th>{t.reportes.col_paciente}</th>
                <th>{t.reportes.col_asistente}</th>
                <th>{t.reportes.col_animo}</th>
                <th>{t.reportes.col_senales}</th>
                <th>{t.reportes.col_detalle}</th>
              </tr>
            </thead>
            <tbody>
              {filasFiltradas.map((r) => (
                <tr key={r.id}>
                  <td>{r.fecha}</td>
                  <td>{r.paciente_nombre}</td>
                  <td>{r.asistente_nombre}</td>
                  <td>{r.estado_animo ? t.reportes[`animo_${r.estado_animo}`] : '—'}</td>
                  <td>
                    {r.incidentes && <span className="badge badge-critico">{t.reportes.senal_incidente}</span>}
                    {r.fuera_de_rango && <span className="badge badge-atencion">{t.reportes.senal_fuera_rango}</span>}
                    {!r.confirmado_asistente && <span className="badge">{t.reportes.senal_sin_confirmar}</span>}
                    {!r.incidentes && !r.fuera_de_rango && r.confirmado_asistente && t.reportes.sin_novedades}
                  </td>
                  <td>
                    <Button variant="secondary" onClick={() => setAbierto(abierto === r.id ? null : r.id)}>
                      {abierto === r.id ? t.reportes.ocultar_detalle : t.reportes.ver_detalle}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {abierto && (
            <DetalleReporte
              reporte={filasFiltradas.find((r) => r.id === abierto)}
              rangoDe={rangoDe}
              onCerrar={() => setAbierto(null)}
            />
          )}
        </>
      </EstadoLista>
    </div>
  );
}

function DetalleReporte({ reporte, rangoDe, onCerrar }) {
  const { t } = useLocale();
  if (!reporte) return null;

  const claves = SIGNOS_VITALES.filter((clave) => reporte.signos_vitales?.[clave]);
  const clavesLegado = claves.length === 0 ? SIGNOS_VITALES_LEGADO.filter((c) => reporte.signos_vitales?.[c]) : [];

  return (
    <section className="panel-detalle">
      <div className="panel-detalle-encabezado">
        <h2>{t.reportes.detalle_titulo}</h2>
        <Button variant="secondary" onClick={onCerrar}>
          {t.comun.cerrar}
        </Button>
      </div>
      <p className="panel-explicacion">
        {reporte.fecha} · {reporte.paciente_nombre} · {reporte.asistente_nombre}
      </p>

      <div className="reporte-preview-campo">
        <label>{t.reportes.campo_texto_libre}</label>
        <div>{reporte.texto_libre || t.reportes.sin_datos}</div>
      </div>

      <div className="reporte-preview-campo">
        <label>{t.reportes.campo_alimentacion}</label>
        <div>{reporte.alimentacion?.descripcion || t.reportes.sin_datos}</div>
      </div>

      <div className="reporte-preview-campo">
        <label>{t.reportes.campo_medicacion}</label>
        {Array.isArray(reporte.medicacion) && reporte.medicacion.length > 0 ? (
          reporte.medicacion.map((m, i) => <div key={i}>{[m.nombre, m.hora, m.via].filter(Boolean).join(' · ')}</div>)
        ) : (
          <div>{t.reportes.sin_datos}</div>
        )}
      </div>

      <div className="reporte-preview-campo">
        <label>{t.reportes.campo_signos_vitales}</label>
        {claves.length > 0 &&
          claves.map((clave) => {
            // El rango normal es el de esta persona: la presión alta de uno es la presión de
            // siempre de otro, y ahora se sabe de quién habla el reporte.
            const rango = rangoDe(reporte.paciente_id, clave);
            const color = colorSigno(reporte.signos_vitales[clave], rango);
            return (
              <div key={clave} className={color ? `signo-vital-${color}` : ''}>
                {t.reportes[`signo_${clave}`]}: {reporte.signos_vitales[clave]}
                {rango?.unidad ? ` ${rango.unidad}` : ''}
                {color === 'alerta' && <span className="signo-vital-aviso"> — {t.reportes.signo_fuera_de_rango}</span>}
              </div>
            );
          })}
        {clavesLegado.map((clave) => (
          <div key={clave}>
            {t.reportes[`signo_${clave}`]}: {reporte.signos_vitales[clave]}
          </div>
        ))}
        {claves.length === 0 && clavesLegado.length === 0 && <div>{t.reportes.sin_datos}</div>}
      </div>

      <div className="reporte-preview-campo">
        <label>{t.reportes.campo_incidentes}</label>
        <div>{reporte.incidentes || t.reportes.sin_datos}</div>
      </div>

      <div className="reporte-preview-campo">
        <label>{t.reportes.campo_observaciones}</label>
        <div>{reporte.observaciones || t.reportes.sin_datos}</div>
      </div>

      {reporte.foto_url && (
        <div className="reporte-preview-campo">
          <img src={reporte.foto_url} alt="" style={{ maxWidth: '420px', width: '100%', borderRadius: '8px' }} />
        </div>
      )}
    </section>
  );
}
