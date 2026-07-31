import webpush from 'web-push';
import { supabase } from '../db/connection.js';
import { IDENTIDAD } from '../config/identidadProducto.js';

let configurado = false;

function asegurarConfiguracion() {
  if (configurado) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return false;
  // "Subject" VAPID: la casilla a la que el servicio de push del navegador escribe si hay
  // un problema con los envíos. Sale de la identidad del producto para que renombrarlo no
  // implique buscarla acá; VAPID_SUBJECT permite pisarla por entorno sin tocar código.
  webpush.setVapidDetails(process.env.VAPID_SUBJECT || `mailto:${IDENTIDAD.emailSoporte}`, publicKey, privateKey);
  configurado = true;
  return true;
}

// Envía un push a todas las suscripciones activas de una audiencia (Asistente o Familia,
// nunca ambas — ver CHECK push_subscriptions_una_audiencia en schema_pwa_familias_01.sql).
// Si una suscripción devuelve 404/410 (dispositivo desinstaló la app o revocó el permiso),
// se borra en el momento — mismo criterio que el resto del proyecto de no dejar basura de
// estado que ya no es válido.
//
// Devuelve true si al menos una suscripción recibió el push con éxito — lo necesita Fase 11
// (revisarRecordatoriosPush.js) para decidir si cae a WhatsApp de respaldo.
async function enviarPush(columna, id, { titulo, cuerpo, url }) {
  // Sin destinatario no hay push. Pasa cuando la guardia está sin cubrir: no hay Asistente
  // a quien avisarle. Se corta acá y no en cada llamador, para no repetir la misma
  // verificación en todos lados.
  if (!id) return false;
  if (!asegurarConfiguracion()) {
    console.error('Push no configurado: falta VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY');
    return false;
  }

  const { data: suscripciones, error } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq(columna, id);

  if (error || !suscripciones?.length) return false;

  const payload = JSON.stringify({ titulo, cuerpo, url: url || '/' });

  const resultados = await Promise.all(
    suscripciones.map(async (suscripcion) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: suscripcion.endpoint,
            keys: { p256dh: suscripcion.p256dh, auth: suscripcion.auth },
          },
          payload,
        );
        return true;
      } catch (err) {
        if (err.statusCode === 404 || err.statusCode === 410) {
          await supabase.from('push_subscriptions').delete().eq('id', suscripcion.id);
        } else {
          console.error(`Error enviando push a suscripción ${suscripcion.id}:`, err.message);
        }
        return false;
      }
    }),
  );

  return resultados.some(Boolean);
}

export function enviarPushAsistente(asistenteId, datos) {
  return enviarPush('asistente_id', asistenteId, datos);
}

export function enviarPushFamilia(familiaId, datos) {
  return enviarPush('familia_id', familiaId, datos);
}
