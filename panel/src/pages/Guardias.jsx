import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { supabase } from '../lib/supabaseClient';
import { useFiltros } from '../hooks/useFiltros';
import { EstadoLista } from '../components/layout/EstadoLista';
import { Button } from '../components/ui/Button';
import { NuevaGuardiaModal } from './guardias/NuevaGuardiaModal';
import { GuardiaAcciones } from './guardias/GuardiaAcciones';
import { GuardiasGrid } from './guardias/GuardiasGrid';
import { GuardiasSinCerrar } from './guardias/GuardiasSinCerrar';
import { COBERTURA, coberturaDeGuardia } from '../lib/cobertura';
import { cargarPacientesDeGuardias, conPacientes, textoDePacientes } from '../lib/pacientesDeGuardia';
import { reasignarGuardia } from '../lib/reasignarGuardia';
import { mensajeDeError } from '../lib/errores';

const ESTADOS = ['programada', 'activa', 'completada', 'cancelada', 'ausente'];
const HORAS_ALERTA_CHECKIN_SIN_CHECKOUT = 2;

function hoyISO() {
  return new Date().toISOString().slice(0, 10);
}

function sumarDias(fechaISO, dias) {
  const f = new Date(`${fechaISO}T00:00:00`);
  f.setDate(f.getDate() + dias);
  return f.toISOString().slice(0, 10);
}

