import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { acotarAPrestadora, exigirOrganizacionActiva } from '../middleware/alcancePrestadora.js';
import { supabase } from '../db/connection.js';
import {
  crearCuentaConPerfil,
  borrarCuenta,
  crearAsistenteDirecto,
  crearFamiliaDirecta,
  invitarMiembroCirculo,
  revocarMiembroCirculo,
  validarTipoAsistente,
} from '../utils/cuentasPanel.js';
import { reenviarActivacionCuenta } from '../utils/activacionCuenta.js';
import { tienePermiso, ACCIONES_PERMISOS } from '../utils/permisos.js';

export const panelCuentasRouter = Router();

// Crear una cuenta real (Auth + perfil) es una acción sensible y difícil de revertir —
// se restringe a Admin/Superadmin, a diferencia del resto del panel que también admite Coordinador.
function requiereAdmin(req, res, next) {
  if (!['admin_prestadora', 'superadmin'].includes(req.usuarioPanel?.rol)) {
    return res.status(403).json({ error: 'Solo Admin puede crear cuentas' });
  }
  next();
}

// Alta desde Postulación/Solicitud (rutas /familia y /asistente, más abajo) se queda
// admin-only sin cambios — el motor de permisos de la Fase 2 (docs/PENDIENTES.md, plan
// aprobado) solo cubre el alta manual (/familia-directa y /asistente-directo), que es lo
// que el plan pidió hacer configurable para Coordinador.
function requierePermiso(accion) {
  return async (req, res, next) => {
    const permitido = await tienePermiso({
      accion,
      rol: req.usuarioPanel?.rol,
      usuarioId: req.usuarioPanel?.id,
      prestadoraId: req.usuarioPanel?.prestadoraId,
    });
    if (!permitido) {
      return res.status(403).json({ error: 'La Prestadora no habilitó esta acción' });
    }
    next();
  };
}

// Usado por el frontend (botones "Nuevo Asistente"/"Nueva Familia", campos de edición de
// Fase 1) para saber qué mostrar sin duplicar la lógica de permisos en el cliente — la
// única fuente de verdad sigue siendo este chequeo del lado del servidor.
panelCuentasRouter.get('/permisos-efectivos', requiereRolPanel, async (req, res) => {
  const resultados = await Promise.all(
    ACCIONES_PERMISOS.map((accion) =>
      tienePermiso({
        accion,
        rol: req.usuarioPanel.rol,
        usuarioId: req.usuarioPanel.id,
        prestadoraId: req.usuarioPanel.prestadoraId,
      })
    )
  );
  res.json({ permisos: Object.fromEntries(ACCIONES_PERMISOS.map((accion, i) => [accion, resultados[i]])) });
});

// PRD_08 (docs/PRD_08_Dashboard_Modalidades.md, aprobado 2026-07-24): qué modalidades de
// negocio (directa/marketplace/subcontratacion) tiene activas la Prestadora, para que el menú
// del Panel muestre solo los grupos que correspondan. Lectura disponible para cualquier rol
// logueado (igual que permisos-efectivos) — activar/desactivar sigue siendo exclusivo de
// admin_prestadora vía PATCH /api/panel/configuracion/modalidades (panelConfiguracion.js).
panelCuentasRouter.get('/modalidades-activas', requiereRolPanel, async (req, res) => {
  if (!req.usuarioPanel.prestadoraId) {
    return res.json({ modalidades: [] });
  }
  const { data, error } = await supabase
    .from('prestadora_modalidades')
    .select('modalidad')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .eq('activa', true);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ modalidades: (data || []).map((f) => f.modalidad) });
});

