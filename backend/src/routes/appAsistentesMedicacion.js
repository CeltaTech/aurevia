import { Router } from 'express';
import { requiereRolAsistente } from '../middleware/requiereRolAsistente.js';
import { medicacionVigenteDelPaciente, tipoMatriculaRequerida, asistenteTieneMatriculaVigente } from '../utils/medicacionIndicaciones.js';
import { asistenteAtiendeAlPaciente } from '../utils/pacientesDeGuardia.js';
import { exigeVisible } from '../utils/visibilidadPrestadora.js';

// Cierra pendiente #62 (docs/PENDIENTES.md): órdenes de medicación de solo lectura para el
// Asistente asignado — nunca muestra una vía que este Asistente en particular no está
// habilitado a administrar, ni siquiera de lectura (evita que "aparezca como orden" para
// quien no puede ejecutarla legalmente).

export const appAsistentesMedicacionRouter = Router();

appAsistentesMedicacionRouter.get('/:pacienteId', requiereRolAsistente, exigeVisible('asistente_medicacion_del_paciente'), async (req, res) => {
  // El permiso se pregunta contra la lista de Pacientes de la guardia, no contra la columna
  // vieja: el segundo Paciente de una guardia compartida también es un Paciente que este Asistente
  // atiende, y sus órdenes de medicación tienen que estar a la vista.
  if (!(await asistenteAtiendeAlPaciente(req.params.pacienteId, req.usuarioAsistente))) {
    return res.status(404).json({ error: 'Paciente no encontrado' });
  }

  const indicaciones = await medicacionVigenteDelPaciente(req.params.pacienteId);

  const ordenes = [];
  for (const indicacion of indicaciones) {
    const tipoRequerido = await tipoMatriculaRequerida(req.usuarioAsistente.prestadoraId, indicacion.via_administracion);
    const habilitado = await asistenteTieneMatriculaVigente(req.usuarioAsistente.id, tipoRequerido);
    if (habilitado) ordenes.push(indicacion);
  }

  res.json({ ordenes });
});
