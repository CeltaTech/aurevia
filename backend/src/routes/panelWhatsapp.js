import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { enviarWhatsApp } from '../utils/whatsapp.js';
import { supabase } from '../db/connection.js';

export const panelWhatsappRouter = Router();

// Por qué esta ruta existe:
// Cuando entra un WhatsApp, la IA redacta una respuesta y la guarda como mensaje saliente
// SIN enviarla (whatsappWebhook.js:86-97). Si la IA no está segura, marca la conversación
// como `requiere_atencion_coordinador` y ahí queda: el borrador esperaba a un Coordinador
// que no tenía ninguna pantalla donde verlo, así que quien escribió por WhatsApp se
// quedaba sin respuesta. La bandeja del Panel lee las conversaciones directo de Supabase
// con RLS, pero el envío tiene que pasar por acá: el token de Meta de cada Prestadora vive
// en Supabase Vault y solo lo puede leer este backend, nunca el navegador.
//
// Un mensaje saliente con `enviado_automaticamente = false` y `revisado_por_coordinador_at`
// vacío es un borrador pendiente. Cuando el Coordinador lo envía o lo descarta, se le pone
// la fecha de revisión y deja de estar pendiente.

async function conversacionDeLaPrestadora(conversacionId, prestadoraId) {
  const { data } = await supabase
    .from('conversaciones_whatsapp')
    .select('id, telefono, prestadora_id')
    .eq('id', conversacionId)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  return data ?? null;
}

async function borradorPendiente(conversacionId) {
  const { data } = await supabase
    .from('mensajes_whatsapp')
    .select('id')
    .eq('conversacion_id', conversacionId)
    .eq('direccion', 'saliente')
    .eq('enviado_automaticamente', false)
    .is('revisado_por_coordinador_at', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

// Envía la respuesta y la deja registrada en el hilo. El texto es el que el Coordinador
// tiene en pantalla — puede ser el que sugirió la IA, editado, o uno escrito de cero.
panelWhatsappRouter.post('/conversaciones/:id/responder', requiereRolPanel, async (req, res) => {
  const { texto } = req.body;
  const { prestadoraId } = req.usuarioPanel;

  if (!texto || !texto.trim()) {
    return res.status(400).json({ error: 'Falta el texto de la respuesta' });
  }

  const conversacion = await conversacionDeLaPrestadora(req.params.id, prestadoraId);
  if (!conversacion) {
    return res.status(404).json({ error: 'Conversación inexistente' });
  }

  try {
    await enviarWhatsApp({ prestadoraId, telefono: conversacion.telefono, texto });
  } catch (error) {
    // whatsapp_no_configurado es un problema de configuración de la Prestadora, no un fallo
    // del envío — se distingue para que la pantalla pueda decir qué hacer.
    const codigo = error.message.startsWith('whatsapp_no_configurado') ? 'whatsapp_no_configurado' : 'envio_fallido';
    return res.status(502).json({ error: 'No se pudo enviar el mensaje por WhatsApp', codigo });
  }

  const ahora = new Date().toISOString();
  const borrador = await borradorPendiente(conversacion.id);

  if (borrador) {
    // El borrador de la IA pasa a ser el mensaje realmente enviado, con el texto final.
    await supabase
      .from('mensajes_whatsapp')
      .update({ texto, revisado_por_coordinador_at: ahora })
      .eq('id', borrador.id);
  } else {
    await supabase.from('mensajes_whatsapp').insert({
      prestadora_id: prestadoraId,
      conversacion_id: conversacion.id,
      direccion: 'saliente',
      texto,
      generado_por_ia: false,
      enviado_automaticamente: false,
      revisado_por_coordinador_at: ahora,
    });
  }

  await supabase
    .from('conversaciones_whatsapp')
    .update({ requiere_atencion_coordinador: false, ultimo_mensaje_at: ahora })
    .eq('id', conversacion.id);

  res.json({ ok: true });
});

// El Coordinador decide que no hace falta responder (ya lo resolvió por teléfono, era spam,
// etc.). No se envía nada: solo se descarta el borrador y la conversación deja de pedir
// atención. El mensaje entrante queda en el hilo, no se borra nada.
panelWhatsappRouter.post('/conversaciones/:id/descartar', requiereRolPanel, async (req, res) => {
  const { prestadoraId } = req.usuarioPanel;

  const conversacion = await conversacionDeLaPrestadora(req.params.id, prestadoraId);
  if (!conversacion) {
    return res.status(404).json({ error: 'Conversación inexistente' });
  }

  const ahora = new Date().toISOString();
  const borrador = await borradorPendiente(conversacion.id);

  if (borrador) {
    await supabase
      .from('mensajes_whatsapp')
      .update({ revisado_por_coordinador_at: ahora })
      .eq('id', borrador.id);
  }

  await supabase
    .from('conversaciones_whatsapp')
    .update({ requiere_atencion_coordinador: false })
    .eq('id', conversacion.id);

  res.json({ ok: true });
});