panelCuentasRouter.post('/familia', requiereRolPanel, exigirOrganizacionActiva, requiereAdmin, async (req, res) => {
  const { solicitudId } = req.body;
  if (!solicitudId) {
    return res.status(400).json({ error: 'Falta solicitudId' });
  }

  let querySolicitud = supabase.from('solicitudes').select('*').eq('id', solicitudId);
  querySolicitud = acotarAPrestadora(querySolicitud, req.usuarioPanel);
  const { data: solicitud, error: errorSolicitud } = await querySolicitud.single();

  if (errorSolicitud || !solicitud) {
    return res.status(404).json({ error: 'Solicitud no encontrada' });
  }
  if (solicitud.familia_id) {
    return res.status(409).json({ error: 'Esta solicitud ya tiene una Familia asociada' });
  }

  const prestadoraId = req.usuarioPanel.prestadoraId;

  let familiaId;
  try {
    ({ userId: familiaId } = await crearCuentaConPerfil({
      email: solicitud.email,
      nombre: solicitud.nombre,
      telefono: solicitud.telefono,
      rol: 'familia',
      prestadoraId,
      enviarActivacion: true,
    }));

    const { error: errorFamilia } = await supabase
      .from('familias')
      .insert({ id: familiaId, solicitud_id: solicitudId, prestadora_id: prestadoraId });
    if (errorFamilia) throw new Error(errorFamilia.message);

    const { data: paciente, error: errorPaciente } = await supabase
      .from('pacientes')
      .insert({
        familia_id: familiaId,
        nombre: solicitud.nombre_paciente || solicitud.nombre,
        domicilio: solicitud.localidad,
        prestadora_id: prestadoraId,
      })
      .select()
      .single();
    if (errorPaciente) throw new Error(errorPaciente.message);

    // SEGURIDAD: depende de que el SELECT de arriba (línea ~23) ya haya validado que
    // `solicitudId` pertenece al tenant del solicitante — no llamar este UPDATE con un
    // id que no haya pasado por ese filtro.
    const { error: errorUpdate } = await supabase
      .from('solicitudes')
      .update({ familia_id: familiaId })
      .eq('id', solicitudId);
    if (errorUpdate) throw new Error(errorUpdate.message);

    res.json({ ok: true, familiaId, pacienteId: paciente.id });
  } catch (error) {
    if (familiaId) {
      await supabase.from('pacientes').delete().eq('familia_id', familiaId);
      await supabase.from('familias').delete().eq('id', familiaId);
      await borrarCuenta(familiaId, { prestadoraId });
    }
    res.status(500).json({ error: error.message });
  }
});

// Alta manual de Familia+Paciente (sin Solicitud previa) — cubre el caso de una
// Prestadora que llega a Careonys con una cartera de familias ya en atención.
// Se crea igual una fila de `solicitudes` (canal 'alta_manual') para que el contacto
// de la Familia siga viviendo en un único lugar (evita reproducir el bug de contacto
// en blanco que tenían las Familias sembradas sin solicitud vinculada).
panelCuentasRouter.post('/familia-directa', requiereRolPanel, exigirOrganizacionActiva, requierePermiso('alta_manual_familia'), async (req, res) => {
  const { nombreContacto, telefono, email, localidad, nombrePaciente, domicilioPaciente } = req.body;
  try {
    const { familiaId, pacienteId } = await crearFamiliaDirecta({
      nombreContacto, telefono, email, localidad, nombrePaciente, domicilioPaciente,
      prestadoraId: req.usuarioPanel.prestadoraId,
    });
    res.json({ ok: true, familiaId, pacienteId });
  } catch (error) {
    res.status(error.message.startsWith('Faltan datos') ? 400 : 500).json({ error: error.message });
  }
});

