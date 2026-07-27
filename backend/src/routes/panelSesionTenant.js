import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';

// "Modo dentro de una prestadora" — pendiente #30, docs/PLAN_MULTITENANT_CELTATECH.md 3.4.1.
// Exclusivo de admin_plataforma: entra a una prestadora licenciataria por vez, nunca
// varias a la vez. El corte por 5 min de inactividad vive en requiereRolPanel.js (se
// aplica en cada request, no solo acá).
export const panelSesionTenantRouter = Router();

// Ítem G del pendiente #30: login/logout/renovación son la parte de "todo login" del log
// de auditoría — se registran acá porque pasan por el backend (service role), no por RLS
// directo (ver schema_admin_plataforma_03_auditoria.sql). No bloquea la respuesta al
// frontend si falla: la auditoría no debe poder tumbar el flujo real de sesión.
async function registrarAuditoria({ adminId, prestadoraId, tipoEvento, detalle }) {
  const { error } = await supabase.from('auditoria_admin_plataforma').insert({
    admin_id: adminId,
    prestadora_id: prestadoraId,
    tipo_evento: tipoEvento,
    detalle: detalle || null,
  });
  if (error) console.error('Error registrando auditoría admin_plataforma:', error.message);
}

const SESION_DURACION_MS = 60 * 60 * 1000; // tope absoluto de 60 min, extendido por /renovar
const INACTIVIDAD_LIMITE_MS = 5 * 60 * 1000; // debe coincidir con requiereRolPanel.js

function requiereAdminPlataforma(req, res, next) {
  if (req.usuarioPanel?.rol !== 'admin_plataforma') {
    return res.status(403).json({ error: 'Solo admin_plataforma tiene modo dentro de una prestadora' });
  }
  next();
}

// Este endpoint es el que el frontend hace polling cada 30s (TenantSessionContext) — por eso
// es el que efectivamente cierra (salida_at) una sesión vencida por tope absoluto o por
// inactividad, así el banner desaparece solo sin que el usuario tenga que hacer nada.
async function buscarSesionVigenteYCerrarSiVencio(adminId) {
  const { data: sesion, error } = await supabase
    .from('sesiones_tenant_admin_plataforma')
    .select('id, prestadora_id, entrada_at, expira_at, ultima_actividad_at, prestadoras(nombre_fantasia)')
    .eq('admin_id', adminId)
    .is('salida_at', null)
    .order('entrada_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!sesion) return null;

  const ahora = new Date();
  const vencioPorTope = new Date(sesion.expira_at) <= ahora;
  const vencioPorInactividad = ahora.getTime() - new Date(sesion.ultima_actividad_at).getTime() > INACTIVIDAD_LIMITE_MS;

  if (vencioPorTope || vencioPorInactividad) {
    await supabase.from('sesiones_tenant_admin_plataforma').update({ salida_at: ahora.toISOString() }).eq('id', sesion.id);
    await registrarAuditoria({
      adminId,
      prestadoraId: sesion.prestadora_id,
      tipoEvento: 'logout',
      detalle: { motivo: vencioPorTope ? 'tope_60min' : 'inactividad_5min' },
    });
    return null;
  }
  return sesion;
}

panelSesionTenantRouter.get('/', requiereRolPanel, requiereAdminPlataforma, async (req, res) => {
  try {
    const sesion = await buscarSesionVigenteYCerrarSiVencio(req.usuarioPanel.id);
    res.json({ sesion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

panelSesionTenantRouter.post('/actividad', requiereRolPanel, requiereAdminPlataforma, async (req, res) => {
  try {
    const sesion = await buscarSesionVigenteYCerrarSiVencio(req.usuarioPanel.id);
    if (!sesion) return res.json({ ok: true, sesion: null });

    const { error } = await supabase
      .from('sesiones_tenant_admin_plataforma')
      .update({ ultima_actividad_at: new Date().toISOString() })
      .eq('id', sesion.id);

    if (error) return res.status(500).json({ error: error.message });
    res.json({ ok: true, sesion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

panelSesionTenantRouter.post('/', requiereRolPanel, requiereAdminPlataforma, async (req, res) => {
  const { prestadora_id } = req.body;
  if (!prestadora_id) {
    return res.status(400).json({ error: 'Falta prestadora_id' });
  }

  const { data: sesionVigente } = await supabase
    .from('sesiones_tenant_admin_plataforma')
    .select('id')
    .eq('admin_id', req.usuarioPanel.id)
    .is('salida_at', null)
    .maybeSingle();

  if (sesionVigente) {
    return res.status(409).json({ error: 'Ya hay una sesión de prestadora activa — salí primero para entrar a otra' });
  }

  const { data: prestadora } = await supabase.from('prestadoras').select('id').eq('id', prestadora_id).maybeSingle();
  if (!prestadora) {
    return res.status(404).json({ error: 'Prestadora inexistente' });
  }

  const ahora = new Date();
  const { data: sesion, error } = await supabase
    .from('sesiones_tenant_admin_plataforma')
    .insert({
      admin_id: req.usuarioPanel.id,
      prestadora_id,
      entrada_at: ahora.toISOString(),
      ultima_actividad_at: ahora.toISOString(),
      expira_at: new Date(ahora.getTime() + SESION_DURACION_MS).toISOString(),
    })
    .select('prestadora_id, entrada_at, expira_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });
  await registrarAuditoria({ adminId: req.usuarioPanel.id, prestadoraId: prestadora_id, tipoEvento: 'login' });
  res.json({ ok: true, sesion });
});

panelSesionTenantRouter.post('/renovar', requiereRolPanel, requiereAdminPlataforma, async (req, res) => {
  try {
    const sesion = await buscarSesionVigenteYCerrarSiVencio(req.usuarioPanel.id);
    if (!sesion) {
      return res.status(409).json({ error: 'No hay sesión de prestadora activa para renovar' });
    }

    const ahora = new Date();
    const { error } = await supabase
      .from('sesiones_tenant_admin_plataforma')
      .update({
        ultima_actividad_at: ahora.toISOString(),
        expira_at: new Date(ahora.getTime() + SESION_DURACION_MS).toISOString(),
      })
      .eq('id', sesion.id);

    if (error) return res.status(500).json({ error: error.message });
    await registrarAuditoria({ adminId: req.usuarioPanel.id, prestadoraId: sesion.prestadora_id, tipoEvento: 'renovacion' });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

panelSesionTenantRouter.post('/salir', requiereRolPanel, requiereAdminPlataforma, async (req, res) => {
  const { data: sesionSaliente } = await supabase
    .from('sesiones_tenant_admin_plataforma')
    .select('prestadora_id')
    .eq('admin_id', req.usuarioPanel.id)
    .is('salida_at', null)
    .maybeSingle();

  const { error } = await supabase
    .from('sesiones_tenant_admin_plataforma')
    .update({ salida_at: new Date().toISOString() })
    .eq('admin_id', req.usuarioPanel.id)
    .is('salida_at', null);

  if (error) return res.status(500).json({ error: error.message });
  if (sesionSaliente) {
    await registrarAuditoria({ adminId: req.usuarioPanel.id, prestadoraId: sesionSaliente.prestadora_id, tipoEvento: 'logout', detalle: { motivo: 'manual' } });
  }
  res.json({ ok: true });
});
