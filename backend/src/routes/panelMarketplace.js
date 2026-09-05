// Pendiente #85 (docs/PENDIENTES.md), Grupo 3 Marketplace — rutas del Panel: pasarela de
// pago por Prestadora, suscripciones/cobros, calificaciones con descargo, y la auditoría de
// advertencias legales de marketplace. Mismo patrón de scoping por prestadora_id/rol que
// panelConfiguracion.js.

import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';
import { proveedoresDisponibles, obtenerAdaptador, requiereSecretoFirma } from '../pasarelas/index.js';
import { tokenQrCobroValido } from '../utils/qrCobroEfectivo.js';
import { exigirAdministracion } from '../middleware/exigirAdministracion.js';

export const panelMarketplaceRouter = Router();

panelMarketplaceRouter.use(requiereRolPanel);

// Todo lo de marketplace pasa adentro de una Prestadora. Superadmin sin sesión de soporte
// abierta no está parado en ninguna, y entonces no hay sobre qué operar.
function exigirPrestadoraActiva(req, res, next) {
  if (!req.usuarioPanel.prestadoraId) {
    return res.status(400).json({ error: 'Hace falta entrar a una prestadora antes de operar sobre marketplace' });
  }
  next();
}

panelMarketplaceRouter.use(exigirPrestadoraActiva);

// La plata del Marketplace es de la administración de la Prestadora, no del Coordinador
// (Desarrollador, 2026-09-04: «absolutamente no puede ni debe»). Alcanza a las dos mitades:
// conectar y desconectar pasarelas de pago —que es cargar credenciales de cobro—, y todo lo
// que sea un cobro: la lista de suscripciones con sus importes, el historial de cobros, la
// carga de efectivo en mano y el canje del QR. Lo que sí queda para el Coordinador es lo que
// no es plata: las calificaciones y la auditoría de advertencias legales.
//
// Hasta el 2026-09-04 este archivo tenía una función llamada `requiereAdminOSuperior` que
// dejaba pasar al Coordinador; las otras dos del motor, con el mismo nombre, no. Ahora el
// control se escribe una sola vez (middleware/exigirAdministracion.js) y lo único que se
// decide acá es a qué rutas se le pide.
const soloAdministracion = exigirAdministracion('Rol sin permiso');

// ============================================================================
// Pasarela de pago — la Prestadora activa uno o varios de los 6 rieles, cada uno con su
// propia credencial (Supabase Vault, ver schema_marketplace_pasarelas_01.sql). El secreto
// nunca se vuelve a mostrar una vez guardado, mismo criterio que WhatsApp.
// ============================================================================

panelMarketplaceRouter.get('/pasarela', soloAdministracion, async (req, res) => {
  const { data, error } = await supabase
    .from('prestadora_pasarela_pago')
    .select('proveedor, estado_conexion, conectada_en, updated_at')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId);
  if (error) return res.status(500).json({ error: error.message });

  // Qué secretos tiene guardados cada proveedor. Nunca el texto —eso no sale de la caja
  // fuerte ni para el Admin que lo cargó—, solamente si está o no está: sin el secreto de
  // firma, los avisos de cobro de esa pasarela se rechazan y la pantalla tiene que poder
  // decirlo (pendiente #159).
  const { data: secretos, error: errorSecretos } = await supabase
    .from('credenciales_pasarela_pago')
    .select('proveedor, secreto_firma_secret_id')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId);
  if (errorSecretos) return res.status(500).json({ error: errorSecretos.message });

  const activados = new Map(data.map((fila) => [fila.proveedor, fila]));
  const conSecretoDeFirma = new Set(
    (secretos ?? []).filter((fila) => fila.secreto_firma_secret_id).map((fila) => fila.proveedor)
  );
  const pasarelas = proveedoresDisponibles().map((proveedor) => ({
    proveedor,
    activo: activados.has(proveedor),
    estado_conexion: activados.get(proveedor)?.estado_conexion ?? null,
    conectada_en: activados.get(proveedor)?.conectada_en ?? null,
    requiere_secreto_firma: requiereSecretoFirma(proveedor),
    secreto_firma_cargado: conSecretoDeFirma.has(proveedor),
  }));

  res.json({ pasarelas });
});

// El secreto con el que la pasarela firma sus avisos de cobro (pendiente #159). Lo normal es
// que llegue junto con la credencial, en el mismo paso de conexión (ver el PATCH de más
// abajo): los dos datos se sacan del mismo panel del proveedor y en el mismo viaje, y
// partirlo en dos trámites era pedirle a la Prestadora que volviera por lo mismo. Esta ruta
// queda para el caso que sí es aparte: cambiar el secreto de una pasarela ya conectada,
// porque se rota cada tanto sin tocar la credencial. Se guarda en la misma caja fuerte que
// la credencial y no se vuelve a mostrar.
panelMarketplaceRouter.put('/pasarela/:proveedor/secreto-firma', soloAdministracion, async (req, res) => {
  const { proveedor } = req.params;
  const { secretoFirma } = req.body || {};

  if (!requiereSecretoFirma(proveedor)) {
    return res.status(400).json({ error: 'Este proveedor no firma sus avisos de cobro' });
  }
  if (typeof secretoFirma !== 'string' || !secretoFirma.trim()) {
    return res.status(400).json({ error: 'Hace falta el secreto de firma' });
  }

  const { error } = await supabase.rpc('guardar_secreto_firma_pasarela_pago', {
    p_prestadora_id: req.usuarioPanel.prestadoraId,
    p_proveedor: proveedor,
    p_secreto: secretoFirma.trim(),
  });
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

panelMarketplaceRouter.patch('/pasarela/:proveedor', soloAdministracion, async (req, res) => {
  const { proveedor } = req.params;
  const { activo, credencial, secretoFirma } = req.body || {};

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

  // El secreto de firma viaja en la misma llamada que la credencial cuando el proveedor firma
  // sus avisos: son dos datos del mismo panel del proveedor, se copian de una sola vez. Si no
  // vino, la pasarela igual se conecta y la pantalla avisa que le falta — hay pasarelas que se
  // conectaron antes de que esto existiera, y no se las deja tiradas.
  if (requiereSecretoFirma(proveedor) && typeof secretoFirma === 'string' && secretoFirma.trim()) {
    const { error: errorSecreto } = await supabase.rpc('guardar_secreto_firma_pasarela_pago', {
      p_prestadora_id: req.usuarioPanel.prestadoraId,
      p_proveedor: proveedor,
      p_secreto: secretoFirma.trim(),
    });
    if (errorSecreto) return res.status(500).json({ error: errorSecreto.message });
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
panelMarketplaceRouter.get('/suscripciones', soloAdministracion, async (req, res) => {
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

panelMarketplaceRouter.get('/suscripciones/:id/cobros', soloAdministracion, async (req, res) => {
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
panelMarketplaceRouter.post('/cobros/efectivo-manual', soloAdministracion, async (req, res) => {
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
panelMarketplaceRouter.post('/qr-cobro/canjear', soloAdministracion, async (req, res) => {
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
  // La escritura devuelve la fila tocada: sin esto la base contesta que salió bien aunque no
  // haya encontrado ninguna, y la pantalla muestra un cambio de visibilidad que no ocurrió.
  const { data: modificada, error } = await supabase
    .from('calificaciones_asistente')
    .update({ visible_publica: visiblePublica })
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .select('id');
  if (error) return res.status(500).json({ error: error.message });
  if (!modificada?.length) {
    // No existe, o es de otra Prestadora. Se contesta lo mismo en los dos casos.
    return res.status(404).json({ error: 'No se encontró esa calificación' });
  }
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
