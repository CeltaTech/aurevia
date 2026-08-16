// Pendiente #85 (docs/PENDIENTES.md), Grupo 3 Marketplace — rutas del Panel: pasarela de
// pago por Prestadora, suscripciones/cobros, calificaciones con descargo, y la auditoría de
// advertencias legales de marketplace. Mismo patrón de scoping por prestadora_id/rol que
// panelConfiguracion.js.

import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';
import { proveedoresDisponibles, obtenerAdaptador } from '../pasarelas/index.js';
import { tokenQrCobroValido } from '../utils/qrCobroEfectivo.js';

export const panelMarketplaceRouter = Router();

panelMarketplaceRouter.use(requiereRolPanel);

function requiereAdminOSuperior(req, res, next) {
  if (!['admin_prestadora', 'coordinador', 'superadmin'].includes(req.usuarioPanel?.rol)) {
    return res.status(403).json({ error: 'Rol sin permiso' });
  }
  if (!req.usuarioPanel.prestadoraId) {
    return res.status(400).json({ error: 'Hace falta entrar a una prestadora antes de operar sobre marketplace' });
  }
  next();
}

panelMarketplaceRouter.use(requiereAdminOSuperior);

// ============================================================================
// Pasarela de pago — la Prestadora activa uno o varios de los 6 rieles, cada uno con su
// propia credencial (Supabase Vault, ver schema_marketplace_pasarelas_01.sql). El secreto
// nunca se vuelve a mostrar una vez guardado, mismo criterio que WhatsApp.
// ============================================================================

panelMarketplaceRouter.get('/pasarela', async (req, res) => {
  const { data, error } = await supabase
    .from('prestadora_pasarela_pago')
    .select('proveedor, estado_conexion, conectada_en, updated_at')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId);
  if (error) return res.status(500).json({ error: error.message });

  const activados = new Map(data.map((fila) => [fila.proveedor, fila]));
  const pasarelas = proveedoresDisponibles().map((proveedor) => ({
    proveedor,
    activo: activados.has(proveedor),
    estado_conexion: activados.get(proveedor)?.estado_conexion ?? null,
    conectada_en: activados.get(proveedor)?.conectada_en ?? null,
  }));

  res.json({ pasarelas });
});

