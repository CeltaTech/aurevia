// Punto 6 de docs/PRD_06_WhatsApp_IA.md: mensajes entrantes de WhatsApp de un Asistente.
//
// Pendiente #165 — esta dirección es pública: la llama Meta desde afuera, no un usuario
// logueado. Hasta el 2026-09-08 el motor averiguaba de qué Prestadora era el aviso mirando el
// `phone_number_id` que venía adentro del mismo cuerpo del pedido, y no comprobaba nada más.
// Ese identificador no es un secreto —viaja en cada aviso y se ve en el panel de Meta—, así
// que cualquiera que lo conociera abría conversaciones, insertaba mensajes, gastaba llamadas
// al modelo de lenguaje y hacía salir un WhatsApp de verdad con la cuenta de Meta de esa
// Prestadora, a un número que él mismo elegía.
//
// La forma correcta ya estaba escrita en `webhooksPasarelas.js`, y es la que se copia acá:
//
//   1. **La Prestadora viaja en la dirección, no en el cuerpo.** Una dirección distinta por
//      Prestadora, que ella misma configura en su panel de Meta. Lo que venga adentro del
//      cuerpo no elige a quién se le escribe en la base: a lo sumo se compara con lo
//      configurado, y si no coincide no se procesa.
//   2. **El cuerpo se recibe crudo.** La firma se calcula sobre los bytes exactos que mandó
//      Meta. Si express los convierte a objeto y después alguien los vuelve a convertir a
//      texto, el resultado se parece pero no es igual —un espacio, el orden de dos campos, un
//      acento escapado— y la firma no coincide nunca. Por eso este router trae su propio
//      lector de cuerpo (`express.raw`) y en `server.js` se monta **antes** del
//      `express.json()` general, que si no se lleva el pedido primero.
//   3. **Ante la duda se corta con 401, antes de tocar una sola fila.** No hay configuración
//      de WhatsApp de esa Prestadora, no hay secreto de la aplicación guardado, falta la
//      cabecera, la firma no da: se rechaza. Nunca "se sigue igual".
//   4. **El saludo inicial de Meta se contesta con el token de esa Prestadora**, sacado de la
//      caja fuerte. Antes era una sola variable de entorno para todo el producto: quien la
//      supiera de una Prestadora la sabía de todas.
//
// Lo que todavía no se probó: el formato real del cuerpo que manda Meta. El parseo de abajo
// sigue la estructura que Meta documenta, pero nunca vio tráfico real porque no hay cuenta de
// Meta conectada. Eso se cierra el día que haya una.
import express, { Router } from 'express';
import { supabase } from '../db/connection.js';
import { enviarWhatsApp } from '../utils/whatsapp.js';
import { generarRespuestaIA } from '../utils/iaWhatsapp.js';
// La comparación que no filtra por tiempo y el cálculo del HMAC viven en un solo lugar y se
// reusan: son los mismos que usan los avisos de cobro de las pasarelas. Escribirlos otra vez
// acá sería la segunda copia de una cuenta que tiene que dar siempre igual.
import { MOTIVO, firmasIguales, hmacHex, secretosIguales } from '../pasarelas/firmaWebhook.js';

export const whatsappWebhookRouter = Router();

/** La Prestadora llega en la dirección, así que lo primero que se mira es que tenga forma de
 *  identificador. Sin esto, cualquier texto suelto se le pasa a la base y el error que vuelve
 *  habla de tipos de columna: ruido en el registro por algo que se contesta acá mismo. */
const FORMA_DE_IDENTIFICADOR = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Motivos propios de esta entrada, que no existen del lado de las pasarelas. Se anotan del
 *  lado del servidor; al que llama se le contesta siempre lo mismo. */
const MOTIVO_WHATSAPP = {
  PRESTADORA_ILEGIBLE: 'prestadora_de_la_direccion_ilegible',
  SIN_CONFIGURACION: 'la_prestadora_no_tiene_whatsapp_configurado',
  TOKEN_DE_SALUDO_AUSENTE: 'token_de_verificacion_no_guardado',
  TOKEN_DE_SALUDO_NO_COINCIDE: 'el_token_de_verificacion_no_coincide',
};

// El lector del cuerpo crudo viaja con el router y no suelto en `server.js`: quien monte este
// router se lleva el lector puesto, y lo único que hay que recordar afuera es montarlo antes
// del `express.json()` general. Un megabyte es holgado para el aviso más grande que manda
// Meta por un mensaje de texto.
whatsappWebhookRouter.use(express.raw({ type: 'application/json', limit: '1mb' }));

