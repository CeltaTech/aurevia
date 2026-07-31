import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';
import { tienePermiso } from '../utils/permisos.js';

export const panelInformesObraSocialRouter = Router();

const TIPOS_INFORME = ['planilla_asistencia', 'resumen_mensual'];

function requierePermiso(accion) {
  return async (req, res, next) => {
    const permitido = await tienePermiso({
      accion,
      rol: req.usuarioPanel?.rol,
      usuarioId: req.usuarioPanel?.id,
      prestadoraId: req.usuarioPanel?.prestadoraId,
    });
    if (!permitido) {
      return res.status(403).json({ error: 'Tu Prestadora no te habilitó para esta acción' });
    }
    next();
  };
}

function horasEntre(horaInicio, horaFin) {
  const [hi, mi] = horaInicio.split(':').map(Number);
  const [hf, mf] = horaFin.split(':').map(Number);
  let minutos = hf * 60 + mf - (hi * 60 + mi);
  if (minutos < 0) minutos += 24 * 60; // guardia que cruza medianoche
  return minutos / 60;
}

// Recalcula el contenido del informe server-side siempre (preview y validación usan esta
// misma función) — nunca se confía en un "contenido" que mande el frontend, coherente con
// que el snapshot final debe reflejar la base de datos real al momento de validar.
async function construirContenido({ prestadoraId, pacienteId, tipo, periodoDesde, periodoHasta }) {
  const { data: paciente, error: errorPaciente } = await supabase
    .from('pacientes')
    .select('id, nombre, obra_social, numero_afiliado, familia_id')
    .eq('id', pacienteId)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (errorPaciente) throw new Error(errorPaciente.message);
  if (!paciente) throw new Error('Paciente no encontrado en esta Prestadora');

  const { data: guardias, error: errorGuardias } = await supabase
    .from('guardias')
    .select('id, fecha, hora_inicio, hora_fin, modalidad, estado, asistente_id')
    .eq('prestadora_id', prestadoraId)
    .eq('paciente_id', pacienteId)
    .gte('fecha', periodoDesde)
    .lte('fecha', periodoHasta)
    .order('fecha', { ascending: true });
  if (errorGuardias) throw new Error(errorGuardias.message);

  // .filter(Boolean) porque una guardia puede estar sin cubrir: sin este filtro el NULL
  // llega al .in('id', …) contra una columna uuid y la consulta revienta con un 500.
  const asistenteIds = [...new Set((guardias || []).map((g) => g.asistente_id).filter(Boolean))];
  const nombresAsistente = {};
  if (asistenteIds.length > 0) {
    const { data: usuariosAsistentes } = await supabase
      .from('usuarios')
      .select('id, nombre')
      .in('id', asistenteIds);
    for (const u of usuariosAsistentes || []) nombresAsistente[u.id] = u.nombre;
  }

  const guardiasDetalle = (guardias || []).map((g) => ({
    fecha: g.fecha,
    hora_inicio: g.hora_inicio,
    hora_fin: g.hora_fin,
    modalidad: g.modalidad,
    estado: g.estado,
    asistente_nombre: nombresAsistente[g.asistente_id] || null,
  }));

  // Totales por modalidad: se agrupa por el valor real usado en cada guardia, sin catálogo
  // cerrado de códigos (ver plan aprobado — el PRD original de "Planillas IOMA" asumía una
  // codificación S4/S6/F4/F6 que nunca llegó a existir en el modelo de datos). Solo cuentan
  // las guardias efectivamente prestadas ('completada'), no las programadas/canceladas.
  const totalesPorModalidad = {};
  for (const g of guardias || []) {
    if (g.estado !== 'completada') continue;
    const horas = horasEntre(g.hora_inicio, g.hora_fin);
    if (!totalesPorModalidad[g.modalidad]) totalesPorModalidad[g.modalidad] = { cantidad_guardias: 0, horas_totales: 0 };
    totalesPorModalidad[g.modalidad].cantidad_guardias += 1;
    totalesPorModalidad[g.modalidad].horas_totales += horas;
  }

  return {
    paciente: { nombre: paciente.nombre, obra_social: paciente.obra_social, numero_afiliado: paciente.numero_afiliado },
    familia_id: paciente.familia_id,
    tipo,
    periodo_desde: periodoDesde,
    periodo_hasta: periodoHasta,
    guardias: guardiasDetalle,
    totales_por_modalidad: totalesPorModalidad,
  };
}

