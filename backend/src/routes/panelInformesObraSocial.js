import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';
import { requierePermiso } from '../utils/permisos.js';
import { horasEntre, horasImputadasAlPaciente } from '../utils/horasDeGuardia.js';

export const panelInformesObraSocialRouter = Router();

const TIPOS_INFORME = ['planilla_asistencia', 'resumen_mensual'];

/**
 * A cuántos Pacientes cubrió cada uno de estos turnos.
 *
 * Devuelve un mapa `id de guardia → cantidad`. Hace falta para repartir las horas: un turno
 * que cubrió a dos personas no le imputa las horas enteras a cada una (ver
 * `utils/horasDeGuardia.js`).
 */
async function cuantosPacientesPorGuardia(guardiaIds) {
  if (guardiaIds.length === 0) return {};

  const { data, error } = await supabase
    .from('guardia_pacientes')
    .select('guardia_id')
    .in('guardia_id', guardiaIds);
  if (error) throw new Error(error.message);

  const cantidad = {};
  for (const fila of data || []) {
    cantidad[fila.guardia_id] = (cantidad[fila.guardia_id] || 0) + 1;
  }
  return cantidad;
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

  // Las guardias de este Paciente salen de la lista de Pacientes de cada guardia, no de la
  // columna vieja `guardias.paciente_id`: esa columna guarda UNO solo, así que en una guardia
  // compartida el informe del otro Paciente salía vacío aunque lo hubieran atendido.
  const { data: enLista, error: errorLista } = await supabase
    .from('guardia_pacientes')
    .select('guardia_id')
    .eq('paciente_id', pacienteId);
  if (errorLista) throw new Error(errorLista.message);

  const idsDeSusGuardias = [...new Set((enLista || []).map((f) => f.guardia_id))];

  let guardias = [];
  if (idsDeSusGuardias.length > 0) {
    const { data, error: errorGuardias } = await supabase
      .from('guardias')
      .select('id, fecha, hora_inicio, hora_fin, modalidad, estado, asistente_id')
      .eq('prestadora_id', prestadoraId)
      .in('id', idsDeSusGuardias)
      .gte('fecha', periodoDesde)
      .lte('fecha', periodoHasta)
      .order('fecha', { ascending: true });
    if (errorGuardias) throw new Error(errorGuardias.message);
    guardias = data || [];
  }

  const pacientesPorGuardia = await cuantosPacientesPorGuardia(guardias.map((g) => g.id));

  // .filter(Boolean) porque una guardia puede estar sin cubrir: sin este filtro el NULL
  // llega al .in('id', …) contra una columna uuid y la consulta revienta con un 500.
  const asistenteIds = [...new Set(guardias.map((g) => g.asistente_id).filter(Boolean))];
  const nombresAsistente = {};
  if (asistenteIds.length > 0) {
    const { data: usuariosAsistentes } = await supabase
      .from('usuarios')
      .select('id, nombre')
      .in('id', asistenteIds);
    for (const u of usuariosAsistentes || []) nombresAsistente[u.id] = u.nombre;
  }

  // Cada renglón lleva escrito a cuánta gente cubrió ese turno y cuántas horas le tocan a
  // este Paciente. Se muestran las dos cosas juntas a propósito: si el informe dijera
  // "cuatro horas" en un turno de ocho sin explicar por qué, parecería un error de carga.
  const guardiasDetalle = guardias.map((g) => {
    const cuantos = pacientesPorGuardia[g.id] || 1;
    return {
      fecha: g.fecha,
      hora_inicio: g.hora_inicio,
      hora_fin: g.hora_fin,
      modalidad: g.modalidad,
      estado: g.estado,
      asistente_nombre: nombresAsistente[g.asistente_id] || null,
      pacientes_en_el_turno: cuantos,
      horas_imputadas: horasImputadasAlPaciente(horasEntre(g.hora_inicio, g.hora_fin), cuantos),
    };
  });

  // Totales por modalidad: se agrupa por el valor real usado en cada guardia, sin catálogo
  // cerrado de códigos (ver plan aprobado — el PRD original de "Planillas IOMA" asumía una
  // codificación S4/S6/F4/F6 que nunca llegó a existir en el modelo de datos). Solo cuentan
  // las guardias efectivamente prestadas ('completada'), no las programadas/canceladas.
  //
  // Las horas que se suman son las IMPUTADAS a este Paciente, no las que duró el turno: un
  // turno de ocho horas para dos Pacientes aporta cuatro horas al informe de cada uno. Si se
  // sumaran las ocho a los dos, la obra social vería dieciséis horas de cuidado donde hubo
  // ocho de trabajo, o sea le estaríamos cobrando dos veces la misma hora.
  const totalesPorModalidad = {};
  for (const g of guardiasDetalle) {
    if (g.estado !== 'completada') continue;
    if (!totalesPorModalidad[g.modalidad]) totalesPorModalidad[g.modalidad] = { cantidad_guardias: 0, horas_totales: 0 };
    totalesPorModalidad[g.modalidad].cantidad_guardias += 1;
    totalesPorModalidad[g.modalidad].horas_totales += g.horas_imputadas;
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