// El saludo inicial: Meta pega un GET a la dirección antes de empezar a mandar eventos y
// espera que le devuelvan el desafío tal cual, siempre que el token que trae sea el que la
// Prestadora escribió en su panel de Meta. Ese token ahora sale de la caja fuerte de esa
// Prestadora — es la parte del pendiente #165 que hace que conectar la dirección de una no
// sirva para conectarse a la de otra.
whatsappWebhookRouter.get('/:prestadoraId', async (req, res) => {
  const { prestadoraId } = req.params;

  function rechazar(motivo) {
    // El motivo queda del lado del servidor. Al que golpeó la puerta se le contesta siempre lo
    // mismo: decirle cuál de las comprobaciones falló es enseñarle a pasarla. Meta espera un
    // 403 en el saludo cuando el token no da, no un 401.
    console.warn('Saludo de WhatsApp rechazado:', prestadoraId, motivo);
    return res.status(403).send('Verificación fallida');
  }

  if (!FORMA_DE_IDENTIFICADOR.test(prestadoraId)) return rechazar(MOTIVO_WHATSAPP.PRESTADORA_ILEGIBLE);

  const modo = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (modo !== 'subscribe' || !token) return rechazar(MOTIVO_WHATSAPP.TOKEN_DE_SALUDO_NO_COINCIDE);

  const { data: tokenGuardado } = await supabase.rpc('leer_verify_token_whatsapp', {
    p_prestadora_id: prestadoraId,
  });
  if (!tokenGuardado) return rechazar(MOTIVO_WHATSAPP.TOKEN_DE_SALUDO_AUSENTE);
  if (!secretosIguales(token, tokenGuardado)) return rechazar(MOTIVO_WHATSAPP.TOKEN_DE_SALUDO_NO_COINCIDE);

  return res.status(200).send(String(challenge ?? ''));
});

