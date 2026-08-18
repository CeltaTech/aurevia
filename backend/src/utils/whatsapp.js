import { supabase } from '../db/connection.js';
import { enviarEmailCoordinador, configuracionEvento } from './email.js';

const META_GRAPH_VERSION = 'v20.0';

// Credenciales por prestadora — nunca en variables de entorno globales, cada prestadora
// licenciataria tiene su propia cuenta de Meta Cloud API (docs/PRD_06_WhatsApp_IA.md punto C).
// El token nunca vive en esta tabla en texto plano: se lee desde Supabase Vault a través de
// la función leer_token_whatsapp (supabase/migrations/),
// ejecutable solo con el service role que ya usa este backend.
async function credencialesWhatsapp(prestadoraId) {
  const { data: config } = await supabase
    .from('configuracion_whatsapp_prestadora')
    .select('activo, phone_number_id')
    .eq('prestadora_id', prestadoraId)
    .single();

  if (!config?.activo || !config.phone_number_id) return null;

  const { data: token, error } = await supabase.rpc('leer_token_whatsapp', { p_prestadora_id: prestadoraId });
  if (error || !token) return null;

  return { phoneNumberId: config.phone_number_id, token };
}

// Envío de un mensaje de texto libre por Meta Cloud API. En producción, un mensaje que la
// prestadora inicia (no una respuesta dentro de las 24hs de una conversación abierta por el
// Asistente) necesita una plantilla pre-aprobada por Meta, no texto libre — la integración
// de plantillas_whatsapp con el envío real queda para el test final con una prestadora real
// (decisión del Desarrollador, 2026-07-13); esta función alcanza para el caso de respuesta
// dentro de conversación abierta (punto 6) y para pruebas antes de tener plantillas aprobadas.
export async function enviarWhatsApp({ prestadoraId, telefono, texto }) {
  const credenciales = await credencialesWhatsapp(prestadoraId);
  if (!credenciales) throw new Error('whatsapp_no_configurado');

  const respuesta = await fetch(
    `https://graph.facebook.com/${META_GRAPH_VERSION}/${credenciales.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${credenciales.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: telefono,
        type: 'text',
        text: { body: texto },
      }),
    },
  );

  if (!respuesta.ok) {
    const detalle = await respuesta.text();
    throw new Error(`whatsapp_envio_fallido: ${respuesta.status} ${detalle}`);
  }

  return respuesta.json();
}

// Envío al Coordinador de un evento configurado (Módulo 8 > Notificaciones del Panel):
// intenta WhatsApp si el evento lo tiene activado y hay un teléfono de destino; si falla o
// no está activado, cae a email — nunca se pierde un aviso por un problema del canal
// WhatsApp (docs/PRD_06_WhatsApp_IA.md punto B, "ningún mensaje queda sin respuesta").
export async function notificarCoordinador({ evento, prestadoraId, asunto, texto, telefono }) {
  const config = await configuracionEvento(evento, prestadoraId);
  if (config && config.activo === false) return;

  if (config?.whatsapp_activo && telefono) {
    try {
      await enviarWhatsApp({ prestadoraId, telefono, texto: `${asunto}\n\n${texto}` });
      return;
    } catch (err) {
      console.error(`Error enviando WhatsApp de notificación (${evento}), cae a email:`, err.message);
    }
  }

  await enviarEmailCoordinador({ evento, prestadoraId, asunto, texto });
}
