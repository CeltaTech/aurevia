import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';

// Interruptor de MFA obligatorio para superadmin.
// Es configuración de plataforma, no de una prestadora puntual — por eso va en su propio
// router, separado de panelConfiguracion.js (que es admin_prestadora-scoped). Solo
// superadmin puede tocarlo, que es justamente el rol que este toggle protege
// (CLAUDE.md §5).
export const panelConfiguracionPlataformaRouter = Router();

panelConfiguracionPlataformaRouter.use(requiereRolPanel);

function requiereSuperadmin(req, res, next) {
  if (req.usuarioPanel?.rol !== 'superadmin') {
    return res.status(403).json({ error: 'Solo Superadmin puede ver o editar esta configuración' });
  }
  next();
}

panelConfiguracionPlataformaRouter.get('/mfa', requiereSuperadmin, async (req, res) => {
  const { data, error } = await supabase
    .from('configuracion_plataforma')
    .select('mfa_admin_obligatorio, updated_at')
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ configuracion: data });
});

panelConfiguracionPlataformaRouter.patch('/mfa', requiereSuperadmin, async (req, res) => {
  const { mfa_admin_obligatorio } = req.body;
  if (typeof mfa_admin_obligatorio !== 'boolean') {
    return res.status(400).json({ error: 'mfa_admin_obligatorio debe ser booleano' });
  }
  const { error } = await supabase
    .from('configuracion_plataforma')
    .update({ mfa_admin_obligatorio, actualizado_por: req.usuarioPanel.id, updated_at: new Date().toISOString() })
    .eq('id', true);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Acá no se cuenta cuántas Prestadoras hay contratadas ni se avisa por un umbral de contrataciones:
// eso es dato del negocio de CeltaTech y no del producto.
//
// El envío de correo está decidido y no se vuelve a discutir: API de Gmail por OAuth2,
// reutilizando la casilla notificaciones.aurevia@gmail.com, en pausa hasta después del MVP. El
// único punto de integración es backend/src/utils/email.js.
