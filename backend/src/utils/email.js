import dns from 'dns/promises';
import nodemailer from 'nodemailer';
import { supabase } from '../db/connection.js';
import { marcaDeLaPrestadora } from './marcaPrestadora.js';

const SMTP_HOST = 'smtp.gmail.com';

// ---------------------------------------------------------------------------
// Por dónde sale el correo
// ---------------------------------------------------------------------------
//
// Railway no deja salir tráfico por los puertos de correo: se probaron los tres —25, 465 y
// 587— desde el propio servidor y los tres cortaron a los 260 milisegundos, que es la firma de
// un bloqueo y no de una demora. Así que el motor no puede entrar a ninguna casilla de correo,
// ni propia ni de una Prestadora, y el envío tiene que salir por un despachante que hable por
// el puerto 443, como cualquier otro pedido web.
//
// El despachante es Resend. Se eligió por costo: con una sola dirección de dominio autorizada
// —careonys.com— cuelgan todas las direcciones que haga falta sin pagar por Prestadora, y el
// plan gratuito cubre lo que hoy se manda. El día que quede chico se cambia esta pieza sola:
// el armado de cada correo no sabe por dónde viaja.
//
// El camino por SMTP no se borra: se usa mientras no haya credencial del despachante. Así el
// motor corriendo fuera de Railway —la máquina de desarrollo— sigue mandando como siempre.
//
// Lo que se manda no cambia por esto. A quién va, qué dice y con qué marca sale de
// `destinatariosEvento` y de la marca de la Prestadora, que no saben por dónde viaja el correo.

const RESEND_ENVIO_URL = 'https://api.resend.com/emails';

function credencialDelDespachante() {
  return process.env.RESEND_API_KEY || null;
}

// La dirección desde la que sale el correo del producto. `REMITENTE_AVISOS` existe para que la
// casilla de envío no dependa de la del usuario SMTP, que es de la máquina de desarrollo.
export function direccionRemitente() {
  return process.env.REMITENTE_AVISOS || process.env.SMTP_USER || null;
}

// El dominio bajo el que cuelgan todas las direcciones del producto. Sale de la dirección común
// y no de una variable propia: las dos dirían siempre lo mismo, y dos variables que tienen que
// coincidir terminan no coincidiendo.
export function dominioDeEnvio() {
  const [, dominio] = String(direccionRemitente() ?? '').split('@');
  return dominio || null;
}

// Si no hay ningún medio configurado, el motor no intenta mandar y no falla: es lo que ya
// hacía cuando lo único que miraba era `SMTP_USER`.
export function hayMedioDeEnvio() {
  if (credencialDelDespachante() && direccionRemitente()) return true;
  return Boolean(process.env.SMTP_USER);
}

// ¿Esto tiene forma de dirección de correo? Vive acá, que es el archivo del correo, porque la
// pregunta va a aparecer en más de un lugar —el alta de una Prestadora, la pantalla que pide la
// casilla de respuestas— y la respuesta tiene que ser la misma en todos.
//
// Comprueba la forma y nada más: que una dirección exista, que reciba y que sea de quien dice
// ser no se sabe hasta mandarle algo. Por eso no intenta ser exhaustiva — una expresión que
// quiera abarcar todo lo que la norma permite termina rechazando direcciones válidas.
export function esDireccionDeCorreo(texto) {
  if (typeof texto !== 'string') return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@.]+$/.test(texto.trim());
}

// El despachante recibe el remitente como un solo texto. nodemailer lo acepta partido en nombre
// y dirección, que es como lo arma `remitenteVisible`; acá se juntan, y el nombre va entre
// comillas para que una coma en el nombre de fantasía no parta la dirección en dos.
function remitenteComoTexto(from) {
  if (!from || typeof from === 'string') return from;
  return `"${from.name.replace(/"/g, '')}" <${from.address}>`;
}

function transporteDelDespachante(clave) {
  return {
    async sendMail({ from, to, subject, text, replyTo }) {
      const respuesta = await fetch(RESEND_ENVIO_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${clave}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: remitenteComoTexto(from),
          to: to.split(',').map((direccion) => direccion.trim()),
          subject,
          text,
          ...(replyTo ? { reply_to: replyTo } : {}),
        }),
      });

      if (!respuesta.ok) {
        // Del error sale el número y nada más: el cuerpo de la respuesta repite el mensaje que
        // se mandó, con los destinatarios adentro (`celtatech/CLAUDE.md` §6).
        throw new Error(`El despachante rechazó el envío (${respuesta.status})`);
      }
    },
  };
}

