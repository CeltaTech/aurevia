/* El hilo entre una Familia y un Asistente del Marketplace.
   ========================================================

   QUÉ ES. Una conversación por pareja —una Familia, un Asistente—, con sus mensajes. El chat es
   libre (`docs/PRD_07_Modalidad_Marketplace.md:69`); lo que se cobra es el dato de contacto, y
   ese dato no llega a guardarse: lo tapa la base antes de escribir el mensaje, con el cuerpo de
   reglas de `public.reglas_de_los_mensajes`. Este archivo no tapa nada y no decide nada de eso;
   lo que lee ya viene tapado.

   LAS DOS PUNTAS USAN ESTO MISMO. La aplicación de la Familia y la del Asistente entran por
   rutas distintas y al mismo hilo. Si cada ruta armara su consulta, la forma en que un mensaje
   sale serían dos decisiones y bastaría con que una se olvidara. Acá es una.

   LA PRESTADORA NO ESTÁ EN LA CONVERSACIÓN Y NO LA LEE. Recluta, admite, gerencia y configura;
   no ve lo que se hablan. Está guardada en cada fila para el aislamiento entre Organizaciones,
   que es otra cosa: es el filtro que hace que un hilo de una Prestadora no aparezca nunca
   consultando desde otra.

   LA VIDEOLLAMADA NO SE ARMA ACÁ. Cómo se hace una sala —de dónde sale la dirección, qué nombre
   lleva y cuánto vale— es lo mismo en el chat que en la entrevista de reclutamiento, así que vive
   una sola vez en `videollamada.js`. Acá queda nada más lo propio de un hilo: que la sala se
   guarda en la conversación y que el aviso de que empezó una se escribe adentro del hilo. */

import { supabase } from '../db/connection.js';
import { mensajeHaciaAfuera } from './contactoTapado.js';
import { enviarPushAsistente, enviarPushFamilia } from './push.js';
import {
  direccionDeVideollamada,
  nombreDeSalaNuevo,
  salaAbiertaSigueValiendo,
  urlDeSala,
} from './videollamada.js';

/** Los dos lados de un hilo. No se deducen del autor: del lado de la Familia puede escribir
 *  cualquiera de su círculo, así que el lado es un dato y no una cuenta. */
export const LADO = { FAMILIA: 'familia', ASISTENTE: 'asistente' };

/** El cuerpo de los mensajes que escribe el producto. Son claves de traducción, no texto
 *  visible: la frase que se lee sale de las traducciones, en los tres idiomas. */
export const AVISO_AUTOMATICO = { VIDEOLLAMADA: 'videollamada_empezo' };

/** Cuántos mensajes se traen de un hilo. Alcanza para leer una conversación entera de las que
 *  pasan antes de contratar a alguien, y pone un techo a lo que viaja en un pedido. */
const TOPE_DE_MENSAJES = 200;

/* SI ESA FAMILIA YA ABRIÓ EL CONTACTO DE ESE ASISTENTE NO SE PREGUNTA ACÁ, Y YA NO CAMBIA NADA
   DEL HILO. Lo tapado en un mensaje no se destapa nunca, porque no quedó guardado. El dato de
   contacto que esa Familia paga sale por su propio circuito, y esa pregunta vive una sola vez, en
   `contactoDelAsistente.js`. */

/**
 * La conversación de una pareja. Con `crear`, la abre si no existía.
 *
 * @returns {Promise<object|null>} La fila, o null si no existe y no se pidió crearla.
 */
