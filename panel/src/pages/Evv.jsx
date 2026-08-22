import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { supabase } from '../lib/supabaseClient';
import { distanciaKm } from '../lib/distancia';
import { claseBadge } from '../lib/tonos';
import { useFiltros } from '../hooks/useFiltros';
import { EstadoLista } from '../components/layout/EstadoLista';
import { cargarPacientesDeGuardias, pacientesDeGuardia, textoDePacientes } from '../lib/pacientesDeGuardia';
import { llegoAlDomicilio } from '../lib/toleranciaCheckin';
import { domiciliosPorFecha, domicilioDe } from '../lib/domicilioDelDia';
import { mensajeDeError } from '../lib/errores';

/*
 * Esta pantalla existe para auditar los check-in, así que tiene que dar el mismo veredicto que
 * dio el motor cuando ese check-in entró. Dos cosas hacen falta para eso, y las dos vienen de
 * afuera de este archivo:
 *
 *   - **Cuántos metros se toleran** los elige cada Prestadora en Configuración → El cuidado.
 *     Antes acá había un número fijo de trescientos metros, más del doble de lo que tolera el
 *     motor por omisión: el mismo check-in podía estar bien para uno y mal para la otra.
 *   - **Contra qué dirección se mide** es la del día de ese turno, no la que figura hoy en la
 *     ficha. Si el Paciente pasó una temporada en otra casa, el Asistente fue ahí.
 */

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function sumarDias(fechaISO, dias) {
  const f = new Date(`${fechaISO}T00:00:00`);
  f.setDate(f.getDate() + dias);
  return f.toISOString().slice(0, 10);
}

function estadoVerificacion(punto, paciente, configuracion) {
  if (!punto?.lat || !punto?.lng) return 'sin_datos';
  if (!paciente?.lat || !paciente?.lng) return 'sin_domicilio';
  const metros = distanciaKm(punto.lat, punto.lng, paciente.lat, paciente.lng) * 1000;
  const llego = llegoAlDomicilio(metros, configuracion);
  if (llego === null) return 'sin_domicilio';
  return llego ? 'verificado' : 'fuera_de_rango';
}

/*
 * Dónde marcó el Asistente, cuando el turno cubre a más de un Paciente.
 *
 * Alcanza con haber llegado al domicilio de **alguno** de ellos: normalmente viven en la misma
 * casa, y aunque cada domicilio esté cargado con coordenadas apenas distintas, estar en una de
 * las dos puertas es estar donde había que estar. Exigirlo contra los dos daría "fuera de
 * rango" a alguien que llegó bien.
 *
 * El orden en que se elige es de mejor a peor, no el primero que aparezca: verificado gana a
 * fuera de rango, y fuera de rango gana a un domicilio sin cargar.
 */
const ORDEN_VERIFICACION = ['verificado', 'fuera_de_rango', 'sin_domicilio'];

function estadoVerificacionDelTurno(punto, pacientes, configuracion) {
  if (!punto?.lat || !punto?.lng) return 'sin_datos';
  if (!pacientes?.length) return 'sin_domicilio';
  const estados = pacientes.map((p) => estadoVerificacion(punto, p, configuracion));
  return ORDEN_VERIFICACION.find((e) => estados.includes(e)) ?? 'sin_domicilio';
}

