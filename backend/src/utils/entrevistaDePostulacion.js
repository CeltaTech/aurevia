/* La entrevista de una postulación.
   =================================

   QUÉ ES. La tercera etapa del Proceso de Incorporación de Asistentes
   (`docs/PRD_03_Reclutamiento.md`): la Prestadora entrevista a quien se postuló. Antes esto
   pasaba por afuera —un llamado, un correo— y de la entrevista quedaba una casilla marcada a
   mano, que no decía cuándo fue, quién la hizo ni si la persona se presentó. Ahora pasa adentro:
   se agenda, se hace por videollamada y queda la constancia.

   Y ASÍ NADIE SE PASA DATOS DE CONTACTO. Coordinar por afuera obliga a quien entrevista a dar su
   teléfono o su correo personal a alguien que todavía es un postulante. Es el mismo motivo por el
   que la Familia y el Asistente del Marketplace se hablan por adentro.

   EL POSTULANTE NO TIENE CUENTA, y por eso todo acá gira alrededor de una llave. Todavía no es
   Asistente: no hay a quién darle una sesión. La llave es larga, no se deduce de ningún dato suyo
   y viaja por el correo que él mismo dejó en su postulación.

   LA LLAVE NO ES LA SALA. Lleva a una pantalla del producto, que pregunta acá si es la hora antes
   de dar la dirección de la sala. De eso salen tres cosas: la dirección de la sala no viaja nunca
   por correo; reprogramar no obliga a mandar una llave nueva, porque la vieja sigue sirviendo; y
   quien llega a deshora recibe una explicación en vez de una sala vacía.

   QUIÉN ARMA LAS FRASES. Ninguna de acá. El texto de los correos vive en `i18n/avisos.js`, en los
   tres idiomas, y sale en el idioma que la persona eligió al postularse (`postulaciones.idioma`).

   LA SALA PUEDE NO EXISTIR, Y LA ENTREVISTA SE AGENDA IGUAL. Donde la Prestadora no configuró
   dónde se hacen sus videollamadas, agendar sirve lo mismo: deja acordado el día y la hora y deja
   la constancia. Lo que no hay es sala, y eso la pantalla lo dice. El producto no prohíbe: avisa
   (`celtatech/CLAUDE.md` §7). */

import crypto from 'crypto';
import { supabase } from '../db/connection.js';
import { ErrorConMotivo } from './errorConMotivo.js';
import { enviarEmail } from './email.js';
import { marcaDeLaPrestadora } from './marcaPrestadora.js';
import { aviso } from '../i18n/avisos.js';
import { normalizarIdioma } from '../i18n/idiomas.js';
import {
  MINUTOS_DE_ANTICIPO,
  direccionDeVideollamada,
  momentoDeLaCita,
  nombreDeSalaNuevo,
  urlDeSala,
} from './videollamada.js';

/** Las cuatro situaciones de una entrevista. Sólo la primera está viva. */
export const ESTADO_ENTREVISTA = {
  AGENDADA: 'agendada',
  REALIZADA: 'realizada',
  NO_ASISTIO: 'no_asistio',
  CANCELADA: 'cancelada',
};

/** Con qué se cierra una entrevista. Cancelarla es otra cosa y tiene su propia función: cancelar
 *  es que no va a pasar, y cerrar es que ya pasó. */
export const CIERRES = [ESTADO_ENTREVISTA.REALIZADA, ESTADO_ENTREVISTA.NO_ASISTIO];

const COLUMNAS = `
  id, prestadora_id, postulacion_id, agendada_para, llave_publica, sala_videollamada,
  estado, agendada_por, cerrada_por, cerrada_at, observaciones, created_at
`;

/* El día y la hora tal como los va a leer la persona, en su idioma. Se arma acá y no adentro del
   catálogo de avisos porque el catálogo recibe hechos ya resueltos y no los va a buscar.

   El producto todavía no guarda huso horario por Prestadora, así que la hora sale en la del
   servidor. Se nota nada más cuando la Prestadora y quien se postula están en husos distintos, y
   la salida es la misma columna que haría falta para todo lo demás que tiene hora: cuando exista,
   se pasa por acá y ninguna otra parte cambia. */
