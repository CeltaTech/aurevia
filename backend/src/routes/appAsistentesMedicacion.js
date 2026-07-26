import { Router } from 'express';
import { requiereRolAsistente } from '../middleware/requiereRolAsistente.js';
import { supabase } from '../db/connection.js';
import { medicacionVigenteDelPaciente, tipoHabilitacionRequerida, asistenteTieneHabilitacionVigente } from '../utils/medicacionIndicaciones.js';

// Cierra pendiente #62 (docs/PENDIENTES.md): órdenes de medicación de solo lectura para el
// Asistente asignado — nunca muestra una vía que este Asistente en particular no está
// habilitado a administrar, ni siquiera de lectura (evita que "aparezca como orden" para
// quien no puede ejecutarla legalmente).

export const appAsistentesMedicacionRouter = Router();

appAsistentesMedicacionRouter.get('/:pacienteId', requiereRolAsistente, async (req, res) => {
  const { data: guardia } = await supabase
    .from('guardias')
    .select('id')
    .eq('paciente_id', req.params.pacienteId)
    .eq('asistente_id', req.usuarioAsistente.id)
    .eq('prestadora_id', req.usuarioAsistente.prestadoraId)
    .limit(1)
    .maybeSingle();
  if (!guardia) {
    return res.status(404).json({ error: 'Paciente no encontrado' });
  }

  const indicaciones = await medicacionVigenteDelPaciente(req.params.pacienteId);

  const ordenes = [];
  for (const indicacion of indicaciones) {
    const tipoRequerido = await tipoHabilitacionRequerida(req.usuarioAsistente.prestadoraId, indicacion.via_administracion);
    const habilitado = await asistenteTieneHabilitacionVigente(req.usuarioAsistente.id, tipoRequerido);
    if (habilitado) ordenes.push(indicacion);
  }

  res.json({ ordenes });
});
