import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { acotarAPrestadora, exigirOrganizacionActiva } from '../middleware/alcancePrestadora.js';
import { supabase } from '../db/connection.js';
import { accionesDePermisos } from '../utils/permisos.js';
import { avisoDelCatalogo, mezclarAvisosConCatalogo, VALORES_POR_DEFECTO_AVISO } from '../utils/catalogoAvisos.js';
import { cosaDelCatalogo, mezclarVisibilidadConCatalogo } from '../utils/catalogoVisibilidad.js';
import { LIMITES_ALERTAS_IA, VALORES_POR_DEFECTO_ALERTAS_IA } from '../utils/revisarAlertasIA.js';
import { validarUmbralesPremura } from '../utils/umbralesPremura.js';
import { LIMITES_AVISO_PREVIO_GUARDIA } from '../utils/revisarRecordatoriosPush.js';

export const panelConfiguracionRouter = Router();

// Módulo 8 (Configuración) es a nivel de toda la empresa — Coordinador no entra acá,
// solo Admin/Superadmin (misma restricción que precios y escalas legales).
function requiereAdminOSuperior(req, res, next) {
  if (!['admin_prestadora', 'superadmin'].includes(req.usuarioPanel?.rol)) {
    return res.status(403).json({ error: 'Solo Admin o Superadmin puede editar la configuración' });
  }
  next();
}

// El corte por "no hay Organización activa" lo pone exigirOrganizacionActiva, compartido con el
// resto de los routers (CLAUDE.md §7.12) — antes esta misma condición estaba escrita acá a mano.
panelConfiguracionRouter.use(requiereRolPanel, requiereAdminOSuperior, exigirOrganizacionActiva);

// --- Datos de la prestadora (configuracion_prestadora, ver schema_multitenant_04.sql —
//     reemplaza el singleton configuracion_empresa: cada prestadora tiene su propia fila) ---
panelConfiguracionRouter.get('/empresa', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('configuracion_prestadora')
    .select('*')
    .eq('prestadora_id', prestadoraId)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ empresa: data });
});

