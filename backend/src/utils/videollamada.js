/* Las salas de videollamada del producto.
   =======================================

   QUÉ ES. El producto hace videollamadas en dos lugares: el chat del Marketplace, donde una
   Familia y un Asistente se hablan antes de contratarlo, y la entrevista de reclutamiento, donde
   la Prestadora entrevista a un postulante. Son dos situaciones distintas y una sola forma de
   armar la sala, así que la forma vive acá y no adentro de ninguna de las dos.

   NO HAY PROVEEDOR ESCRITO EN EL CÓDIGO. La dirección base de las salas es de cada Prestadora y
   vive en la base (`prestadoras.videollamada_base_url`): la suya, la de quien contrate. El
   producto le agrega el nombre de la sala y nada más. Donde esa dirección está vacía no hay
   videollamada, y quien pregunta recibe `null` para que la pantalla no ofrezca un botón que no
   lleva a ningún lado. No hace falta ninguna credencial, así que no hay ninguna guardada.

   EL NOMBRE DE LA SALA ES IMPOSIBLE DE ADIVINAR, y ésa es toda su protección: quien no recibió la
   dirección no llega a ella probando. Por eso una sala no es permanente. Una dirección fija, una
   vez vista, entra para siempre; una que vence deja de servir aunque se la haya copiado.

   CUÁNTO VALE UNA SALA DEPENDE DE POR QUÉ SE ABRIÓ, y son dos respuestas distintas:

   - La del chat se abre porque alguien apretó el botón recién, y vale un rato desde ese momento.
     Quien llega dos días tarde no entra a una sala que quedó abierta: se abre otra.
   - La de la entrevista se abre al agendarla, para una cita que es a una hora. Vale alrededor de
     esa hora, no desde que se creó: si valiera desde que se creó, una entrevista agendada para la
     semana que viene nacería vencida. */

import { randomUUID } from 'node:crypto';
import { supabase } from '../db/connection.js';

/** Cuánto vale una sala que se abrió recién, en minutos. Alcanza para una conversación larga y le
 *  pone un final a la dirección. */
export const MINUTOS_QUE_VALE_UNA_SALA = 60;

/** Cuánto antes de la hora de una entrevista se puede entrar. Nadie llega exacto, y una puerta
 *  que se abre en el minuto justo deja a la gente afuera mirando el reloj. */
export const MINUTOS_DE_ANTICIPO = 15;

/** Cuánto después de la hora de una entrevista sigue valiendo la sala. Una entrevista que empezó
 *  tarde tiene que poder terminar. */
export const MINUTOS_DE_TOLERANCIA = 90;

/**
 * La dirección base de las salas de esta Prestadora, sin barra final.
 *
 * @returns {Promise<string|null>} null donde no configuró ninguna: esa Prestadora no ofrece
 *   videollamada, y eso no es un error.
 */
export async function direccionDeVideollamada(prestadoraId) {
  const { data, error } = await supabase
    .from('prestadoras')
    .select('videollamada_base_url')
    .eq('id', prestadoraId)
    .maybeSingle();

  if (error) {
    console.error('Error consultando la dirección de videollamada:', error.message);
    return null;
  }
  const base = String(data?.videollamada_base_url || '').trim();
  return base ? base.replace(/\/+$/, '') : null;
}

/** Un nombre de sala nuevo, imposible de adivinar. */
export function nombreDeSalaNuevo() {
  return randomUUID().replace(/-/g, '');
}

/** La dirección completa de una sala. Una sola forma de pegar las dos partes. */
export function urlDeSala(base, sala) {
  return base && sala ? `${base}/${sala}` : null;
}

/**
 * ¿Sigue valiendo una sala que se abrió en tal momento?
 *
 * Es la vigencia del chat: se cuenta desde que se abrió.
 */
export function salaAbiertaSigueValiendo(abiertaAt, ahora = Date.now()) {
  if (!abiertaAt) return false;
  const abiertaHace = ahora - new Date(abiertaAt).getTime();
  if (!Number.isFinite(abiertaHace)) return false;
  return abiertaHace >= 0 && abiertaHace <= MINUTOS_QUE_VALE_UNA_SALA * 60 * 1000;
}

/**
 * ¿Es hora de una cita agendada para tal momento?
 *
 * Es la vigencia de la entrevista: se cuenta alrededor de la hora acordada. Contesta las tres
 * situaciones por separado, porque quien llega antes de tiempo no está en el mismo caso que quien
 * llega cuando ya terminó, y la pantalla le dice cosas distintas.
 *
 * @returns {'todavia_no'|'ahora'|'ya_paso'}
 */
export function momentoDeLaCita(agendadaPara, ahora = Date.now()) {
  const cita = new Date(agendadaPara).getTime();
  if (!Number.isFinite(cita)) return 'ya_paso';
  if (ahora < cita - MINUTOS_DE_ANTICIPO * 60 * 1000) return 'todavia_no';
  if (ahora > cita + MINUTOS_DE_TOLERANCIA * 60 * 1000) return 'ya_paso';
  return 'ahora';
}
