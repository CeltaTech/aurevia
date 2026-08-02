import { supabase } from '../db/connection.js';

// Punto único de verdad (Regla 12, CLAUDE.md §7) para resolver "medicación vigente" de un
// Paciente y "¿puede este Asistente administrar esta vía?" — consumido por
// appFamilias.js/appAsistentes.js (para dejar de leer pacientes.medicacion_habitual,
// deprecado), panelMedicacion.js (cola de pendientes) y appAsistentesMedicacion.js (filtro
// de órdenes).

export async function medicacionVigenteDelPaciente(pacienteId) {
  const hoyISO = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('indicaciones_medicacion')
    .select('id, medicamento, dosis, frecuencia, via_administracion, fecha_desde, fecha_hasta')
    .eq('paciente_id', pacienteId)
    .eq('estado', 'aceptada')
    .lte('fecha_desde', hoyISO)
    .or(`fecha_hasta.is.null,fecha_hasta.gte.${hoyISO}`)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function tipoMatriculaRequerida(prestadoraId, viaAdministracion) {
  const { data } = await supabase
    .from('configuracion_matricula_via_medicacion')
    .select('tipo_matricula_requerida')
    .eq('prestadora_id', prestadoraId)
    .eq('via_administracion', viaAdministracion)
    .maybeSingle();
  return data?.tipo_matricula_requerida ?? null;
}

export async function asistenteTieneMatriculaVigente(asistenteId, tipoRequerido) {
  if (!tipoRequerido) return true;
  const hoyISO = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('matriculas_asistente')
    .select('id')
    .eq('asistente_id', asistenteId)
    .eq('tipo', tipoRequerido)
    .lte('vigente_desde', hoyISO)
    .or(`vigente_hasta.is.null,vigente_hasta.gte.${hoyISO}`)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

// Asistentes con alguna Guardia futura o de hoy para ese Paciente — no hace falta un vínculo
// dedicado "asistente asignado", guardias ya es la fuente real de asignación en el resto del
// sistema (mismo criterio que appFamilias.js:/pacientes/:id/asistente).
export async function asistentesAsignadosAlPaciente(pacienteId) {
  const hoyISO = new Date().toISOString().slice(0, 10);
  const { data } = await supabase
    .from('guardias')
    .select('asistente_id')
    .eq('paciente_id', pacienteId)
    .not('asistente_id', 'is', null)
    .gte('fecha', hoyISO);
  return [...new Set((data || []).map((g) => g.asistente_id))];
}

export async function hayAsistenteAsignadoConMatricula(pacienteId, tipoRequerido) {
  if (!tipoRequerido) return true;
  const asignados = await asistentesAsignadosAlPaciente(pacienteId);
  for (const asistenteId of asignados) {
    if (await asistenteTieneMatriculaVigente(asistenteId, tipoRequerido)) return true;
  }
  return false;
}
