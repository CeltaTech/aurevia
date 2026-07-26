import dns from 'dns/promises';
import nodemailer from 'nodemailer';
import { supabase } from '../db/connection.js';

const SMTP_HOST = 'smtp.gmail.com';

// nodemailer 9.0.3 resuelve A y AAAA de smtp.gmail.com y elige una IP al azar entre
// ambas (node_modules/nodemailer/lib/shared/index.js, formatDNSValue) sin comprobar si
// la red tiene salida IPv6 real — la opción `family` del transporter no se usa en
// ningún punto del código de nodemailer, fijarla no tiene efecto. En Railway la salida
// IPv6 da ENETUNREACH, así que una fracción aleatoria de los envíos fallaba (pendiente
// #37, detectado al verificar la recuperación de MFA por email). Se resuelve acá mismo
// a una IPv4 y se pasa como host literal, con `servername` explícito para que el TLS
// siga validando el certificado contra smtp.gmail.com.
async function crearTransporter() {
  let host = SMTP_HOST;
  try {
    const direcciones = await dns.resolve4(SMTP_HOST);
    if (direcciones.length) host = direcciones[Math.floor(Math.random() * direcciones.length)];
  } catch {
    // Sin IPv4 resuelta, se cae al hostname (mismo comportamiento previo a este fix).
  }
  return nodemailer.createTransport({
    host,
    port: 465,
    secure: true,
    servername: SMTP_HOST,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASSWORD,
    },
  });
}

// Destinatarios configurables desde el Panel (Módulo 8 > Notificaciones) en vez de
// hardcodeados. configuracion_notificaciones es por prestadora desde 2026-07-13
// (backend/src/db/schema_whatsapp_ia_01.sql sección 0) — antes era una fila global por
// evento, compartida sin darse cuenta por todas las prestadoras licenciatarias.
async function configuracionEvento(evento, prestadoraId) {
  const { data } = await supabase
    .from('configuracion_notificaciones')
    .select('emails, activo, whatsapp_activo, notificar_familia')
    .eq('evento', evento)
    .eq('prestadora_id', prestadoraId)
    .single();

  return data;
}

// Si el evento no tiene emails cargados (o está desactivado), antes caía al inbox operativo
// de la cuenta SMTP compartida (process.env.SMTP_USER) — con más de una prestadora eso
// significaba que un aviso sin configurar en la prestadora B terminaba en el inbox operativo
// de la prestadora A. Ahora cae al email de contacto propio de esa prestadora
// (configuracion_prestadora.email), nunca a una cuenta de otra.
async function destinatariosEvento(evento, prestadoraId) {
  const data = await configuracionEvento(evento, prestadoraId);
  if (data && data.activo === false) return [];
  if (data?.emails?.length) return data.emails;

  const { data: prestadora } = await supabase
    .from('configuracion_prestadora')
    .select('email')
    .eq('prestadora_id', prestadoraId)
    .single();

  return prestadora?.email ? [prestadora.email] : [];
}

export async function enviarEmailCoordinador({ evento, prestadoraId, asunto, texto }) {
  if (!process.env.SMTP_USER) return;
  const destinatarios = await destinatariosEvento(evento, prestadoraId);
  if (destinatarios.length === 0) return;

  // `from` sigue siendo la cuenta SMTP compartida a propósito: es un único relay de correo
  // saliente (credencial de infraestructura, no de negocio) — cada prestadora manda "desde"
  // esa cuenta hoy porque no existe (todavía) aprovisionamiento de SMTP propio por
  // licenciataria. El aislamiento real está en el destinatario, no en el remitente.
  const transporter = await crearTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to: destinatarios.join(', '),
    subject: asunto,
    text: texto,
  });
}

export { configuracionEvento };

export async function enviarEmail({ to, asunto, texto }) {
  if (!process.env.SMTP_USER) return;
  const transporter = await crearTransporter();
  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to,
    subject: asunto,
    text: texto,
  });
}
