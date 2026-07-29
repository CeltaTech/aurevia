import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';

// Pendiente #30, ítem H — toggle de MFA obligatorio para superadmin.
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

// Acá vivían GET y PATCH /umbral-prestadoras (pendiente #44): el umbral de Prestadoras
// certificadas a partir del cual se avisaba el riesgo de mandar todos los emails desde una
// única cuenta Gmail compartida (docs/DECISION_EMAIL_ESCALA.md). Se fueron en la Etapa 2 de la
// separación CeltaTech / Careonys (2026-07-28) junto con la columna
// configuracion_plataforma.umbral_alerta_prestadoras: contar cuántas Prestadoras hay
// contratadas es un dato del negocio de CeltaTech, no del producto. Ninguna pantalla del Panel
// los consumía (verificado en docs/ETAPA_2_INVENTARIO.md §4).