// Inicia el Proceso de Incorporación de Asistentes (uso interno del Panel, ver glosario
// de CLAUDE.md): crea la cuenta real de Asistente a partir de una postulación aprobada,
// y registra las etapas de verificacion_asistente configuradas por esa Prestadora
// (pendiente #18 candidato 7, docs/PENDIENTES.md — cada Prestadora define su propio plan
// de incorporación en etapas_incorporacion_asistente, ya no hay 5 etapas fijas para todas).
// La primera etapa (menor "orden") queda aprobada de entrada porque ya se cumplió: es la
// postulación misma, que ya pasó.
panelCuentasRouter.post('/asistente', requiereRolPanel, exigirOrganizacionActiva, requiereAdmin, async (req, res) => {
  // `tipo_asistente_id` es obligatorio: el tipo decide si a esta persona se le va a exigir
  // Matrícula vigente para poder atender. Lo elige quien aprueba, mirando la postulación —
  // no se adivina a partir del texto que la persona escribió en el formulario público.
  const { postulacionId, tipo_asistente_id } = req.body;
  if (!postulacionId) {
    return res.status(400).json({ error: 'Falta postulacionId' });
  }
  if (!tipo_asistente_id) {
    return res.status(400).json({ error: 'Falta indicar el tipo de Asistente' });
  }

  let queryPostulacion = supabase.from('postulaciones').select('*').eq('id', postulacionId);
  queryPostulacion = acotarAPrestadora(queryPostulacion, req.usuarioPanel);
  const { data: postulacion, error: errorPostulacion } = await queryPostulacion.single();

  if (errorPostulacion || !postulacion) {
    return res.status(404).json({ error: 'Postulación no encontrada' });
  }
  if (postulacion.asistente_id) {
    return res.status(409).json({ error: 'Esta postulación ya tiene un Asistente asociado' });
  }

  const prestadoraId = req.usuarioPanel.prestadoraId;

  let asistenteId;
  try {
    const tipoAsistenteId = await validarTipoAsistente(tipo_asistente_id, prestadoraId);

    ({ userId: asistenteId } = await crearCuentaConPerfil({
      email: postulacion.email,
      nombre: postulacion.nombre,
      telefono: postulacion.telefono,
      rol: 'asistente',
      zonas: postulacion.zonas.split(',').map((z) => z.trim()).filter(Boolean),
      prestadoraId,
      enviarActivacion: true,
    }));

    const { error: errorAsistente } = await supabase.from('asistentes').insert({
      id: asistenteId,
      nombre: postulacion.nombre,
      dni: postulacion.dni,
      telefono: postulacion.telefono,
      email: postulacion.email,
      tipo_asistente_id: tipoAsistenteId,
      zonas: postulacion.zonas.split(',').map((z) => z.trim()).filter(Boolean),
      estado: 'inactivo',
      prestadora_id: prestadoraId,
    });
    if (errorAsistente) throw new Error(errorAsistente.message);

    const { data: etapas, error: errorEtapas } = await supabase
      .from('etapas_incorporacion_asistente')
      .select('clave')
      .eq('prestadora_id', prestadoraId)
      .eq('activa', true)
      .order('orden');
    if (errorEtapas) throw new Error(errorEtapas.message);
    if (!etapas || etapas.length === 0) {
      throw new Error('Esta Prestadora no tiene etapas de incorporación configuradas (Configuración > Servicios).');
    }

    const filasVerificacion = etapas.map(({ clave }, indice) => ({
      asistente_id: asistenteId,
      etapa: clave,
      estado: indice === 0 ? 'aprobada' : 'pendiente',
      revisado_por: indice === 0 ? req.usuarioPanel.id : null,
      completado_en: indice === 0 ? new Date().toISOString() : null,
    }));
    const { error: errorVerificaciones } = await supabase.from('verificaciones_asistente').insert(filasVerificacion);
    if (errorVerificaciones) throw new Error(errorVerificaciones.message);

    // SEGURIDAD: depende de que el SELECT de arriba (línea ~100) ya haya validado que
    // `postulacionId` pertenece al tenant del solicitante — no llamar este UPDATE con un
    // id que no haya pasado por ese filtro.
    const { error: errorUpdate } = await supabase
      .from('postulaciones')
      .update({ asistente_id: asistenteId })
      .eq('id', postulacionId);
    if (errorUpdate) throw new Error(errorUpdate.message);

    res.json({ ok: true, asistenteId });
  } catch (error) {
    if (asistenteId) {
      await supabase.from('verificaciones_asistente').delete().eq('asistente_id', asistenteId);
      await supabase.from('asistentes').delete().eq('id', asistenteId);
      await borrarCuenta(asistenteId, { prestadoraId });
    }
    res.status(500).json({ error: error.message });
  }
});

// Alta manual de Asistente (sin Postulación previa) — cubre el caso de una Prestadora
// que llega a Careonys con un equipo que ya venía trabajando desde antes. Entra activo
// por defecto y, a diferencia de /asistente, no genera filas en `verificaciones_asistente`
// (equivalente al default 'omitir' del pendiente #18 — política de verificación por
// prestadora; la Fase 2 de este trabajo suma la configuración para cambiar este comportamiento).
panelCuentasRouter.post('/asistente-directo', requiereRolPanel, exigirOrganizacionActiva, requierePermiso('alta_manual_asistente'), async (req, res) => {
  const { nombre, telefono, email, dni, tipo_asistente_id, zonas, estado, tipo_vinculo, categoria_cct, valor_hora, sueldo_basico, horas_semanales } = req.body;
  try {
    const { asistenteId } = await crearAsistenteDirecto({
      nombre, telefono, email, dni, tipo_asistente_id, zonas, estado,
      tipo_vinculo, categoria_cct, valor_hora, sueldo_basico, horas_semanales,
      prestadoraId: req.usuarioPanel.prestadoraId,
      usuarioPanelId: req.usuarioPanel.id,
    });
    res.json({ ok: true, asistenteId });
  } catch (error) {
    res.status(error.message.startsWith('Faltan datos') ? 400 : 500).json({ error: error.message });
  }
});