export async function conversacionDeLaPareja({ prestadoraId, familiaId, asistenteId, crear = false }) {
  const { data } = await supabase
    .from('conversaciones_marketplace')
    .select('id, prestadora_id, familia_id, asistente_id, ultimo_mensaje_at, sala_videollamada, sala_abierta_at')
    .eq('prestadora_id', prestadoraId)
    .eq('familia_id', familiaId)
    .eq('asistente_id', asistenteId)
    .maybeSingle();

  if (data || !crear) return data || null;

  const { data: creada, error } = await supabase
    .from('conversaciones_marketplace')
    .insert({ prestadora_id: prestadoraId, familia_id: familiaId, asistente_id: asistenteId })
    .select('id, prestadora_id, familia_id, asistente_id, ultimo_mensaje_at, sala_videollamada, sala_abierta_at')
    .single();

  // Dos pantallas abiertas a la vez intentan crear la misma conversación, y la llave única deja
  // pasar una sola. La que perdió no falló: la conversación existe, y es la que buscaba.
  if (error) {
    const { data: ajena } = await supabase
      .from('conversaciones_marketplace')
      .select('id, prestadora_id, familia_id, asistente_id, ultimo_mensaje_at, sala_videollamada, sala_abierta_at')
      .eq('prestadora_id', prestadoraId)
      .eq('familia_id', familiaId)
      .eq('asistente_id', asistenteId)
      .maybeSingle();
    if (ajena) return ajena;
    throw error;
  }

  return creada;
}

/**
 * El momento a partir del cual se piden mensajes, o null.
 *
 * Lo que llega del pedido es texto, y un texto que no es una fecha no se interpreta: se ignora, y
 * entonces sale el hilo entero. Contestar un error dejaría la pantalla sin la conversación que ya
 * tenía, que es justo lo contrario de lo que se busca.
 */
export function desdeCuando(valor) {
  if (valor === undefined || valor === null || valor === '') return null;
  const momento = new Date(String(valor));
  return Number.isNaN(momento.getTime()) ? null : momento.toISOString();
}

/**
 * Por qué se tapó, por clave de regla y en los tres idiomas.
 *
 * Sale del catálogo y se pide una sola vez por hilo, no una por mensaje. Ante un error de la base
 * el hilo sale igual: sin el motivo se pierde la explicación, no la conversación.
 */
async function motivosDelCatalogo() {
  const { data, error } = await supabase.from('reglas_de_los_mensajes').select('clave, motivo');

  if (error) {
    console.error('Error consultando reglas_de_los_mensajes:', error.message);
    return {};
  }
  return Object.fromEntries((data || []).map((r) => [r.clave, r.motivo]));
}

/**
 * Los mensajes de un hilo, listos para salir hacia una pantalla.
 *
 * Es la única puerta: nadie más consulta `mensajes_marketplace` para mostrarlos. Salen tal como
 * están guardados, que es ya tapados, con el motivo al lado de los que la base tapó.
 *
 * Con `desde` salen solamente los posteriores a ese momento. Es lo que usa el refresco del hilo
 * abierto: pide lo que le falta y no vuelve a bajar lo que ya tiene.
 */
export async function mensajesDeLaConversacion({ conversacion, desde = null }) {
  let consulta = supabase
    .from('mensajes_marketplace')
    .select('id, lado, cuerpo, automatico, created_at, leido_at, regla_tapada')
    .eq('conversacion_id', conversacion.id);

  if (desde) consulta = consulta.gt('created_at', desde);

  const { data, error } = await consulta
    .order('created_at', { ascending: true })
    .limit(TOPE_DE_MENSAJES);

  if (error) throw error;

  const hayTapado = (data || []).some((m) => m.regla_tapada);
  const motivos = hayTapado ? await motivosDelCatalogo() : {};

  return (data || []).map((m) => mensajeHaciaAfuera(m, motivos));
}

/** Da por leído lo que le escribió el otro lado. Lo propio no se marca: ya lo leyó quien lo
 *  escribió. */
export async function marcarLeido({ conversacion, lado }) {
  const delOtro = lado === LADO.FAMILIA ? LADO.ASISTENTE : LADO.FAMILIA;
  await supabase
    .from('mensajes_marketplace')
    .update({ leido_at: new Date().toISOString() })
    .eq('conversacion_id', conversacion.id)
    .eq('lado', delOtro)
    .is('leido_at', null);
}

/**
 * Guarda un mensaje y avisa al otro lado.
 *
 * Lo que la base tapa no llega a guardarse: el disparador de `mensajes_marketplace` tapa el texto
 * antes de escribirlo, así que lo que vuelve de la base ya viene tapado, y es lo que hay.
 */