export function Guardias() {
  const { t } = useLocale();
  const [filas, setFilas] = useState([]);
  const [estadoCarga, setEstadoCarga] = useState('cargando');
  const [error, setError] = useState(null);
  // El rango de fechas arranca en hoy: se calcula una sola vez, al abrir la pantalla.
  const filtrosIniciales = useMemo(
    () => ({ desde: hoyISO(), hasta: sumarDias(hoyISO(), 14), estado: '', sinCubrir: false, busqueda: '' }),
    []
  );
  const { f, set, limpiar, hayFiltros } = useFiltros(filtrosIniciales);
  const [mostrarNueva, setMostrarNueva] = useState(false);
  const [guardiaSeleccionada, setGuardiaSeleccionada] = useState(null);
  const [asistentes, setAsistentes] = useState([]);

  const recargar = useCallback(async () => {
    setEstadoCarga('cargando');
    setError(null);

    const [{ data: guardiasData, error: errorGuardias }, { data: asistentesData }, { data: pacientesData }] = await Promise.all([
      supabase
        .from('guardias')
        .select('*')
        .gte('fecha', f.desde)
        .lte('fecha', f.hasta)
        .order('fecha', { ascending: true })
        .order('hora_inicio', { ascending: true }),
      supabase.from('asistentes').select('id, nombre'),
      supabase.from('pacientes').select('id, nombre'),
    ]);

    if (errorGuardias) {
      setError(mensajeDeError(errorGuardias, t));
      setEstadoCarga('error');
      return;
    }

    setAsistentes(asistentesData ?? []);
    const asistentesPorId = Object.fromEntries((asistentesData ?? []).map((a) => [a.id, a.nombre]));
    const pacientesPorId = Object.fromEntries((pacientesData ?? []).map((p) => [p.id, p.nombre]));

    // A quiénes atiende cada guardia: un turno puede cubrir a más de una persona, y esa lista
    // no vive en la guardia sino en su propia tabla (ver `lib/pacientesDeGuardia.js`).
    const pacientesPorGuardia = await cargarPacientesDeGuardias((guardiasData ?? []).map((g) => g.id));

    const filasConNombres = conPacientes(guardiasData ?? [], pacientesPorGuardia, pacientesPorId).map((g) => ({
      ...g,
      asistente_nombre: asistentesPorId[g.asistente_id] || '—',
    }));

    setFilas(filasConNombres);
    setEstadoCarga('listo');
    // Solo el rango de fechas se pide al servidor: los demás filtros se aplican acá, en
    // memoria, y no tienen que volver a consultar la base cada vez que cambian.
  }, [f.desde, f.hasta, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  /* El nombre que se muestra en el chip se arma acá y no al cargar: el resumen depende del
     idioma ("y 3 más"), y cambiar de idioma no tiene por qué volver a consultar la base. */
  const filasFiltradas = useMemo(() => {
    const b = f.busqueda.toLowerCase();
    return filas
      .map((g) => ({
        ...g,
        paciente_nombre: textoDePacientes(g.pacientes_nombres, t.guardias.pacientes_y_mas),
      }))
      .filter((g) => {
        const coincideEstado = !f.estado || g.estado === f.estado;
        const coincideCobertura = !f.sinCubrir || coberturaDeGuardia(g) !== COBERTURA.CUBIERTA;
        // La búsqueda mira TODOS los nombres del turno, no el resumen: en un asilo el resumen
        // muestra dos y esconde dieciocho, y buscar a uno de esos dieciocho no daría nada.
        const coincideBusqueda =
          !b ||
          g.asistente_nombre?.toLowerCase().includes(b) ||
          (g.pacientes_nombres ?? []).some((n) => n?.toLowerCase().includes(b));
        return coincideEstado && coincideCobertura && coincideBusqueda;
      });
  }, [filas, f, t]);

  function tieneAlertaCheckinSinCheckout(g) {
    if (g.estado !== 'activa' || !g.checkin_at || g.checkout_at) return false;
    const finProgramado = new Date(`${g.fecha}T${g.hora_fin}`);
    const limite = new Date(finProgramado.getTime() + HORAS_ALERTA_CHECKIN_SIN_CHECKOUT * 60 * 60 * 1000);
    return new Date() > limite;
  }

  function cerrarYRecargar() {
    setMostrarNueva(false);
    recargar();
  }

  // Los tres pasos de una reasignación viven en `lib/reasignarGuardia.js`, no acá: el
  // Estado actual hace exactamente lo mismo y no puede haber dos versiones de esta operación
  // (regla 12 de CLAUDE.md §7).
  async function handleReasignar(guardiaId, asistenteId, fecha) {
    const guardiaActual = filas.find((g) => g.id === guardiaId);
    if (!guardiaActual) return;

    const { error: falla } = await reasignarGuardia(guardiaActual, asistenteId, fecha, t);
    if (falla) {
      setError(falla);
      return;
    }
    recargar();
  }

  return (
    <div>
      <h1>{t.guardias.titulo}</h1>

      {/* Va arriba de todo y antes de los filtros a propósito: es lo que hay que resolver, y no
          depende del rango de fechas de abajo. Trae sus propios datos, mirando hacia atrás sin
          límite, porque una guardia que quedó abierta el mes pasado no cae dentro de ningún
          rango que alguien tenga puesto. */}
      <GuardiasSinCerrar onCerrada={recargar} />

      <div className="panel-filtros-tarjeta">
        <FormFieldFecha label={t.guardias.filtro_desde} value={f.desde} onChange={(v) => set('desde', v)} />
        <FormFieldFecha label={t.guardias.filtro_hasta} value={f.hasta} onChange={(v) => set('hasta', v)} />
        <select value={f.estado} onChange={(e) => set('estado', e.target.value)} aria-label={t.comun.filtro_estado}>
          <option value="">{t.comun.todos}</option>
          {ESTADOS.map((e) => (
            <option key={e} value={e}>{t.guardias[`estado_${e}`]}</option>
          ))}
        </select>
        <input
          type="text"
          placeholder={t.guardias.buscar}
          aria-label={t.guardias.buscar}
          value={f.busqueda}
          onChange={(e) => set('busqueda', e.target.value)}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <input
            type="checkbox"
            checked={f.sinCubrir}
            onChange={(e) => set('sinCubrir', e.target.checked)}
          />
          {t.guardias.cobertura_solo_huecos}
        </label>
        <Button onClick={() => setMostrarNueva(true)}>{t.guardias.nueva}</Button>
      </div>

      <div className="dashboard-seccion">
        <div className="dashboard-seccion-header">
          <h2 className="dashboard-seccion-titulo">{t.guardias.grilla_titulo}</h2>
          <p className="dashboard-seccion-subtitulo">{t.guardias.grilla_subtitulo}</p>
        </div>
        <EstadoLista
          estado={estadoCarga}
          error={error}
          vacio={estadoCarga === 'listo' && filasFiltradas.length === 0}
          recargar={recargar}
          filtrado={hayFiltros}
          onLimpiarFiltros={limpiar}
          mensajeVacio={t.guardias.sin_guardias_rango}
        >
          <div className="panel-guardias-grid-tarjeta">
            <GuardiasGrid
              filas={filasFiltradas}
              desde={f.desde}
              hasta={f.hasta}
              tieneAlerta={tieneAlertaCheckinSinCheckout}
              onSeleccionar={setGuardiaSeleccionada}
              onReasignar={handleReasignar}
            />
          </div>
        </EstadoLista>
      </div>

      {mostrarNueva && <NuevaGuardiaModal onClose={() => setMostrarNueva(false)} onCreada={cerrarYRecargar} />}

      {guardiaSeleccionada && (
        <GuardiaAcciones
          guardia={guardiaSeleccionada}
          asistentes={asistentes}
          onReasignar={handleReasignar}
          onClose={() => setGuardiaSeleccionada(null)}
          onActualizada={recargar}
        />
      )}
    </div>
  );
}

function FormFieldFecha({ label, value, onChange }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
      {label}
      <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}