function cuandoEnPalabras(agendadaPara, idioma) {
  return new Intl.DateTimeFormat(normalizarIdioma(idioma), {
    dateStyle: 'full',
    timeStyle: 'short',
  }).format(new Date(agendadaPara));
}

/** A quién se le escribe y en qué idioma. Todo eso ya está en la postulación: es lo que la
 *  persona dejó cuando se postuló. */
async function datosDelPostulante(postulacionId, prestadoraId) {
  const { data, error } = await supabase
    .from('postulaciones')
    .select('id, nombre, email, idioma, prestadora_id')
    .eq('id', postulacionId)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) throw new ErrorConMotivo('no_encontrado', 'No existe esa postulación');
  return data;
}

/* El correo no corta la operación si falla. La entrevista quedó agendada y eso es lo que importa;
   un servidor de correo caído no puede deshacer una cita que las dos partes ya acordaron. Queda
   registrado para que alguien lo mire. */
async function avisarAlPostulante({ clave, entrevista, postulante, prestadoraId }) {
  const panelUrl = String(process.env.PANEL_URL || '').replace(/\/+$/, '');
  if (!panelUrl) {
    console.error('entrevistaDePostulacion: falta PANEL_URL, no se le avisó al postulante');
    return;
  }

  try {
    const marca = await marcaDeLaPrestadora(prestadoraId);
    const { titulo, cuerpo } = aviso(clave, postulante.idioma, {
      prestadora: marca?.nombre || '',
      cuando: cuandoEnPalabras(entrevista.agendada_para, postulante.idioma),
      enlace: `${panelUrl}/entrevista/${entrevista.llave_publica}`,
      anticipo: MINUTOS_DE_ANTICIPO,
    });

    await enviarEmail({ to: postulante.email, asunto: titulo, texto: cuerpo, prestadoraId });
  } catch (err) {
    console.error(`entrevistaDePostulacion: no se pudo avisar de "${clave}":`, err.message);
  }
}

/** La entrevista viva de una postulación, o null. Es la única que se puede mover o cerrar. */
export async function entrevistaViva({ prestadoraId, postulacionId }) {
  const { data, error } = await supabase
    .from('entrevistas_postulacion')
    .select(COLUMNAS)
    .eq('prestadora_id', prestadoraId)
    .eq('postulacion_id', postulacionId)
    .eq('estado', ESTADO_ENTREVISTA.AGENDADA)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data || null;
}

/** Todas las entrevistas de una postulación, la última primero. Es la historia: quien la mira
 *  quiere ver que a esta persona se le reprogramó dos veces y no se presentó. */
export async function entrevistasDeLaPostulacion({ prestadoraId, postulacionId }) {
  const { data, error } = await supabase
    .from('entrevistas_postulacion')
    .select(COLUMNAS)
    .eq('prestadora_id', prestadoraId)
    .eq('postulacion_id', postulacionId)
    .order('agendada_para', { ascending: false });

  if (error) throw new Error(error.message);
  return data || [];
}

function comprobarFecha(agendadaPara) {
  const cuando = new Date(agendadaPara).getTime();
  if (!Number.isFinite(cuando)) {
    throw new ErrorConMotivo('fecha_invalida', 'La fecha de la entrevista no se entiende');
  }
  // Agendar para ayer no es un error de tipeo con arreglo automático: es una cita a la que nadie
  // puede ir, y la puerta ya estaría cerrada antes de mandar el correo.
  if (cuando < Date.now()) {
    throw new ErrorConMotivo('entrevista_en_el_pasado', 'La entrevista quedaría en el pasado');
  }
  return new Date(cuando).toISOString();
}