panelInformesObraSocialRouter.get('/preview', requiereRolPanel, async (req, res) => {
  const { paciente_id: pacienteId, tipo, periodo_desde: periodoDesde, periodo_hasta: periodoHasta } = req.query;
  if (!pacienteId || !TIPOS_INFORME.includes(tipo) || !periodoDesde || !periodoHasta) {
    return res.status(400).json({ error: 'Faltan parámetros (paciente_id, tipo, periodo_desde, periodo_hasta)' });
  }
  try {
    const contenido = await construirContenido({
      prestadoraId: req.usuarioPanel.prestadoraId,
      pacienteId,
      tipo,
      periodoDesde,
      periodoHasta,
    });
    res.json({ contenido });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

panelInformesObraSocialRouter.post('/', requiereRolPanel, requierePermiso('validar_informe_obra_social'), async (req, res) => {
  const { paciente_id: pacienteId, tipo, periodo_desde: periodoDesde, periodo_hasta: periodoHasta } = req.body;
  if (!pacienteId || !TIPOS_INFORME.includes(tipo) || !periodoDesde || !periodoHasta) {
    return res.status(400).json({ error: 'Faltan parámetros (paciente_id, tipo, periodo_desde, periodo_hasta)' });
  }

  try {
    const prestadoraId = req.usuarioPanel.prestadoraId;
    const contenido = await construirContenido({ prestadoraId, pacienteId, tipo, periodoDesde, periodoHasta });

    const { data: informe, error: errorInsert } = await supabase
      .from('informes_obra_social')
      .insert({
        prestadora_id: prestadoraId,
        paciente_id: pacienteId,
        familia_id: contenido.familia_id,
        tipo,
        periodo_desde: periodoDesde,
        periodo_hasta: periodoHasta,
        contenido,
        generado_por: req.usuarioPanel.id,
        validado_por: req.usuarioPanel.id,
      })
      .select()
      .single();
    if (errorInsert) throw new Error(errorInsert.message);

    res.json(informe);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

panelInformesObraSocialRouter.get('/', requiereRolPanel, async (req, res) => {
  const { paciente_id: pacienteId, desde, hasta } = req.query;
  let query = supabase
    .from('informes_obra_social')
    .select('id, paciente_id, tipo, periodo_desde, periodo_hasta, estado, validado_en, created_at')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('periodo_desde', { ascending: false });
  if (pacienteId) query = query.eq('paciente_id', pacienteId);
  if (desde) query = query.gte('periodo_desde', desde);
  if (hasta) query = query.lte('periodo_hasta', hasta);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

panelInformesObraSocialRouter.get('/:id', requiereRolPanel, async (req, res) => {
  const { data, error } = await supabase
    .from('informes_obra_social')
    .select('*')
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Informe no encontrado' });
  res.json(data);
});

panelInformesObraSocialRouter.post('/:id/anular', requiereRolPanel, requierePermiso('validar_informe_obra_social'), async (req, res) => {
  const { motivo } = req.body;
  if (!motivo || !motivo.trim()) {
    return res.status(400).json({ error: 'El motivo de anulación es obligatorio' });
  }

  const { data: informe } = await supabase
    .from('informes_obra_social')
    .select('id, estado')
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (!informe) return res.status(404).json({ error: 'Informe no encontrado' });
  if (informe.estado === 'anulado') {
    return res.status(400).json({ error: 'Este informe ya está anulado' });
  }

  const { data, error } = await supabase
    .from('informes_obra_social')
    .update({
      estado: 'anulado',
      motivo_anulacion: motivo,
      anulado_por: req.usuarioPanel.id,
      anulado_en: new Date().toISOString(),
    })
    .eq('id', informe.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
