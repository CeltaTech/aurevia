import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';

// Ítem G del pendiente #30 — lectura del log de auditoría de las sesiones de soporte técnico
// (tabla auditoria_soporte_tecnico). El backend usa service role, así que el filtro por rol se
// hace acá a mano en vez de delegarlo a las policies RLS de la tabla (esas policies sí rigen
// cuando algo consulta la tabla directo desde el frontend con el JWT del usuario, no a través
// de este endpoint).
export const panelAuditoriaRouter = Router();

panelAuditoriaRouter.get('/', requiereRolPanel, async (req, res) => {
  const { rol, prestadoraId } = req.usuarioPanel;

  if (!['superadmin', 'admin_prestadora'].includes(rol)) {
    return res.status(403).json({ error: 'Sin permiso para ver el log de auditoría' });
  }

  let consulta = supabase
    .from('auditoria_soporte_tecnico')
    .select('id, admin_id, prestadora_id, tipo_evento, tabla_afectada, operacion, registro_id, detalle, created_at, usuarios(nombre), prestadoras(nombre_fantasia)')
    .order('created_at', { ascending: false })
    .limit(500);

  // admin_prestadora (dueño de la Prestadora auditada) solo ve lo que pasó dentro de la
  // suya — mismo criterio que la policy RLS "admin_prestadora_lee_auditoria_de_su_prestadora".
  // Superadmin ve el log completo: es quien hace el soporte y quien tiene que poder
  // reconstruir qué se tocó en cada Prestadora.
  //
  // Ese alcance completo lo da este filtro y nada más: la consulta sale con la llave de
  // servicio, que no pasa por las reglas de la base. Del lado de la base el Superadmin ya
  // no lee el registro entero — solo el de la Prestadora donde tiene la sesión de soporte
  // abierta (policy "superadmin_lee_auditoria_de_su_sesion_activa"). Que los dos lados
  // digan cosas distintas es una diferencia abierta, anotada en docs/PENDIENTES.md.
  if (rol === 'admin_prestadora') {
    if (!prestadoraId) return res.status(403).json({ error: 'Sin prestadora asociada' });
    consulta = consulta.eq('prestadora_id', prestadoraId);
  }

  const { data, error } = await consulta;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ eventos: data });
});