export async function escribirMensaje({ conversacion, lado, autorUsuarioId, cuerpo, automatico = false }) {
  const { data, error } = await supabase
    .from('mensajes_marketplace')
    .insert({
      prestadora_id: conversacion.prestadora_id,
      conversacion_id: conversacion.id,
      lado,
      autor_usuario_id: autorUsuarioId,
      cuerpo,
      automatico,
    })
    .select('id, lado, cuerpo, automatico, created_at, leido_at, regla_tapada')
    .single();

  if (error) throw error;

  await supabase
    .from('conversaciones_marketplace')
    .update({ ultimo_mensaje_at: data.created_at })
    .eq('id', conversacion.id);

  avisarAlOtroLado({ conversacion, lado });
  return data;
}

/* El aviso al celular no lleva el mensaje adentro. Dos motivos, y los dos alcanzan solos: un
   aviso se lee en la pantalla bloqueada, delante de cualquiera que esté al lado; y el cuerpo sin
   tapar es justamente el dato que el Marketplace vende. Dice que hay algo nuevo y dónde está. */
function avisarAlOtroLado({ conversacion, lado }) {
  const aviso = {
    titulo: 'Mensaje nuevo',
    cuerpo: 'Tiene un mensaje nuevo en el chat.',
  };
  const envio =
    lado === LADO.FAMILIA
      ? enviarPushAsistente(conversacion.asistente_id, { ...aviso, url: `/mensajes/${conversacion.id}` })
      : enviarPushFamilia(conversacion.familia_id, { ...aviso, url: `/mensajes/${conversacion.id}` });

  envio.catch((err) => console.error('Error enviando push de mensaje del Marketplace:', err.message));
}

function salaVigente(conversacion) {
  if (!conversacion.sala_videollamada) return null;
  return salaAbiertaSigueValiendo(conversacion.sala_abierta_at) ? conversacion.sala_videollamada : null;
}

/**
 * La videollamada que está pasando ahora en este hilo, si hay alguna.
 *
 * Es lo que hace que el otro lado pueda entrar: el aviso que queda escrito en el hilo dice que
 * empezó una, y la dirección sale de acá. Vencida la sala, contesta que no hay ninguna, y el
 * aviso viejo queda como lo que es, una constancia de que aquella vez se hablaron.
 *
 * @returns {Promise<{url: string}|null>}
 */
export async function videollamadaEnCurso(conversacion) {
  const sala = salaVigente(conversacion);
  if (!sala) return null;
  const base = await direccionDeVideollamada(conversacion.prestadora_id);
  const url = urlDeSala(base, sala);
  return url ? { url } : null;
}

/**
 * Abre una videollamada: estrena la sala, la deja anotada y avisa en el hilo.
 *
 * Si la de hace un rato todavía vale, entra a ésa: dos personas que tocan el botón casi juntas
 * tienen que terminar en la misma sala, no en dos vacías.
 *
 * @returns {Promise<{url: string}|null>} null donde la Prestadora no configuró proveedor.
 */
export async function abrirVideollamada({ conversacion, lado, autorUsuarioId }) {
  const base = await direccionDeVideollamada(conversacion.prestadora_id);
  if (!base) return null;

  const enCurso = salaVigente(conversacion);
  if (enCurso) return { url: urlDeSala(base, enCurso) };

  const sala = nombreDeSalaNuevo();
  const abiertaAt = new Date().toISOString();

  const { error } = await supabase
    .from('conversaciones_marketplace')
    .update({ sala_videollamada: sala, sala_abierta_at: abiertaAt })
    .eq('id', conversacion.id);
  if (error) throw error;

  conversacion.sala_videollamada = sala;
  conversacion.sala_abierta_at = abiertaAt;

  // El aviso en el hilo es lo que le hace sonar el teléfono al otro lado. Sin él, la sala existe
  // y no la sabe nadie.
  await escribirMensaje({
    conversacion,
    lado,
    autorUsuarioId,
    cuerpo: AVISO_AUTOMATICO.VIDEOLLAMADA,
    automatico: true,
  });

  return { url: urlDeSala(base, sala) };
}