// ============================================================================
// Círculo de cuidado (Fase 5) — reutiliza el permiso 'editar_datos_familia' ya existente:
// gestionar quién más tiene acceso a la Familia es parte de administrar sus datos, no una
// acción nueva (ver docs/claude_history.md).
// ============================================================================

panelCuentasRouter.get('/familia/:familiaId/circulo', requiereRolPanel, exigirOrganizacionActiva, requierePermiso('editar_datos_familia'), async (req, res) => {
  let queryFamilia = supabase.from('familias').select('id').eq('id', req.params.familiaId);
  queryFamilia = acotarAPrestadora(queryFamilia, req.usuarioPanel);
  const { data: familia } = await queryFamilia.maybeSingle();
  if (!familia) {
    return res.status(404).json({ error: 'Familia no encontrada' });
  }

  const { data: miembros, error } = await supabase
    .from('miembros_familia')
    .select('usuario_id, email, rol, created_at, usuarios!miembros_familia_usuario_id_fkey(nombre)')
    .eq('familia_id', req.params.familiaId)
    .order('created_at', { ascending: true });
  if (error) {
    return res.status(500).json({ error: error.message });
  }

  res.json({ miembros: miembros || [] });
});

panelCuentasRouter.post('/familia/:familiaId/circulo', requiereRolPanel, exigirOrganizacionActiva, requierePermiso('editar_datos_familia'), async (req, res) => {
  const { nombre, email, telefono } = req.body || {};
  const prestadoraId = req.usuarioPanel.prestadoraId;

  let queryFamilia = supabase.from('familias').select('id').eq('id', req.params.familiaId);
  queryFamilia = acotarAPrestadora(queryFamilia, req.usuarioPanel);
  const { data: familia } = await queryFamilia.maybeSingle();
  if (!familia) {
    return res.status(404).json({ error: 'Familia no encontrada' });
  }

  try {
    const { miembroId } = await invitarMiembroCirculo({
      email,
      nombre,
      telefono,
      familiaId: req.params.familiaId,
      prestadoraId,
      invitadoPor: req.usuarioPanel.id,
    });
    res.json({ ok: true, usuarioId: miembroId });
  } catch (error) {
    res.status(error.message.startsWith('Faltan datos') ? 400 : 500).json({ error: error.message });
  }
});

panelCuentasRouter.delete('/familia/:familiaId/circulo/:usuarioId', requiereRolPanel, requierePermiso('editar_datos_familia'), async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;

  let queryFamilia = supabase.from('familias').select('id').eq('id', req.params.familiaId);
  queryFamilia = acotarAPrestadora(queryFamilia, req.usuarioPanel);
  const { data: familia } = await queryFamilia.maybeSingle();
  if (!familia) {
    return res.status(404).json({ error: 'Familia no encontrada' });
  }

  try {
    await revocarMiembroCirculo(req.params.usuarioId, { prestadoraId, familiaId: req.params.familiaId });
    res.json({ ok: true });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Reenviar el email de activación (pendiente #75) — cubre el token vencido (7 días) o
// simplemente extraviado. Solo para Familia/Asistente/Círculo (mismo alcance que el envío
// automático de crearCuentaConPerfil); Coordinador/Admin/Superadmin siguen con el flujo
// manual de panelUsuarios.js y no tienen esta ruta disponible.
panelCuentasRouter.post('/:usuarioId/reenviar-activacion', requiereRolPanel, exigirOrganizacionActiva, requiereAdmin, async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;

  let queryUsuario = supabase.from('usuarios').select('id, rol, prestadora_id').eq('id', req.params.usuarioId);
  queryUsuario = acotarAPrestadora(queryUsuario, req.usuarioPanel);
  const { data: usuario } = await queryUsuario.maybeSingle();

  if (!usuario) {
    return res.status(404).json({ error: 'Cuenta no encontrada' });
  }
  if (!['familia', 'asistente'].includes(usuario.rol)) {
    return res.status(400).json({ error: 'Esta cuenta no usa el flujo de activación por email' });
  }

  try {
    await reenviarActivacionCuenta(usuario.id);
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