whatsappWebhookRouter.post('/:prestadoraId', async (req, res) => {
  const { prestadoraId } = req.params;

  function rechazar(motivo) {
    console.warn('Aviso de WhatsApp rechazado:', prestadoraId, motivo);
    return res.status(401).json({ error: 'Aviso no autenticado' });
  }

  if (!FORMA_DE_IDENTIFICADOR.test(prestadoraId)) return rechazar(MOTIVO_WHATSAPP.PRESTADORA_ILEGIBLE);

  // Si esto no es un Buffer, el lector de cuerpo crudo no corrió: o el router quedó montado
  // después del `express.json()` general, o el que llama mandó un tipo de contenido que no es
  // JSON. En los dos casos no hay con qué comprobar la firma, y sin eso no se sigue.
  const cuerpoCrudo = Buffer.isBuffer(req.body) ? req.body : null;
  if (!cuerpoCrudo) return rechazar(MOTIVO.CUERPO_AUSENTE);

  const { data: configuracion } = await supabase
    .from('configuracion_whatsapp_prestadora')
    .select('phone_number_id, app_secret_secret_id')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  // Sin fila de configuración esa Prestadora no tiene WhatsApp conectado: no hay secreto con
  // qué comprobar nada, y nada que atender. Corta acá, sin leer ningún secreto.
  if (!configuracion) return rechazar(MOTIVO_WHATSAPP.SIN_CONFIGURACION);

  const { data: appSecret } = await supabase.rpc('leer_app_secret_whatsapp', {
    p_prestadora_id: prestadoraId,
  });
  if (!appSecret) return rechazar(MOTIVO.SECRETO_AUSENTE);

  // Meta firma el cuerpo entero con el secreto de la aplicación y lo escribe como
  // `sha256=<hexadecimal>`. No hay instante adentro —a diferencia de Stripe y Mercado Pago—,
  // así que no hay ventana de vencimiento que comprobar: lo que corta el reenvío de un aviso
  // viejo es el identificador de mensaje, más abajo.
  const cabecera = req.get('X-Hub-Signature-256');
  if (!cabecera) return rechazar(MOTIVO.CABECERA_AUSENTE);

  const corte = String(cabecera).indexOf('=');
  const algoritmo = corte > 0 ? String(cabecera).slice(0, corte).trim() : null;
  const firmaRecibida = corte > 0 ? String(cabecera).slice(corte + 1).trim() : null;
  if (algoritmo !== 'sha256' || !firmaRecibida) return rechazar(MOTIVO.CABECERA_ILEGIBLE);

  if (!firmasIguales(firmaRecibida, hmacHex(appSecret, [cuerpoCrudo]))) {
    return rechazar(MOTIVO.FIRMA_NO_COINCIDE);
  }

  let cuerpo;
  try {
    cuerpo = JSON.parse(cuerpoCrudo.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Cuerpo ilegible' });
  }

  // Recién acá se contesta: Meta reintenta si no recibe 200 a tiempo, y lo que sigue —la
  // llamada al modelo de lenguaje— puede tardar. Lo que no podía esperar es la comprobación de
  // la firma, y esa ya pasó.
  res.status(200).json({ ok: true });

  try {
    await procesarEventoEntrante(cuerpo, {
      prestadoraId,
      phoneNumberIdConfigurado: configuracion.phone_number_id,
    });
  } catch (err) {
    console.error('Error procesando webhook de WhatsApp:', err.message);
  }
});

/**
 * @param payload                    el aviso ya comprobado auténtico
 * @param prestadoraId               la Prestadora de la dirección, nunca una sacada del cuerpo
 * @param phoneNumberIdConfigurado   el número que esa Prestadora tiene configurado
 */
async function procesarEventoEntrante(payload, { prestadoraId, phoneNumberIdConfigurado }) {
  const cambios = payload?.entry?.[0]?.changes?.[0]?.value;
  const mensaje = cambios?.messages?.[0];
  if (!mensaje || mensaje.type !== 'text') return;

  const telefono = mensaje.from;
  const texto = mensaje.text?.body;
  if (!telefono || !texto) return;

  // El `phone_number_id` del cuerpo ya no elige la Prestadora: eso lo hace la dirección. Lo
  // único que se hace con él es comprobar que el aviso hable del número que esta Prestadora
  // tiene configurado. Si no coincide, el aviso es auténtico pero no es para esta puerta —una
  // dirección mal copiada en el panel de Meta, por ejemplo—, y no se procesa.
  const phoneNumberId = cambios?.metadata?.phone_number_id;
  if (phoneNumberIdConfigurado && phoneNumberId && phoneNumberId !== phoneNumberIdConfigurado) {
    console.warn('Aviso de WhatsApp de un número que no es el configurado para esta Prestadora:', prestadoraId);
    return;
  }

  // Un mensaje se atiende una sola vez. La firma de Meta no lleva instante, así que un aviso
  // auténtico copiado sigue dando firma buena mañana; volver a procesarlo gastaría otra llamada
  // al modelo de lenguaje y haría salir otro WhatsApp. El identificador que Meta le pone a cada
  // mensaje es lo que lo corta, y se pregunta antes de escribir nada.
  if (mensaje.id) {
    const { data: yaAnotado } = await supabase
      .from('mensajes_whatsapp')
      .select('id')
      .eq('prestadora_id', prestadoraId)
      .eq('meta_message_id', mensaje.id)
      .maybeSingle();
    if (yaAnotado) return;
  }

  const { data: conversacion } = await supabase
    .from('conversaciones_whatsapp')
    .upsert(
      { prestadora_id: prestadoraId, telefono, ultimo_mensaje_at: new Date().toISOString() },
      { onConflict: 'prestadora_id,telefono' },
    )
    .select('id')
    .single();
  if (!conversacion) return;

  await supabase.from('mensajes_whatsapp').insert({
    prestadora_id: prestadoraId,
    conversacion_id: conversacion.id,
    direccion: 'entrante',
    texto,
    meta_message_id: mensaje.id,
  });

  const { data: historialCrudo } = await supabase
    .from('mensajes_whatsapp')
    .select('direccion, texto')
    .eq('conversacion_id', conversacion.id)
    .order('created_at', { ascending: true })
    .limit(20);

  const respuestaIA = await generarRespuestaIA({ mensajeEntrante: texto, historial: historialCrudo ?? [], prestadoraId });

  const { data: mensajeSaliente } = await supabase
    .from('mensajes_whatsapp')
    .insert({
      prestadora_id: prestadoraId,
      conversacion_id: conversacion.id,
      direccion: 'saliente',
      texto: respuestaIA.respuestaSugerida ?? '(sin respuesta sugerida — requiere redacción manual del Coordinador)',
      generado_por_ia: true,
      enviado_automaticamente: false,
    })
    .select('id')
    .single();

  const enviaAutomatico = respuestaIA.confianzaAlta && !respuestaIA.requiereCoordinador && respuestaIA.respuestaSugerida;

  if (enviaAutomatico) {
    try {
      await enviarWhatsApp({ prestadoraId, telefono, texto: respuestaIA.respuestaSugerida });
      await supabase
        .from('mensajes_whatsapp')
        .update({ enviado_automaticamente: true })
        .eq('id', mensajeSaliente.id);
      return;
    } catch (err) {
      console.error('Error enviando respuesta automática de IA, se escala al Coordinador:', err.message);
    }
  }

  // Nunca queda un mensaje sin que el Coordinador se entere (decisión del Desarrollador,
  // punto 2 de docs/PRD_06_WhatsApp_IA.md).
  await supabase
    .from('conversaciones_whatsapp')
    .update({ requiere_atencion_coordinador: true })
    .eq('id', conversacion.id);
}
