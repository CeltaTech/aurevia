import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';
import { responderError } from '../utils/errorConMotivo.js';

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
  if (error) return responderError(res, error);
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
  if (error) return responderError(res, error);
  res.json({ ok: true });
});

// Cuánto correo salió, contra el tope del despachante.
//
// El tope no se escribe acá: es del plan contratado y cambia sin tocar una línea de código.
// Sin las dos variables no hay contra qué comparar, y entonces se devuelve el conteo y ningún
// tope, en vez de inventar uno.
function topeDeCorreo(variable) {
  const valor = Number.parseInt(process.env[variable] ?? '', 10);
  return Number.isInteger(valor) && valor > 0 ? valor : null;
}

async function cuantosCorreosDesde(desde) {
  const { count, error } = await supabase
    .from('envios_de_correo')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', desde.toISOString());
  if (error) throw error;
  return count ?? 0;
}

panelConfiguracionPlataformaRouter.get('/correos', requiereSuperadmin, async (req, res) => {
  // Los dos períodos son los del despachante: el día corrido y el mes corrido, contados desde
  // el arranque de cada uno en horario universal, que es como los cuenta él.
  const ahora = new Date();
  const arranqueDelDia = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), ahora.getUTCDate()));
  const arranqueDelMes = new Date(Date.UTC(ahora.getUTCFullYear(), ahora.getUTCMonth(), 1));

  try {
    const [delDia, delMes] = await Promise.all([
      cuantosCorreosDesde(arranqueDelDia),
      cuantosCorreosDesde(arranqueDelMes),
    ]);
    res.json({
      correos: {
        del_dia: delDia,
        del_mes: delMes,
        tope_diario: topeDeCorreo('TOPE_CORREOS_DIARIO'),
        tope_mensual: topeDeCorreo('TOPE_CORREOS_MENSUAL'),
      },
    });
  } catch (error) {
    responderError(res, error);
  }
});

// Acá no se cuenta cuántas Prestadoras hay contratadas ni se avisa por un umbral de contrataciones:
// eso es dato del negocio de CeltaTech y no del producto.
//
// El envío de correo está decidido y no se vuelve a discutir: sale por un despachante que habla
// por el puerto 443, porque Railway bloquea los de correo. El único punto de integración es
// backend/src/utils/email.js.