panelMarketplaceRouter.patch('/pasarela/:proveedor', async (req, res) => {
  const { proveedor } = req.params;
  const { activo, credencial } = req.body || {};

  if (!proveedoresDisponibles().includes(proveedor)) {
    return res.status(400).json({ error: 'Proveedor desconocido' });
  }

  if (activo === false) {
    const { error } = await supabase
      .from('prestadora_pasarela_pago')
      .delete()
      .eq('prestadora_id', req.usuarioPanel.prestadoraId)
      .eq('proveedor', proveedor);
    if (error) return res.status(500).json({ error: error.message });
    return res.json({ ok: true });
  }

  const requiereCredencial = proveedor !== 'efectivo_manual';
  if (requiereCredencial && credencial) {
    const { error: errorCredencial } = await supabase.rpc('guardar_credencial_pasarela_pago', {
      p_prestadora_id: req.usuarioPanel.prestadoraId,
      p_proveedor: proveedor,
      p_credencial: credencial,
    });
    if (errorCredencial) return res.status(500).json({ error: errorCredencial.message });
  }

  const { error } = await supabase.from('prestadora_pasarela_pago').upsert(
    {
      prestadora_id: req.usuarioPanel.prestadoraId,
      proveedor,
      estado_conexion: requiereCredencial ? 'conectada' : 'conectada',
      activada_por: req.usuarioPanel.id,
      conectada_en: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'prestadora_id,proveedor' }
  );
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

// ============================================================================
// Suscripciones y cobros
// ============================================================================

// Nombres legibles de Familia/Paciente/Asistente en consultas separadas (no un único JOIN
// embebido): familia_id apunta a familias.id, que a su vez comparte id con usuarios.id, así
// que el nombre real vive en usuarios — resolverlo acá evita mostrar UUID crudo en el Panel
// (CLAUDE.md §7 regla 7, "sin datos crudos").
panelMarketplaceRouter.get('/suscripciones', async (req, res) => {
  const { data, error } = await supabase
    .from('suscripciones_marketplace')
    .select('id, familia_id, paciente_id, asistente_id, estado, monto_mensual, trial_fin, proximo_cobro, cancelada_en, created_at')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const familiaIds = [...new Set(data.map((s) => s.familia_id).filter(Boolean))];
  const pacienteIds = [...new Set(data.map((s) => s.paciente_id).filter(Boolean))];
  const asistenteIds = [...new Set(data.map((s) => s.asistente_id).filter(Boolean))];

  const [{ data: usuariosFamilia }, { data: pacientes }, { data: asistentes }] = await Promise.all([
    familiaIds.length ? supabase.from('usuarios').select('id, nombre').in('id', familiaIds) : { data: [] },
    pacienteIds.length ? supabase.from('pacientes').select('id, nombre').in('id', pacienteIds) : { data: [] },
    asistenteIds.length ? supabase.from('asistentes').select('id, nombre').in('id', asistenteIds) : { data: [] },
  ]);

  const nombreFamilia = new Map((usuariosFamilia || []).map((u) => [u.id, u.nombre]));
  const nombrePaciente = new Map((pacientes || []).map((p) => [p.id, p.nombre]));
  const nombreAsistente = new Map((asistentes || []).map((a) => [a.id, a.nombre]));

  const suscripciones = data.map((s) => ({
    ...s,
    familia_nombre: nombreFamilia.get(s.familia_id) || null,
    paciente_nombre: nombrePaciente.get(s.paciente_id) || null,
    asistente_nombre: s.asistente_id ? nombreAsistente.get(s.asistente_id) || null : null,
  }));

  res.json({ suscripciones });
});

panelMarketplaceRouter.get('/suscripciones/:id/cobros', async (req, res) => {
  const { data, error } = await supabase
    .from('cobros_marketplace')
    .select('id, medio, monto, periodo, estado_cobro, referencia_externa, fecha_cobro, registrado_por, created_at')
    .eq('suscripcion_id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('periodo', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ cobros: data });
});

// Carga manual de efectivo en mano — mitigante central del riesgo de suspensión indebida
// por cobro no reflejado a tiempo en el sistema (docs/PENDIENTES.md #85). fecha_cobro es la
// fecha real del hecho, nunca la de carga (CLAUDE.md §3).
panelMarketplaceRouter.post('/cobros/efectivo-manual', async (req, res) => {
  const { suscripcion_id: suscripcionId, monto, periodo, fecha_cobro: fechaCobro } = req.body || {};
  if (!suscripcionId || !monto || !periodo || !fechaCobro) {
    return res.status(400).json({ error: 'Faltan suscripcion_id, monto, periodo o fecha_cobro' });
  }

  const { data: suscripcion } = await supabase
    .from('suscripciones_marketplace')
    .select('id')
    .eq('id', suscripcionId)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (!suscripcion) {
    return res.status(404).json({ error: 'Suscripción no encontrada' });
  }

  const { error } = await supabase.from('cobros_marketplace').insert({
    suscripcion_id: suscripcionId,
    prestadora_id: req.usuarioPanel.prestadoraId,
    medio: 'efectivo_manual',
    monto,
    periodo,
    estado_cobro: 'exitoso',
    fecha_cobro: fechaCobro,
    registrado_por: req.usuarioPanel.id,
  });
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

// Canje del QR de cobro en efectivo escaneado por el cobrador — validación de firma/
// vencimiento/uso único acá, nunca como UPDATE directo desde la PWA (CLAUDE.md §6).
panelMarketplaceRouter.post('/qr-cobro/canjear', async (req, res) => {
  const { token } = req.body || {};
  if (!token || !tokenQrCobroValido(token)) {
    return res.status(400).json({ error: 'QR inválido o vencido' });
  }

  const { data: qr } = await supabase
    .from('qr_cobro_efectivo')
    .select('id, suscripcion_id, monto, periodo, expira_en, usado_en')
    .eq('token', token)
    .maybeSingle();
  if (!qr) {
    return res.status(404).json({ error: 'QR no encontrado' });
  }
  if (qr.usado_en) {
    return res.status(409).json({ error: 'Este QR ya fue usado' });
  }
  if (new Date(qr.expira_en) < new Date()) {
    return res.status(410).json({ error: 'Este QR venció, hace falta pedirle a la Familia que genere uno nuevo' });
  }

  const { data: suscripcion } = await supabase
    .from('suscripciones_marketplace')
    .select('id')
    .eq('id', qr.suscripcion_id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (!suscripcion) {
    return res.status(404).json({ error: 'La suscripción de este QR no pertenece a esta Prestadora' });
  }

  const { data: cobro, error: errorCobro } = await supabase
    .from('cobros_marketplace')
    .insert({
      suscripcion_id: qr.suscripcion_id,
      prestadora_id: req.usuarioPanel.prestadoraId,
      medio: 'efectivo_manual',
      monto: qr.monto,
      periodo: qr.periodo,
      estado_cobro: 'exitoso',
      fecha_cobro: new Date().toISOString().slice(0, 10),
      registrado_por: req.usuarioPanel.id,
    })
    .select('id')
    .single();
  if (errorCobro) return res.status(500).json({ error: errorCobro.message });

  const { error: errorQr } = await supabase
    .from('qr_cobro_efectivo')
    .update({ usado_en: new Date().toISOString(), usado_por: req.usuarioPanel.id, cobro_id: cobro.id })
    .eq('id', qr.id);
  if (errorQr) return res.status(500).json({ error: errorQr.message });

  res.json({ ok: true, monto: qr.monto });
});

// ============================================================================
// Calificaciones y descargos — visibilidad pública queda como único campo editable por la
// Prestadora (schema_calificaciones_asistente.sql), el contenido (incluido el descargo del
// Asistente) nunca se edita desde acá.
// ============================================================================

panelMarketplaceRouter.get('/calificaciones', async (req, res) => {
  const { data, error } = await supabase
    .from('calificaciones_asistente')
    .select('id, asistente_id, paciente_id, familia_id, estrellas, comentario, visible_publica, descargo_asistente, descargo_en, created_at')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const asistenteIds = [...new Set(data.map((c) => c.asistente_id).filter(Boolean))];
  const { data: asistentes } = asistenteIds.length
    ? await supabase.from('asistentes').select('id, nombre').in('id', asistenteIds)
    : { data: [] };
  const nombreAsistente = new Map((asistentes || []).map((a) => [a.id, a.nombre]));

  const calificaciones = data.map((c) => ({ ...c, asistente_nombre: nombreAsistente.get(c.asistente_id) || null }));

  res.json({ calificaciones });
});

panelMarketplaceRouter.patch('/calificaciones/:id/visibilidad', async (req, res) => {
  const { visible_publica: visiblePublica } = req.body || {};
  if (typeof visiblePublica !== 'boolean') {
    return res.status(400).json({ error: 'Falta visible_publica (booleano)' });
  }
  const { error } = await supabase
    .from('calificaciones_asistente')
    .update({ visible_publica: visiblePublica })
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ============================================================================
// Auditoría legal de marketplace — lectura de auditoria_advertencias_legales acotada a las
// 5 funcion_clave de riesgo alto de marketplace (schema_marketplace_advertencias_seed.sql).
// Sin toggles reales todavía que la escriban (mismo estado que el resto de
// advertencias_legales, ver schema_advertencias_legales_01.sql:1-9) — esta lista queda lista
// para cuando esos toggles se construyan, sin volver a tocar esta ruta.
// ============================================================================

const FUNCIONES_CLAVE_MARKETPLACE = [
  'ranking_plataforma',
  'consecuencia_automatica_calificacion',
  'precio_horario_fijado_plataforma',
  'exclusividad_marketplace',
  'mediacion_conflictos_marketplace',
];

panelMarketplaceRouter.get('/auditoria-legal', async (req, res) => {
  const { data, error } = await supabase
    .from('auditoria_advertencias_legales')
    .select('id, usuario_id, funcion_clave, jurisdiccion, texto_mostrado, created_at, usuarios(nombre)')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .in('funcion_clave', FUNCIONES_CLAVE_MARKETPLACE)
    .order('created_at', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ auditoria: data });
});