// nodemailer 9.0.3 resuelve A y AAAA de smtp.gmail.com y elige una IP al azar entre
// ambas (node_modules/nodemailer/lib/shared/index.js, formatDNSValue) sin comprobar si
// la red tiene salida IPv6 real — la opción `family` del transporter no se usa en
// ningún punto del código de nodemailer, fijarla no tiene efecto. En Railway la salida
// IPv6 da ENETUNREACH, así que una fracción aleatoria de los envíos fallaba (pendiente
// #37, detectado al verificar la recuperación de MFA por email). Se resuelve acá mismo
// a una IPv4 y se pasa como host literal, con `servername` explícito para que el TLS
// siga validando el certificado contra smtp.gmail.com.
async function crearTransporterCompartido() {
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

// La dirección desde la que manda esta Prestadora: la casilla que se le fijó al darla de alta,
// con el dominio del producto. Se arma acá y no se guarda entera, porque el dominio es
// configuración del producto y guardarlo junto al nombre lo metería adentro de los datos.
// El nombre lo elige `utils/casillaDeEnvio.js`.
//
// Sin casilla propia devuelve `null` y el correo sale desde la dirección común: es lo que
// hacían todas hasta que existió esta columna, y lo que hacen las que se dieron de alta antes.
export async function direccionDeEnvioDe(prestadoraId) {
  const dominio = dominioDeEnvio();
  if (!prestadoraId || !dominio) return null;

  const { data } = await supabase
    .from('prestadoras')
    .select('casilla_envio')
    .eq('id', prestadoraId)
    .maybeSingle();

  return data?.casilla_envio ? `${data.casilla_envio}@${dominio}` : null;
}

// Por dónde sale el correo de una Prestadora.
//
// Hay un solo camino de verdad: el despachante, que habla por el puerto 443 —el único que el
// servidor deja salir— y despacha para todas. Lo propio de cada Prestadora no es el servidor
// sino la **dirección**: la suya, bajo el dominio del producto, que le fija el alta
// (`utils/casillaDeEnvio.js`). Si no tiene ninguna, manda desde la dirección común.
//
// El otro camino es la salida por SMTP de la máquina de desarrollo, que existe para poder
// probar sin despachante y en ningún otro lado funciona.
//
// Y no hay un tercero. Cada Prestadora tuvo alguna vez su propio servidor de correo con su
// contraseña; se retiró junto con la pantalla que lo pedía, porque sale por SMTP y en el
// servidor esos puertos están bloqueados: no podía andar en producción para ninguna.
async function crearTransporterPara(prestadoraId) {
  const clave = credencialDelDespachante();
  if (clave && direccionRemitente()) {
    const propia = await direccionDeEnvioDe(prestadoraId);
    return { transporter: transporteDelDespachante(clave), from: propia || direccionRemitente() };
  }

  return { transporter: await crearTransporterCompartido(), from: process.env.SMTP_USER };
}

// Destinatarios configurables desde el Panel (Módulo 8 > Notificaciones) en vez de
// hardcodeados. configuracion_notificaciones es por prestadora desde 2026-07-13
// (supabase/migrations/) — antes era una fila global por
// evento, compartida sin darse cuenta por todas las prestadoras licenciatarias.
async function configuracionEvento(evento, prestadoraId) {
  const { data } = await supabase
    .from('configuracion_notificaciones')
    .select('emails, activo, whatsapp_activo, notificar_familia, plantilla_whatsapp_id')
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

  const contacto = await emailDeContactoDePrestadora(prestadoraId);
  return contacto ? [contacto] : [];
}

// La dirección que la Prestadora declaró como suya. Se usa para dos cosas distintas y por eso
// vive en una sola función: es el destino de los avisos que no tienen destinatario configurado,
// y es adonde tienen que llegar las respuestas de la gente que recibe un correo del sistema.
async function emailDeContactoDePrestadora(prestadoraId) {
  if (!prestadoraId) return null;

  const { data } = await supabase
    .from('configuracion_prestadora')
    .select('email')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  return data?.email ?? null;
}

// El nombre que se lee en el buzón de quien recibe el correo: el de la Prestadora que lo manda.
// Acompaña a la dirección, que también es suya cuando tiene casilla propia. Si esa Prestadora no
// tiene nombre de fantasía cargado, se manda la dirección sola: un correo sin nombre visible
// llega igual, y quedarse esperando el dato sería no mandar nada.
async function remitenteVisible(direccion, prestadoraId) {
  if (!direccion || !prestadoraId) return direccion;
  const { nombre } = await marcaDeLaPrestadora(prestadoraId);
  return nombre ? { name: nombre, address: direccion } : direccion;
}

// Por acá pasan los dos envíos, y por eso el conteo se anota acá y no en cada uno.
//
// El despachante tiene un tope —3.000 correos por mes y como mucho 100 por día— y pasado ese
// tope deja de aceptar envíos. Sin una cuenta propia, el tope se descubre el día que un aviso
// no sale; con ella, el Panel lo ve venir.
//
// Se anota el hecho y nada más: cuándo, de qué Prestadora, y si el despachante lo tomó. Ni el
// destinatario, ni el asunto, ni una línea del contenido (`celtatech/CLAUDE.md` §6).
//
// Y no anotar nunca rompe un envío. Un correo que salió y no se pudo contar sigue siendo un
// correo que salió; hacer fallar el aviso porque falló su registro sería cambiar un número por
// una notificación que no llega.
async function despachar({ transporter, prestadoraId, mensaje }) {
  let aceptado = false;
  try {
    await transporter.sendMail(mensaje);
    aceptado = true;
  } finally {
    try {
      await supabase.from('envios_de_correo').insert({ prestadora_id: prestadoraId ?? null, aceptado });
    } catch (error) {
      console.error('Salió un correo que no se pudo contar:', error.message);
    }
  }
}

export async function enviarEmailCoordinador({ evento, prestadoraId, asunto, texto }) {
  if (!hayMedioDeEnvio()) return;
  const destinatarios = await destinatariosEvento(evento, prestadoraId);
  if (destinatarios.length === 0) return;

  const { transporter, from } = await crearTransporterPara(prestadoraId);
  await despachar({
    transporter,
    prestadoraId,
    mensaje: {
      from: await remitenteVisible(from, prestadoraId),
      replyTo: await emailDeContactoDePrestadora(prestadoraId),
      to: destinatarios.join(', '),
      subject: asunto,
      text: texto,
    },
  });
}

export { configuracionEvento };

export async function enviarEmail({ to, asunto, texto, prestadoraId }) {
  if (!hayMedioDeEnvio()) return;
  const { transporter, from } = await crearTransporterPara(prestadoraId);
  await despachar({
    transporter,
    prestadoraId,
    mensaje: {
      from: await remitenteVisible(from, prestadoraId),
      replyTo: await emailDeContactoDePrestadora(prestadoraId),
      to,
      subject: asunto,
      text: texto,
    },
  });
}