/**
 * Agenda la entrevista de una postulación y le avisa al postulante.
 *
 * Si ya hay una agendada, no crea una segunda: falla y dice que ya hay una. Moverla es
 * `reprogramar`, que es una acción distinta y manda otro correo.
 */
export async function agendarEntrevista({ prestadoraId, postulacionId, agendadaPara, usuarioId }) {
  const cuando = comprobarFecha(agendadaPara);
  const postulante = await datosDelPostulante(postulacionId, prestadoraId);

  if (await entrevistaViva({ prestadoraId, postulacionId })) {
    throw new ErrorConMotivo('entrevista_ya_agendada', 'Esa postulación ya tiene una entrevista agendada');
  }

  // La sala se estrena con la entrevista y muere con ella. Donde la Prestadora no configuró
  // dirección base, la entrevista igual se agenda y la sala queda en null: el día de la cita la
  // pantalla avisa que no hay videollamada configurada.
  const base = await direccionDeVideollamada(prestadoraId);

  const { data, error } = await supabase
    .from('entrevistas_postulacion')
    .insert({
      prestadora_id: prestadoraId,
      postulacion_id: postulacionId,
      agendada_para: cuando,
      llave_publica: crypto.randomBytes(32).toString('base64url'),
      sala_videollamada: base ? nombreDeSalaNuevo() : null,
      agendada_por: usuarioId,
    })
    .select(COLUMNAS)
    .single();

  // Dos personas agendando a la vez: el índice único deja pasar una sola. La que perdió no falló
  // por una razón que haya que explicar con un número de restricción — ya hay una entrevista.
  if (error) {
    if (await entrevistaViva({ prestadoraId, postulacionId })) {
      throw new ErrorConMotivo('entrevista_ya_agendada', 'Esa postulación ya tiene una entrevista agendada');
    }
    throw new Error(error.message);
  }

  await avisarAlPostulante({
    clave: 'entrevista_agendada',
    entrevista: data,
    postulante,
    prestadoraId,
  });
  return data;
}

/**
 * Mueve la entrevista viva a otro día.
 *
 * La llave y la sala no cambian: es la misma entrevista en otro momento, y cambiarlas obligaría a
 * que el postulante fuera a buscar el correo nuevo en vez de usar el que ya tiene.
 */
export async function reprogramarEntrevista({ prestadoraId, postulacionId, agendadaPara }) {
  const cuando = comprobarFecha(agendadaPara);
  const viva = await entrevistaViva({ prestadoraId, postulacionId });
  if (!viva) throw new ErrorConMotivo('no_encontrado', 'No hay ninguna entrevista agendada');

  const postulante = await datosDelPostulante(postulacionId, prestadoraId);

  const { data, error } = await supabase
    .from('entrevistas_postulacion')
    .update({ agendada_para: cuando })
    .eq('id', viva.id)
    .eq('estado', ESTADO_ENTREVISTA.AGENDADA)
    .select(COLUMNAS)
    .single();

  if (error) throw new Error(error.message);

  await avisarAlPostulante({
    clave: 'entrevista_reprogramada',
    entrevista: data,
    postulante,
    prestadoraId,
  });
  return data;
}

/**
 * Cancela la entrevista viva: no va a pasar.
 *
 * La sala se borra en el momento. Quien tenga la dirección de antes no entra a ningún lado, y eso
 * es lo que se espera de una cita cancelada.
 */
export async function cancelarEntrevista({ prestadoraId, postulacionId, usuarioId, observaciones = null }) {
  const viva = await entrevistaViva({ prestadoraId, postulacionId });
  if (!viva) throw new ErrorConMotivo('no_encontrado', 'No hay ninguna entrevista agendada');

  const postulante = await datosDelPostulante(postulacionId, prestadoraId);

  const { data, error } = await supabase
    .from('entrevistas_postulacion')
    .update({
      estado: ESTADO_ENTREVISTA.CANCELADA,
      sala_videollamada: null,
      cerrada_por: usuarioId,
      cerrada_at: new Date().toISOString(),
      observaciones,
    })
    .eq('id', viva.id)
    .eq('estado', ESTADO_ENTREVISTA.AGENDADA)
    .select(COLUMNAS)
    .single();

  if (error) throw new Error(error.message);

  await avisarAlPostulante({
    clave: 'entrevista_cancelada',
    entrevista: viva,
    postulante,
    prestadoraId,
  });
  return data;
}