panelConfiguracionRouter.patch('/empresa', async (req, res) => {
  const { nombre, telefono, whatsapp_numero, email, dominio, zona_cobertura_texto } = req.body;
  const { error } = await supabase
    .from('configuracion_prestadora')
    .update({ nombre, telefono, whatsapp_numero, email, dominio, zona_cobertura_texto, updated_at: new Date().toISOString() })
    .eq('prestadora_id', req.usuarioPanel.prestadoraId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Zonas de cobertura ---
panelConfiguracionRouter.get('/zonas', async (req, res) => {
  let query = supabase.from('zonas_cobertura').select('*').order('orden');
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ zonas: data });
});

panelConfiguracionRouter.post('/zonas', async (req, res) => {
  const { codigo, nombre, categoria, orden } = req.body;
  if (!codigo || !nombre || !categoria) {
    return res.status(400).json({ error: 'Faltan código, nombre o categoría' });
  }
  const { error } = await supabase
    .from('zonas_cobertura')
    .insert({ codigo, nombre, categoria, orden: orden ?? 0, prestadora_id: req.usuarioPanel.prestadoraId });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/zonas/:id', async (req, res) => {
  const { nombre, categoria, activa, orden } = req.body;
  let query = supabase
    .from('zonas_cobertura')
    .update({ nombre, categoria, activa, orden })
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

panelConfiguracionRouter.delete('/zonas/:id', async (req, res) => {
  let query = supabase.from('zonas_cobertura').delete().eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Servicios: escalada de relevo (protocolo de continuidad de guardia) ---
panelConfiguracionRouter.get('/escalada-relevo', async (req, res) => {
  let query = supabase.from('configuracion_escalada_relevo').select('*').order('nivel');
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ niveles: data });
});

panelConfiguracionRouter.post('/escalada-relevo', async (req, res) => {
  const { nivel, minutos_demora, orden_prioridad, plantilla_mensaje } = req.body;
  if (!nivel || !plantilla_mensaje) {
    return res.status(400).json({ error: 'Faltan nivel o plantilla de mensaje' });
  }
  const { error } = await supabase
    .from('configuracion_escalada_relevo')
    .insert({ nivel, minutos_demora, orden_prioridad, plantilla_mensaje, prestadora_id: req.usuarioPanel.prestadoraId });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/escalada-relevo/:id', async (req, res) => {
  const { nivel, minutos_demora, orden_prioridad, plantilla_mensaje } = req.body;
  let query = supabase
    .from('configuracion_escalada_relevo')
    .update({ nivel, minutos_demora, orden_prioridad, plantilla_mensaje })
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

panelConfiguracionRouter.delete('/escalada-relevo/:id', async (req, res) => {
  let query = supabase.from('configuracion_escalada_relevo').delete().eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Servicios: etapas del Proceso de Incorporación de Asistentes, configurables por
//     prestadora (pendiente #18 candidato 7, docs/PENDIENTES.md — ver
//     supabase/migrations/). Alta/edición/reordenamiento
//     desde el Panel; sin DELETE — se discontinúa con el toggle "activa" para no romper
//     verificaciones_asistente ya existentes que referencian esa etapa. ---
panelConfiguracionRouter.get('/etapas-incorporacion', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('etapas_incorporacion_asistente')
    .select('*')
    .eq('prestadora_id', prestadoraId)
    .order('orden');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ etapas: data });
});

panelConfiguracionRouter.post('/etapas-incorporacion', async (req, res) => {
  const { clave, nombre } = req.body;
  if (!clave || !nombre) return res.status(400).json({ error: 'Faltan clave o nombre' });
  const { data: maxOrden, error: errorMax } = await supabase
    .from('etapas_incorporacion_asistente')
    .select('orden')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('orden', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (errorMax) return res.status(500).json({ error: errorMax.message });
  const { error } = await supabase
    .from('etapas_incorporacion_asistente')
    .insert({ clave, nombre, orden: (maxOrden?.orden ?? 0) + 1, prestadora_id: req.usuarioPanel.prestadoraId });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/etapas-incorporacion/:id', async (req, res) => {
  const { nombre, activa } = req.body;
  let query = supabase
    .from('etapas_incorporacion_asistente')
    .update({ nombre, activa })
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// Reordena una etapa moviéndola una posición hacia arriba o abajo — intercambia su
// "orden" con el de la etapa vecina (misma prestadora).
panelConfiguracionRouter.patch('/etapas-incorporacion/:id/mover', async (req, res) => {
  const { direccion } = req.body;
  if (direccion !== 'arriba' && direccion !== 'abajo') {
    return res.status(400).json({ error: 'direccion debe ser "arriba" o "abajo"' });
  }
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data: etapas, error: errorEtapas } = await supabase
    .from('etapas_incorporacion_asistente')
    .select('*')
    .eq('prestadora_id', prestadoraId)
    .order('orden');
  if (errorEtapas) return res.status(500).json({ error: errorEtapas.message });

  const indice = etapas.findIndex((e) => e.id === req.params.id);
  if (indice === -1) return res.status(404).json({ error: 'Etapa no encontrada' });
  const indiceVecino = direccion === 'arriba' ? indice - 1 : indice + 1;
  if (indiceVecino < 0 || indiceVecino >= etapas.length) return res.json({ ok: true });

  const actual = etapas[indice];
  const vecino = etapas[indiceVecino];
  const { error: errorSwap } = await supabase.rpc('intercambiar_orden_etapas_incorporacion', {
    p_id_a: actual.id, p_orden_a: vecino.orden, p_id_b: vecino.id, p_orden_b: actual.orden,
  });
  if (errorSwap) return res.status(500).json({ error: errorSwap.message });
  res.json({ ok: true });
});

// --- Servicios: personal de emergencia (roster de suplentes/franqueros/emergencia
//     disponibles para el protocolo de continuidad de guardia, Parte 2 de Módulo 6) ---
panelConfiguracionRouter.get('/personal-emergencia', async (req, res) => {
  let query = supabase
    .from('personal_emergencia')
    .select('id, asistente_id, tipo, activo, created_at, asistentes(nombre)')
    .order('created_at', { ascending: false });
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ personal: data });
});

panelConfiguracionRouter.post('/personal-emergencia', async (req, res) => {
  const { asistente_id, tipo } = req.body;
  if (!asistente_id || !tipo) {
    return res.status(400).json({ error: 'Faltan asistente_id o tipo' });
  }
  const { error } = await supabase
    .from('personal_emergencia')
    .insert({ asistente_id, tipo, prestadora_id: req.usuarioPanel.prestadoraId });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/personal-emergencia/:id', async (req, res) => {
  const { activo } = req.body;
  let query = supabase.from('personal_emergencia').update({ activo }).eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

panelConfiguracionRouter.delete('/personal-emergencia/:id', async (req, res) => {
  let query = supabase.from('personal_emergencia').delete().eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Configuración de notificaciones ---
// configuracion_notificaciones pasó a ser por prestadora el 2026-07-13
// (supabase/migrations/) — antes era una fila global por
// evento, compartida sin darse cuenta por todas las prestadoras licenciatarias.
//
// La pantalla muestra SIEMPRE los ocho avisos del catálogo (utils/catalogoAvisos.js), tenga
// o no tenga fila guardada cada uno. Antes devolvía solo las filas existentes, así que un
// aviso sin sembrar era invisible y no se podía apagar aunque se siguiera mandando.
panelConfiguracionRouter.get('/notificaciones', async (req, res) => {
  let query = supabase
    .from('configuracion_notificaciones')
    .select('evento, descripcion, emails, activo, whatsapp_activo, notificar_familia');
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ notificaciones: mezclarAvisosConCatalogo(data) });
});

// Inserción-o-actualización, no actualización a secas: la primera vez que la Prestadora toca
// un aviso, la fila todavía no existe y un UPDATE no hacía nada (guardaba en silencio y no
// guardaba nada). La descripción sale del catálogo, nunca del navegador.
panelConfiguracionRouter.patch('/notificaciones/:evento', async (req, res) => {
  const aviso = avisoDelCatalogo(req.params.evento);
  if (!aviso) return res.status(400).json({ error: 'Aviso desconocido' });

  const { emails, activo, whatsapp_activo, notificar_familia } = req.body;
  const { error } = await supabase.from('configuracion_notificaciones').upsert(
    {
      prestadora_id: req.usuarioPanel.prestadoraId,
      evento: aviso.evento,
      descripcion: aviso.descripcion,
      emails: Array.isArray(emails) ? emails.map((correo) => String(correo).trim()).filter(Boolean) : [...VALORES_POR_DEFECTO_AVISO.emails],
      activo: activo === undefined ? VALORES_POR_DEFECTO_AVISO.activo : Boolean(activo),
      // Un canal que este aviso no usa se guarda apagado aunque el navegador lo mande
      // encendido: dejarlo prendido haría creer que el aviso sale por ahí, y no sale.
      whatsapp_activo: aviso.admite_whatsapp ? Boolean(whatsapp_activo) : false,
      notificar_familia: aviso.admite_familia ? Boolean(notificar_familia) : false,
    },
    { onConflict: 'evento,prestadora_id' }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Cuánto antes se le recuerda a la Asistente su próxima guardia. Estaba escrito fijo en
//     una hora para todas las Prestadoras (utils/revisarRecordatoriosPush.js), y una hora no
//     le sirve a todas: quien trabaja con guardias de doce horas quiere avisar la noche
//     anterior. Mismo patrón que /guardias/horizonte-generacion: el valor vive en
//     "prestadoras" y se expone acá para reusar el acotado por Prestadora de este router. ---
panelConfiguracionRouter.get('/aviso-previo-guardia', async (req, res) => {
  const { data, error } = await supabase
    .from('prestadoras')
    .select('minutos_aviso_previo_guardia')
    .eq('id', req.usuarioPanel.prestadoraId)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ minutos_aviso_previo_guardia: data.minutos_aviso_previo_guardia });
});

panelConfiguracionRouter.patch('/aviso-previo-guardia', async (req, res) => {
  const { minutos } = req.body;
  if (
    !Number.isInteger(minutos)
    || minutos < LIMITES_AVISO_PREVIO_GUARDIA.minimo
    || minutos > LIMITES_AVISO_PREVIO_GUARDIA.maximo
  ) {
    return res.status(400).json({
      error: `El aviso previo tiene que ser un número entero de minutos, entre ${LIMITES_AVISO_PREVIO_GUARDIA.minimo} y ${LIMITES_AVISO_PREVIO_GUARDIA.maximo}.`,
    });
  }
  const { error } = await supabase
    .from('prestadoras')
    .update({ minutos_aviso_previo_guardia: minutos })
    .eq('id', req.usuarioPanel.prestadoraId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Revisión con IA de los reportes (IA Nivel 2): palabras clave que disparan la revisión
//     inmediata, cuántos reportes se miran y a quién se entera de cada nivel de alerta.
//     Hasta ahora las palabras clave solo se podían cambiar por SQL directo contra la base, y
//     el resto estaba escrito fijo en utils/revisarAlertasIA.js — las dos cosas en contra de
//     "Configuración sobre programación" (CLAUDE.md §2). Mismo patrón que /ausencia-automatica. ---
panelConfiguracionRouter.get('/alertas-ia', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('configuracion_alertas_ia')
    .select('palabras_clave, reportes_a_analizar, roja_avisa_familia, amarilla_avisa_familia, amarilla_avisa_coordinador')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ configuracion: data || { ...VALORES_POR_DEFECTO_ALERTAS_IA } });
});

panelConfiguracionRouter.patch('/alertas-ia', async (req, res) => {
  const {
    palabras_clave, reportes_a_analizar,
    roja_avisa_familia, amarilla_avisa_familia, amarilla_avisa_coordinador,
  } = req.body;

  if (!Array.isArray(palabras_clave)) {
    return res.status(400).json({ error: 'palabras_clave debe ser una lista de textos' });
  }
  if (
    !Number.isInteger(reportes_a_analizar)
    || reportes_a_analizar < LIMITES_ALERTAS_IA.reportes_a_analizar_minimo
    || reportes_a_analizar > LIMITES_ALERTAS_IA.reportes_a_analizar_maximo
  ) {
    return res.status(400).json({
      error: `reportes_a_analizar debe ser un entero entre ${LIMITES_ALERTAS_IA.reportes_a_analizar_minimo} y ${LIMITES_ALERTAS_IA.reportes_a_analizar_maximo}`,
    });
  }

  // "Fiebre", " fiebre" y "FIEBRE" son la misma palabra: el disparo inmediato compara en
  // minúsculas (routes/appAsistentes.js), así que se guardan ya normalizadas y sin repetir.
  const palabrasNormalizadas = [
    ...new Set(
      palabras_clave
        .map((palabra) => String(palabra).trim().toLowerCase())
        .filter(Boolean)
    ),
  ];

  const { error } = await supabase.from('configuracion_alertas_ia').upsert({
    prestadora_id: req.usuarioPanel.prestadoraId,
    palabras_clave: palabrasNormalizadas,
    reportes_a_analizar,
    roja_avisa_familia: Boolean(roja_avisa_familia),
    amarilla_avisa_familia: Boolean(amarilla_avisa_familia),
    amarilla_avisa_coordinador: Boolean(amarilla_avisa_coordinador),
    updated_at: new Date().toISOString(),
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Qué muestran las dos aplicaciones de teléfono. La lista completa sale del catálogo del
//     motor (utils/catalogoVisibilidad.js) y la pantalla la muestra entera, tenga o no fila
//     guardada cada interruptor; la tabla solo guarda lo que la Prestadora cambió. Mismo patrón
//     que /notificaciones. ---
panelConfiguracionRouter.get('/visibilidad-app', async (req, res) => {
  const { data, error } = await supabase
    .from('configuracion_visibilidad_app')
    .select('clave, visible')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ visibilidad: mezclarVisibilidadConCatalogo(data) });
});

// Inserción-o-actualización, no actualización a secas: la primera vez que la Prestadora toca
// un interruptor la fila todavía no existe, y un UPDATE guardaría en silencio sin guardar nada.
// La clave se valida contra el catálogo: lo que mande el navegador que no esté en la lista no
// se guarda, para que no queden filas de interruptores que no existen.
panelConfiguracionRouter.patch('/visibilidad-app/:clave', async (req, res) => {
  const cosa = cosaDelCatalogo(req.params.clave);
  if (!cosa) return res.status(400).json({ error: 'Esa opción no existe' });

  const { visible } = req.body || {};
  if (typeof visible !== 'boolean') {
    return res.status(400).json({ error: 'Falta decir si se muestra o no' });
  }

  const { error } = await supabase.from('configuracion_visibilidad_app').upsert(
    {
      prestadora_id: req.usuarioPanel.prestadoraId,
      clave: cosa.clave,
      visible,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'prestadora_id,clave' }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- WhatsApp: credenciales de Meta Cloud API (Supabase Vault, ver
//     supabase/migrations/ — el token nunca vuelve a
//     mostrarse en el Panel una vez guardado) ---
panelConfiguracionRouter.get('/whatsapp', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('configuracion_whatsapp_prestadora')
    .select('prestadora_id, activo, numero_telefono, waba_id, phone_number_id, verificado_at, updated_at')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({
    whatsapp: data
      ? { ...data, token_cargado: true }
      : { prestadora_id: prestadoraId, activo: false, numero_telefono: null, waba_id: null, phone_number_id: null, verificado_at: null, token_cargado: false },
  });
});

panelConfiguracionRouter.patch('/whatsapp', async (req, res) => {
  const { activo, numero_telefono, waba_id, phone_number_id, token } = req.body;
  const prestadoraId = req.usuarioPanel.prestadoraId;

  const { error } = await supabase
    .from('configuracion_whatsapp_prestadora')
    .upsert({
      prestadora_id: prestadoraId,
      activo,
      numero_telefono,
      waba_id,
      phone_number_id,
      updated_at: new Date().toISOString(),
    });
  if (error) return res.status(500).json({ error: error.message });

  if (token) {
    const { error: errorToken } = await supabase.rpc('guardar_token_whatsapp', {
      p_prestadora_id: prestadoraId,
      p_token: token,
    });
    if (errorToken) return res.status(500).json({ error: errorToken.message });
  }

  res.json({ ok: true });
});

// --- Email: remitente SMTP propio por Prestadora (pendiente #18 candidato 8, Supabase
//     Vault, mismo patrón que /whatsapp — la contraseña nunca vuelve a mostrarse en el
//     Panel una vez guardada) ---
panelConfiguracionRouter.get('/email-remitente', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('configuracion_email_prestadora')
    .select('prestadora_id, activo, direccion_remitente, usuario_smtp, host, puerto, verificado_at, updated_at, credencial_secret_id')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({
    emailRemitente: data
      ? { ...data, credencial_cargada: !!data.credencial_secret_id, credencial_secret_id: undefined }
      : { prestadora_id: prestadoraId, activo: false, direccion_remitente: null, usuario_smtp: null, host: 'smtp.gmail.com', puerto: 465, verificado_at: null, credencial_cargada: false },
  });
});

panelConfiguracionRouter.patch('/email-remitente', async (req, res) => {
  const { activo, direccion_remitente, usuario_smtp, host, puerto, password } = req.body;
  const prestadoraId = req.usuarioPanel.prestadoraId;

  const { error } = await supabase
    .from('configuracion_email_prestadora')
    .upsert({
      prestadora_id: prestadoraId,
      activo,
      direccion_remitente,
      usuario_smtp,
      host: host || 'smtp.gmail.com',
      puerto: puerto || 465,
      updated_at: new Date().toISOString(),
    });
  if (error) return res.status(500).json({ error: error.message });

  if (password) {
    const { error: errorPassword } = await supabase.rpc('guardar_credencial_smtp_prestadora', {
      p_prestadora_id: prestadoraId,
      p_password: password,
    });
    if (errorPassword) return res.status(500).json({ error: errorPassword.message });
  }

  res.json({ ok: true });
});

// --- WhatsApp: plantillas de mensaje (requieren aprobación de Meta antes de poder
//     usarse para un mensaje que la prestadora inicia) ---
panelConfiguracionRouter.get('/whatsapp/plantillas', async (req, res) => {
  let query = supabase.from('plantillas_whatsapp').select('*').order('created_at', { ascending: false });
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ plantillas: data });
});

panelConfiguracionRouter.post('/whatsapp/plantillas', async (req, res) => {
  const { nombre_interno, categoria, idioma, cuerpo_texto } = req.body;
  if (!nombre_interno || !categoria || !cuerpo_texto) {
    return res.status(400).json({ error: 'Faltan nombre_interno, categoria o cuerpo_texto' });
  }
  const { error } = await supabase.from('plantillas_whatsapp').insert({
    nombre_interno,
    categoria,
    idioma: idioma || 'es-AR',
    cuerpo_texto,
    prestadora_id: req.usuarioPanel.prestadoraId,
    created_by: req.usuarioPanel.id,
  });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/whatsapp/plantillas/:id', async (req, res) => {
  const { cuerpo_texto, estado, meta_template_id, motivo_rechazo } = req.body;
  let query = supabase
    .from('plantillas_whatsapp')
    .update({ cuerpo_texto, estado, meta_template_id, motivo_rechazo, updated_at: new Date().toISOString() })
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

panelConfiguracionRouter.delete('/whatsapp/plantillas/:id', async (req, res) => {
  let query = supabase.from('plantillas_whatsapp').delete().eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Catálogo de tipos de documento de Asistente (vencimientos a trackear) + plazo de aviso
//     configurable por prestadora (pendiente #18 punto 1, docs/PENDIENTES.md — ver
//     supabase/migrations/). El plazo vive en la tabla "prestadoras",
//     de gestión exclusiva de superadmin por RLS (schema_multitenant_01.sql) — se expone acá
//     porque el backend usa la service role key y aplica el mismo scoping por prestadora que
//     el resto de este archivo. ---
panelConfiguracionRouter.get('/documentos-tipo', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;

  const [{ data: tipos, error: errorTipos }, { data: prestadora, error: errorPrestadora }] = await Promise.all([
    supabase.from('tipos_documento_asistente').select('*').eq('prestadora_id', prestadoraId).order('nombre'),
    supabase.from('prestadoras').select('dias_aviso_vencimiento_documentos').eq('id', prestadoraId).single(),
  ]);
  if (errorTipos) return res.status(500).json({ error: errorTipos.message });
  if (errorPrestadora) return res.status(500).json({ error: errorPrestadora.message });
  res.json({ tipos, dias_aviso_vencimiento_documentos: prestadora.dias_aviso_vencimiento_documentos });
});

panelConfiguracionRouter.post('/documentos-tipo', async (req, res) => {
  const { nombre, requiere_vencimiento } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta nombre' });
  const { error } = await supabase
    .from('tipos_documento_asistente')
    .insert({ nombre, requiere_vencimiento: requiere_vencimiento ?? true, prestadora_id: req.usuarioPanel.prestadoraId });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/documentos-tipo/plazo-aviso', async (req, res) => {
  const { dias } = req.body;
  if (!Number.isInteger(dias) || dias <= 0) {
    return res.status(400).json({ error: 'dias debe ser un entero positivo' });
  }
  const { error } = await supabase
    .from('prestadoras')
    .update({ dias_aviso_vencimiento_documentos: dias })
    .eq('id', req.usuarioPanel.prestadoraId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Qué tan estricto es el control de matrícula en esta prestadora.
//     Mismo motivo que el plazo de aviso de más arriba: el dato vive en la tabla "prestadoras",
//     que por RLS solo superadmin puede modificar. El navegador no la puede escribir ni aunque
//     lo intente; el backend sí, porque usa la service role key y acota siempre a la prestadora
//     de quien pide. Los dos valores posibles los fija una restricción de la base
//     supabase/migrations/20260801180000_regla_matricula_vigente.sql) — acá se repiten como
//     validación de entrada, no como fuente de verdad. ---
const MODOS_DE_CONTROL_MATRICULA = ['flexible', 'estricto'];

panelConfiguracionRouter.get('/modo-control-matricula', async (req, res) => {
  const { data, error } = await supabase
    .from('prestadoras')
    .select('modo_control_matricula')
    .eq('id', req.usuarioPanel.prestadoraId)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ modo: data.modo_control_matricula });
});

panelConfiguracionRouter.patch('/modo-control-matricula', async (req, res) => {
  const { modo } = req.body;
  if (!MODOS_DE_CONTROL_MATRICULA.includes(modo)) {
    return res.status(400).json({ error: 'modo debe ser flexible o estricto' });
  }
  const { error } = await supabase
    .from('prestadoras')
    .update({ modo_control_matricula: modo })
    .eq('id', req.usuarioPanel.prestadoraId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Catálogo de motivos de aviso previo de guardia, configurable por prestadora
//     (pendiente #18 candidato 3, docs/PENDIENTES.md — ver
//     supabase/migrations/). Mismo patrón que
//     /documentos-tipo. ---
panelConfiguracionRouter.get('/motivos-aviso-previo', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('motivos_aviso_previo_guardia')
    .select('*')
    .eq('prestadora_id', prestadoraId)
    .order('nombre');
  if (error) return res.status(500).json({ error: error.message });
  res.json({ motivos: data });
});

panelConfiguracionRouter.post('/motivos-aviso-previo', async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'Falta nombre' });
  const { error } = await supabase
    .from('motivos_aviso_previo_guardia')
    .insert({ nombre, prestadora_id: req.usuarioPanel.prestadoraId });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/motivos-aviso-previo/:id', async (req, res) => {
  const { nombre, activo } = req.body;
  let query = supabase
    .from('motivos_aviso_previo_guardia')
    .update({ nombre, activo })
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Horizonte de generación de guardias de series abiertas (pendiente #18 punto 2,
//     docs/PENDIENTES.md) — cron backend/src/utils/generacionSeriesGuardia.js. Mismo patrón
//     que /documentos-tipo/plazo-aviso: valor en "prestadoras", expuesto acá para reusar el
//     scoping por prestadora ya resuelto en este router. ---
panelConfiguracionRouter.get('/guardias/horizonte-generacion', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('prestadoras')
    .select('dias_generacion_series_guardia')
    .eq('id', prestadoraId)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ dias_generacion_series_guardia: data.dias_generacion_series_guardia });
});

panelConfiguracionRouter.patch('/guardias/horizonte-generacion', async (req, res) => {
  const { dias } = req.body;
  if (!Number.isInteger(dias) || dias <= 0) {
    return res.status(400).json({ error: 'dias debe ser un entero positivo' });
  }
  const { error } = await supabase
    .from('prestadoras')
    .update({ dias_generacion_series_guardia: dias })
    .eq('id', req.usuarioPanel.prestadoraId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Ausencia automática por falta de check-in GPS (Etapa 3, pendiente #63): antes solo
//     editable por SQL directo contra Supabase, violando "Configuración sobre programación"
//     (CLAUDE.md §2). Ver backend/src/routes/appAsistentes.js (uso de metros_tolerancia_checkin
//     al validar el check-in) y backend/src/utils/ausenciaAutomatica.js (uso de
//     minutos_tolerancia_checkin y activo). ---
panelConfiguracionRouter.get('/ausencia-automatica', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('configuracion_ausencia_automatica')
    .select('activo, minutos_tolerancia_checkin, metros_tolerancia_checkin')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({
    configuracion: data || { activo: true, minutos_tolerancia_checkin: 15, metros_tolerancia_checkin: 150 },
  });
});

panelConfiguracionRouter.patch('/ausencia-automatica', async (req, res) => {
  const { activo, minutos_tolerancia_checkin, metros_tolerancia_checkin } = req.body;
  if (!Number.isInteger(minutos_tolerancia_checkin) || minutos_tolerancia_checkin <= 0) {
    return res.status(400).json({ error: 'minutos_tolerancia_checkin debe ser un entero positivo' });
  }
  if (!Number.isInteger(metros_tolerancia_checkin) || metros_tolerancia_checkin <= 0) {
    return res.status(400).json({ error: 'metros_tolerancia_checkin debe ser un entero positivo' });
  }
  const { error } = await supabase
    .from('configuracion_ausencia_automatica')
    .upsert({
      prestadora_id: req.usuarioPanel.prestadoraId,
      activo: Boolean(activo),
      minutos_tolerancia_checkin,
      metros_tolerancia_checkin,
    });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

panelConfiguracionRouter.patch('/documentos-tipo/:id', async (req, res) => {
  const { nombre, requiere_vencimiento, activo } = req.body;
  let query = supabase
    .from('tipos_documento_asistente')
    .update({ nombre, requiere_vencimiento, activo })
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Motor de permisos configurable por Prestadora — quién, además de un Admin, puede dar de
//     alta a mano, editar datos de Asistentes/Familias/Pacientes, importar en masa, validar un
//     informe de Obra Social o ver lo que se le paga a un Asistente.
//
//     Qué acciones existen y qué pasa con cada una cuando la Prestadora no configuró nada NO se
//     decide acá: sale del catálogo de la base, que es el único lugar donde está escrito. Hasta
//     el 2026-08-19 esta pantalla tenía su propia lista de tres acciones y mostraba un estado
//     que el motor no aplicaba (pendiente #127). Ver backend/src/utils/permisos.js. ---

panelConfiguracionRouter.get('/permisos', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  try {
    const [acciones, { data: filas, error: errorFilas }, { data: coordinadores, error: errorCoordinadores }] = await Promise.all([
      accionesDePermisos(),
      supabase.from('permisos_prestadora').select('*').eq('prestadora_id', prestadoraId),
      supabase.from('usuarios').select('id, nombre').eq('prestadora_id', prestadoraId).eq('rol', 'coordinador').order('nombre'),
    ]);
    if (errorFilas) return res.status(500).json({ error: errorFilas.message });
    if (errorCoordinadores) return res.status(500).json({ error: errorCoordinadores.message });

    const porAccion = Object.fromEntries((filas || []).map((f) => [f.accion, f]));
    const permisos = acciones.map(({ accion, default_solo_admin }) => porAccion[accion] || {
      accion,
      alcance: default_solo_admin ? 'solo_admin' : 'admin_y_coordinador',
      excepciones_permitir: [],
      excepciones_denegar: [],
    });

    res.json({ permisos, coordinadores });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

panelConfiguracionRouter.patch('/permisos/:accion', async (req, res) => {
  const { accion } = req.params;
  let acciones;
  try {
    acciones = await accionesDePermisos();
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  if (!acciones.some((a) => a.accion === accion)) {
    return res.status(400).json({ error: 'Acción desconocida' });
  }
  const { alcance, excepciones_permitir, excepciones_denegar } = req.body;
  if (!['solo_admin', 'admin_y_coordinador'].includes(alcance)) {
    return res.status(400).json({ error: 'Alcance inválido' });
  }
  const { error } = await supabase.from('permisos_prestadora').upsert(
    {
      prestadora_id: req.usuarioPanel.prestadoraId,
      accion,
      alcance,
      excepciones_permitir: excepciones_permitir || [],
      excepciones_denegar: excepciones_denegar || [],
      actualizado_por: req.usuarioPanel.id,
      actualizado_en: new Date().toISOString(),
    },
    { onConflict: 'prestadora_id,accion' }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

panelConfiguracionRouter.get('/politica-verificacion', async (req, res) => {
  const { data, error } = await supabase
    .from('prestadoras')
    .select('politica_verificacion_alta_manual')
    .eq('id', req.usuarioPanel.prestadoraId)
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ politica_verificacion_alta_manual: data.politica_verificacion_alta_manual });
});

panelConfiguracionRouter.patch('/politica-verificacion', async (req, res) => {
  const { politica } = req.body;
  if (!['omitir', 'pendiente', 'aprobado'].includes(politica)) {
    return res.status(400).json({ error: 'Política inválida' });
  }
  const { error } = await supabase
    .from('prestadoras')
    .update({ politica_verificacion_alta_manual: politica })
    .eq('id', req.usuarioPanel.prestadoraId);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Modalidades de negocio activas (PRD_08_Dashboard_Modalidades.md, aprobado 2026-07-24,
//     primer corte "Base: tabla + menú + onboarding"). Activar/desactivar es exclusivo de
//     admin_prestadora (este router ya lo exige vía requiereAdminOSuperior más arriba); la
//     lectura para armar el menú de cualquier rol vive en panelCuentas.js /modalidades-activas
//     (misma tabla, misma fuente única de verdad — CLAUDE.md §7 regla 12).
//     'subcontratacion' todavía no se ofrece acá: no tiene menú ni pantallas (PRD_08 §3.8),
//     solo existe en el CHECK de la tabla para no requerir otra migración cuando se diseñe.
//     Hasta el 2026-08-07 ese valor se llamaba 'cooperativa', que nombraba otra cosa
//     (pendiente #115).
const MODALIDADES_DISPONIBLES = ['directa', 'marketplace'];

panelConfiguracionRouter.get('/modalidades', async (req, res) => {
  const { data, error } = await supabase
    .from('prestadora_modalidades')
    .select('modalidad, activa')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId);
  if (error) return res.status(500).json({ error: error.message });

  const porModalidad = Object.fromEntries((data || []).map((f) => [f.modalidad, f.activa]));
  const modalidades = MODALIDADES_DISPONIBLES.map((modalidad) => ({
    modalidad,
    activa: porModalidad[modalidad] ?? false,
  }));
  res.json({ modalidades });
});

panelConfiguracionRouter.patch('/modalidades/:modalidad', async (req, res) => {
  const { modalidad } = req.params;
  if (!MODALIDADES_DISPONIBLES.includes(modalidad)) {
    return res.status(400).json({ error: 'Modalidad desconocida' });
  }
  const { activa } = req.body;
  if (typeof activa !== 'boolean') {
    return res.status(400).json({ error: 'Falta indicar activa (boolean)' });
  }
  const ahora = new Date().toISOString();
  const { error } = await supabase.from('prestadora_modalidades').upsert(
    {
      prestadora_id: req.usuarioPanel.prestadoraId,
      modalidad,
      activa,
      ...(activa
        ? { activada_por: req.usuarioPanel.id, activada_en: ahora }
        : { desactivada_por: req.usuarioPanel.id, desactivada_en: ahora }),
    },
    { onConflict: 'prestadora_id,modalidad' }
  );
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// --- Escalada a Coordinador: respaldo + intervalos de insistencia según premura
//     (punto 5 de docs/PRD_06_WhatsApp_IA.md) ---
panelConfiguracionRouter.get('/escalada-coordinador', async (req, res) => {
  const prestadoraId = req.usuarioPanel.prestadoraId;
  const { data, error } = await supabase
    .from('configuracion_escalada_coordinador')
    .select('*')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({
    escalada: data || {
      prestadora_id: prestadoraId,
      coordinador_backup_id: null,
      minutos_antes_backup: 15,
      umbrales_premura: [
        { maximo_minutos: 60, intervalo_minutos: 10 },
        { maximo_minutos: 240, intervalo_minutos: 30 },
        { maximo_minutos: null, intervalo_minutos: 60 },
      ],
      fase_automatica_activa: false,
      minutos_antes_fase_automatica: 120,
    },
  });
});

panelConfiguracionRouter.patch('/escalada-coordinador', async (req, res) => {
  const {
    coordinador_backup_id, minutos_antes_backup, umbrales_premura,
    fase_automatica_activa, minutos_antes_fase_automatica,
  } = req.body;

  // Los tramos deciden cada cuánto se le vuelve a insistir al Coordinador. Antes se guardaban
  // sin mirarlos, y una lista mal armada no rompía nada acá: rompía después, callada, en
  // intervaloParaPremura() — que ante un tramo raro cae a su intervalo de respaldo y le
  // termina avisando cada una hora a alguien que había pedido que le avisen cada diez minutos.
  const problema = validarUmbralesPremura(umbrales_premura);
  if (problema) return res.status(400).json({ error: problema });

  const { error } = await supabase
    .from('configuracion_escalada_coordinador')
    .upsert({
      prestadora_id: req.usuarioPanel.prestadoraId,
      coordinador_backup_id,
      minutos_antes_backup,
      umbrales_premura,
      fase_automatica_activa,
      minutos_antes_fase_automatica,
      updated_at: new Date().toISOString(),
    });
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});