export function Evv() {
  const { t } = useLocale();
  const [filas, setFilas] = useState([]);
  const [estadoCarga, setEstadoCarga] = useState('cargando');
  const [error, setError] = useState(null);
  // El rango de fechas arranca en la última semana: se calcula una sola vez, al abrir la pantalla.
  const filtrosIniciales = useMemo(
    () => ({ desde: sumarDias(hoyISO(), -7), hasta: hoyISO(), estado: '' }),
    []
  );
  const { f, set, limpiar, hayFiltros } = useFiltros(filtrosIniciales);

  const recargar = useCallback(async () => {
    setEstadoCarga('cargando');
    setError(null);

    const [
      { data: guardiasData, error: errorGuardias },
      { data: asistentesData },
      { data: pacientesData },
      { data: configuracion },
    ] = await Promise.all([
      supabase
        .from('guardias')
        .select('id, fecha, hora_inicio, hora_fin, estado, asistente_id, paciente_id, checkin_at, checkin_lat, checkin_lng, checkout_at, checkout_lat, checkout_lng')
        .gte('fecha', f.desde)
        .lte('fecha', f.hasta)
        .in('estado', ['activa', 'completada'])
        .order('fecha', { ascending: false })
        .order('hora_inicio', { ascending: true }),
      supabase.from('asistentes').select('id, nombre'),
      // Del Paciente alcanza con el nombre: las coordenadas contra las que se mide no son las
      // de la ficha sino las del día de cada turno, y esas las contesta la base más abajo.
      supabase.from('pacientes').select('id, nombre'),
      // Los metros que tolera esta Prestadora. No lleva filtro por Prestadora porque la regla
      // de acceso de la base ya deja ver una sola fila, la del tenant de esta sesión.
      supabase.from('configuracion_ausencia_automatica').select('metros_tolerancia_checkin').maybeSingle(),
    ]);

    if (errorGuardias) {
      setError(mensajeDeError(errorGuardias, t));
      setEstadoCarga('error');
      return;
    }

    const asistentesPorId = Object.fromEntries((asistentesData ?? []).map((a) => [a.id, a.nombre]));
    const pacientesPorId = Object.fromEntries((pacientesData ?? []).map((p) => [p.id, p]));

    let pacientesPorGuardia;
    try {
      pacientesPorGuardia = await cargarPacientesDeGuardias((guardiasData ?? []).map((g) => g.id));
    } catch (e) {
      setError(mensajeDeError(e, t));
      setEstadoCarga('error');
      return;
    }

    // A quién hay que ubicar en cada fecha. Un turno de esta semana y otro del mes pasado
    // pueden ser del mismo Paciente sin ser la misma dirección, así que la pregunta se agrupa
    // por día y no por persona.
    const pacientesPorFecha = {};
    for (const g of guardiasData ?? []) {
      const pedidos = pacientesPorFecha[g.fecha] ?? [];
      for (const id of pacientesDeGuardia(g, pacientesPorGuardia)) {
        if (!pedidos.includes(id)) pedidos.push(id);
      }
      pacientesPorFecha[g.fecha] = pedidos;
    }
    const domicilios = await domiciliosPorFecha(pacientesPorFecha);

    const filasConEstado = (guardiasData ?? []).map((g) => {
      // Todos los Pacientes del turno, ordenados por nombre para que dos turnos con la misma
      // gente se lean igual, y cada uno con las coordenadas que le regían ese día.
      const pacientes = pacientesDeGuardia(g, pacientesPorGuardia)
        .map((id) => {
          const paciente = pacientesPorId[id];
          if (!paciente) return null;
          const delDia = domicilioDe(domicilios, g.fecha, id);
          return { ...paciente, lat: delDia?.lat ?? null, lng: delDia?.lng ?? null };
        })
        .filter(Boolean)
        .sort((a, b) => (a.nombre ?? '').localeCompare(b.nombre ?? ''));
      return {
        ...g,
        asistente_nombre: asistentesPorId[g.asistente_id] || '—',
        paciente_nombre: textoDePacientes(
          pacientes.map((p) => p.nombre),
          t.guardias.pacientes_y_mas,
        ),
        estado_checkin: estadoVerificacionDelTurno({ lat: g.checkin_lat, lng: g.checkin_lng }, pacientes, configuracion),
        estado_checkout: estadoVerificacionDelTurno({ lat: g.checkout_lat, lng: g.checkout_lng }, pacientes, configuracion),
      };
    });

    setFilas(filasConEstado);
    setEstadoCarga('listo');
    // Solo el rango de fechas se pide al servidor: el filtro de verificación se aplica acá,
    // en memoria, y no tiene que volver a consultar la base cada vez que cambia.
  }, [f.desde, f.hasta, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const filasFiltradas = useMemo(() => {
    if (!f.estado) return filas;
    return filas.filter((g) => g.estado_checkin === f.estado || g.estado_checkout === f.estado);
  }, [filas, f]);

  return (
    <div>
      <h1>{t.evv.titulo}</h1>
      <p className="panel-explicacion">{t.evv.explicacion}</p>

      <div className="panel-filtros">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {t.guardias.filtro_desde}
          <input type="date" value={f.desde} onChange={(e) => set('desde', e.target.value)} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {t.guardias.filtro_hasta}
          <input type="date" value={f.hasta} onChange={(e) => set('hasta', e.target.value)} />
        </label>
        <select value={f.estado} onChange={(e) => set('estado', e.target.value)} aria-label={t.comun.filtro_estado}>
          <option value="">{t.comun.todos}</option>
          <option value="verificado">{t.evv.estado_verificado}</option>
          <option value="fuera_de_rango">{t.evv.estado_fuera_de_rango}</option>
          <option value="sin_datos">{t.evv.estado_sin_datos}</option>
          <option value="sin_domicilio">{t.evv.estado_sin_domicilio}</option>
        </select>
      </div>

      <EstadoLista
        estado={estadoCarga}
        error={error}
        vacio={estadoCarga === 'listo' && filasFiltradas.length === 0}
        recargar={recargar}
        filtrado={hayFiltros}
        onLimpiarFiltros={limpiar}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.evv.col_fecha}</th>
              <th>{t.evv.col_asistente}</th>
              <th>{t.evv.col_paciente}</th>
              <th>{t.evv.col_checkin}</th>
              <th>{t.evv.col_checkout}</th>
            </tr>
          </thead>
          <tbody>
            {filasFiltradas.map((g) => (
              <tr key={g.id}>
                <td>{g.fecha} · {g.hora_inicio}–{g.hora_fin}</td>
                <td>{g.asistente_nombre}</td>
                <td>{g.paciente_nombre}</td>
                <td>
                  {g.checkin_at ? (
                    <span className={claseBadge(g.estado_checkin)}>{t.evv[`estado_${g.estado_checkin}`]}</span>
                  ) : (
                    <span className="badge">{t.evv.sin_checkin}</span>
                  )}
                </td>
                <td>
                  {g.checkout_at ? (
                    <span className={claseBadge(g.estado_checkout)}>{t.evv[`estado_${g.estado_checkout}`]}</span>
                  ) : (
                    <span className="badge">{t.evv.sin_checkout}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>
    </div>
  );
}
