import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';

// Listado de prestadoras licenciatarias — pendiente #30, ítem I.
// Solo superadmin tiene uso legítimo de esto:
// para elegir a cuál Prestadora entrar con una sesión de soporte técnico, y para elegir la
// prestadora_id al dar de alta el primer admin_prestadora de una Prestadora nueva
// (pendiente #26). Admin_prestadora/coordinador no ven otras Prestadoras bajo ninguna
// circunstancia (CLAUDE.md glosario).
export const panelPrestadorasRouter = Router();

function requiereSuperadmin(req, res, next) {
  if (req.usuarioPanel?.rol !== 'superadmin') {
    return res.status(403).json({ error: 'Solo Superadmin puede ver la lista de Prestadoras' });
  }
  next();
}

panelPrestadorasRouter.get('/', requiereRolPanel, requiereSuperadmin, async (req, res) => {
  const { data, error } = await supabase
    .from('prestadoras')
    .select('id, nombre_fantasia, estado')
    .order('nombre_fantasia', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json({ prestadoras: data });
});