/**
 * Cierra la entrevista viva diciendo cómo salió: se hizo, o la persona no se presentó.
 *
 * No toca la situación de la postulación. Haber entrevistado a alguien no es haberlo aprobado, y
 * decidir eso es de quien mira la postulación, en su propia pantalla.
 *
 * Al postulante no se le avisa: lo que pasa acá es la anotación interna de una entrevista en la
 * que él estuvo, y un correo diciéndole «quedó registrado que usted no se presentó» no le sirve
 * para nada.
 */
export async function cerrarEntrevista({ prestadoraId, postulacionId, estado, usuarioId, observaciones = null }) {
  if (!CIERRES.includes(estado)) {
    throw new ErrorConMotivo('faltan_datos', 'Ese no es un cierre de entrevista');
  }

  const viva = await entrevistaViva({ prestadoraId, postulacionId });
  if (!viva) throw new ErrorConMotivo('entrevista_ya_cerrada', 'No hay ninguna entrevista agendada');

  const { data, error } = await supabase
    .from('entrevistas_postulacion')
    .update({
      estado,
      sala_videollamada: null,
      cerrada_por: usuarioId,
      cerrada_at: new Date().toISOString(),
      observaciones,
    })
    .eq('id', viva.id)
    .eq('estado', ESTADO_ENTREVISTA.AGENDADA)
    .select(COLUMNAS)
    .single();

  if (error) throw new Error(error.message);
  return data;
}

/**
 * Lo que ve quien llega con una llave. Es la única puerta del postulante.
 *
 * FALLA CERRADO. Llave que no existe, entrevista que ya se cerró o que no es hoy: no sale ninguna
 * dirección de sala. Y no cuenta si la llave existe o no: las dos cosas contestan lo mismo, así
 * que probar llaves no dice nada.
 *
 * NO SALE NINGÚN DATO DE MÁS. Quien tiene la llave se entera de con qué Prestadora es su
 * entrevista, cuándo, y —si es la hora— dónde entrar. Nada del postulante, nada de quien
 * entrevista y nada de lo que se haya anotado por dentro.
 *
 * @returns {Promise<{prestadora: string, agendada_para: string, momento: string, url: string|null}>}
 */
export async function entrevistaPorLlave(llave) {
  const limpia = String(llave || '').trim();
  const noExiste = new ErrorConMotivo('no_encontrado', 'Esa entrevista no existe');
  if (!limpia) throw noExiste;

  const { data, error } = await supabase
    .from('entrevistas_postulacion')
    .select(COLUMNAS)
    .eq('llave_publica', limpia)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data || data.estado !== ESTADO_ENTREVISTA.AGENDADA) throw noExiste;

  const marca = await marcaDeLaPrestadora(data.prestadora_id);
  const momento = momentoDeLaCita(data.agendada_para);

  // La dirección de la sala sale únicamente cuando es la hora. Fuera de la ventana la pantalla
  // recibe el cuándo, que es lo que necesita para decirle a la persona que vuelva.
  let url = null;
  if (momento === 'ahora' && data.sala_videollamada) {
    url = urlDeSala(await direccionDeVideollamada(data.prestadora_id), data.sala_videollamada);
  }

  return {
    prestadora: marca?.nombre || '',
    logo_url: marca?.logoUrl || null,
    agendada_para: data.agendada_para,
    momento,
    // Que esta entrevista no tenga sala es distinto de que todavía no sea la hora, y la pantalla
    // dice cosas distintas: una se arregla volviendo más tarde y la otra no se arregla sola.
    hay_videollamada: Boolean(data.sala_videollamada),
    url,
  };
}
