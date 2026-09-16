import { supabase } from '../db/connection.js';
import { enviarPushAsistente } from './push.js';
import { avisarPorWhatsapp } from './whatsapp.js';
import { configuracionEvento } from './email.js';
import { seSuperponen } from './horarios.js';
import { aviso } from '../i18n/avisos.js';

/*
 * La fase automática de la escalada de relevo.
 * ============================================
 *
 * QUÉ PASA ANTES DE ACÁ. Un Asistente faltó y nadie lo relevó, así que quedó abierto un incidente
 * de continuidad. A quien coordina se le insiste con la frecuencia que la Prestadora configuró, y
 * si no reacciona el aviso pasa a su respaldo. Cuando se agota también ese plazo —y sólo si la
 * Prestadora encendió `fase_automatica_activa`— el sistema deja de esperar a una persona y sale a
 * buscar quién cubre. Eso es lo que hace este archivo.
 *
 * A QUIÉN SE LE ESCRIBE, Y EN QUÉ ORDEN, LO DECIDE LA PRESTADORA. Está en
 * `configuracion_escalada_relevo`: una fila por nivel, con `orden_prioridad` —los roles, en el
 * orden en que quiere que se los llame— y `plantilla_mensaje`, que es el texto que ella escribió.
 * Acá no hay ningún orden escrito: si la fila del nivel no existe o no tiene orden cargado, no se
 * contacta a nadie y quien coordina se entera de por qué.
 *
 * SE LES ESCRIBE A TODOS JUNTOS, no de a uno esperando respuesta. La guardia ya empezó o está por
 * empezar y el Paciente está sin nadie: preguntarle a uno, esperar y recién después preguntarle al
 * siguiente gasta justo lo único que no sobra. El orden igual se respeta, porque es el orden en
 * que la Prestadora quiere que aparezcan los candidatos, y quien queda nombrado por dos roles se
 * contacta una sola vez.
 *
 * EL FAMILIAR NO ENTRA ACÁ. Que un familiar cubra una guardia no es asignarle trabajo a alguien
 * del plantel: es una excepción que una persona de la Prestadora autoriza y firma
 * (`excepciones_familiar_relevo`, con quién la autorizó y por qué motivo). El sistema no la puede
 * tomar por su cuenta. Si el orden de la Prestadora llega a ese rol, se le dice a quien coordina
 * que ese escalón le queda a él.
 */

/** Los roles del orden de prioridad a los que este proceso sí les puede escribir. */
export const ROLES_DE_PERSONAL = ['suplente', 'franquero', 'emergencia'];

/** El rol que no se contacta solo, porque hace falta que alguien lo autorice. */
export const ROL_FAMILIAR = 'familiar';

const EVENTO_INCIDENTE = 'incidente_relevo_sin_resolver';

/**
 * La lista final de a quiénes se les escribe, en el orden que pidió la Prestadora.
 *
 * Función pura para que se pueda probar sola: recibe el orden de roles y quiénes hay en cada uno,
 * y devuelve los identificadores sin repetir. Quien está en dos roles queda en el primero que lo
 * nombra — recibir dos veces el mismo pedido no lo hace más disponible.
 */
export function aQuienesSeLesEscribe(ordenPrioridad, porRol) {
  const vistos = new Set();
  const lista = [];

  for (const rol of ordenPrioridad ?? []) {
    for (const asistenteId of porRol.get(rol) ?? []) {
      if (vistos.has(asistenteId)) continue;
      vistos.add(asistenteId);
      lista.push({ asistenteId, rol });
    }
  }

  return lista;
}

/** Quiénes están anotados en el roster de emergencia de la Prestadora, por tipo. */
async function personalDeEmergencia(prestadoraId) {
  const { data, error } = await supabase
    .from('personal_emergencia')
    .select('asistente_id, tipo, asistentes(estado, disponible_para_ofertas)')
    .eq('prestadora_id', prestadoraId)
    .eq('activo', true);

  if (error) throw new Error(error.message);

  const porTipo = new Map();
  for (const fila of data ?? []) {
    // Quien se fue de la Prestadora sigue anotado en el roster y no es un candidato peor puesto:
    // no es un candidato. Mismo criterio que `estaEnElPlantel` en el panel de cobertura.
    if (fila.asistentes?.estado !== 'activo') continue;
    // Y quien dijo que no está disponible tampoco. Estar anotado en el roster de emergencia no
    // convierte a nadie en alguien a quien se le escribe igual: el interruptor lo mueve el
    // Asistente y esto es exactamente lo que apaga (`asistentes.disponible_para_ofertas`).
    if (fila.asistentes?.disponible_para_ofertas === false) continue;
    if (!porTipo.has(fila.tipo)) porTipo.set(fila.tipo, []);
    porTipo.get(fila.tipo).push(fila.asistente_id);
  }
  return porTipo;
}

/**
 * Los suplentes: el plantel activo, sin el que faltó y sin los que ya están en otra guardia a esa
 * misma hora.
 *
 * Que dos guardias se pisen no se decide restando horas acá: lo dice `seSuperponen()`, que sabe que
 * la guardia de noche termina al día siguiente (`utils/horarios.js`).
 */
async function suplentesDisponibles(prestadoraId, guardia) {
  const { data: plantel, error } = await supabase
    .from('asistentes')
    .select('id')
    .eq('prestadora_id', prestadoraId)
    .eq('estado', 'activo')
    // El interruptor que mueve el Asistente. Acá se respeta sin preguntar, y esa es la
    // diferencia con el panel de cobertura: allá la lista la lee una persona, que puede decidir
    // llamarlo igual; acá no hay nadie leyendo, sale un mensaje solo.
    .eq('disponible_para_ofertas', true);

  if (error) throw new Error(error.message);

  const { data: guardiasDelDia, error: errorGuardias } = await supabase
    .from('guardias')
    .select('id, asistente_id, fecha, hora_inicio, hora_fin, dias_hasta_el_fin')
    .eq('prestadora_id', prestadoraId)
    .neq('estado', 'cancelada')
    .not('asistente_id', 'is', null)
    .in('fecha', [fechaAnterior(guardia.fecha), guardia.fecha]);

  if (errorGuardias) throw new Error(errorGuardias.message);

  const ocupados = new Set(
    (guardiasDelDia ?? [])
      .filter((otra) => otra.id !== guardia.id && seSuperponen(otra, guardia))
      .map((otra) => otra.asistente_id),
  );

  return (plantel ?? [])
    .map((a) => a.id)
    .filter((id) => id !== guardia.asistente_id && !ocupados.has(id));
}

/**
 * El día anterior al de la guardia.
 *
 * Se mira también ese día porque una guardia que empezó a las 22:00 sigue corriendo a las 02:00 del
 * día siguiente: buscando sólo por la fecha de la guardia entrante, quien está adentro de una
 * guardia de noche aparecería libre.
 */
function fechaAnterior(fechaISO) {
  const dia = new Date(`${fechaISO}T00:00:00`);
  dia.setDate(dia.getDate() - 1);
  return dia.toISOString().slice(0, 10);
}

/**
 * Sale a buscar quién cubre la guardia del incidente.
 *
 * @returns {Promise<{contactados: number, sinNivel: boolean, sinOrden: boolean, quedaElFamiliar: boolean}>}
 *   lo que hizo, para que quien llama se lo pueda contar a quien coordina. Este proceso no resuelve
 *   el incidente ni asigna a nadie: pregunta quién puede, y quien conteste lo toma una persona.
 */
export async function correrFaseAutomatica({ incidente, prestadoraId, idioma }) {
  const sinHacerNada = { contactados: 0, sinNivel: false, sinOrden: false, quedaElFamiliar: false };

  const { data: nivel } = await supabase
    .from('configuracion_escalada_relevo')
    .select('orden_prioridad, plantilla_mensaje')
    .eq('prestadora_id', prestadoraId)
    .eq('nivel', incidente.nivel_actual)
    .maybeSingle();

  if (!nivel) return { ...sinHacerNada, sinNivel: true };

  const rolesPedidos = (nivel.orden_prioridad ?? []).filter(Boolean);
  if (rolesPedidos.length === 0) return { ...sinHacerNada, sinOrden: true };

  const { data: guardia } = await supabase
    .from('guardias')
    .select('id, asistente_id, fecha, hora_inicio, hora_fin, dias_hasta_el_fin')
    .eq('id', incidente.guardia_entrante_id)
    .single();

  if (!guardia) return sinHacerNada;

  const porRol = await personalDeEmergencia(prestadoraId);
  if (rolesPedidos.includes('suplente')) {
    porRol.set('suplente', await suplentesDisponibles(prestadoraId, guardia));
  }

  const destinatarios = aQuienesSeLesEscribe(
    rolesPedidos.filter((rol) => ROLES_DE_PERSONAL.includes(rol)),
    porRol,
  );

  const { titulo } = aviso('convocatoria_de_relevo', idioma, {
    fecha: guardia.fecha,
    horaInicio: guardia.hora_inicio,
    horaFin: guardia.hora_fin,
  });
  // El cuerpo es el texto que escribió la Prestadora para ese nivel, tal cual. No se le agrega
  // nada ni se le reemplaza nada: es el mensaje que ella eligió mandarle a su gente, y el Panel
  // se lo muestra a quien coordina con esas mismas palabras (pantalla de Continuidad).
  const cuerpo = nivel.plantilla_mensaje;

  const config = await configuracionEvento(EVENTO_INCIDENTE, prestadoraId);
  let contactados = 0;
  for (const { asistenteId } of destinatarios) {
    if (await avisarAlAsistente({ prestadoraId, asistenteId, titulo, cuerpo, config })) contactados += 1;
  }

  return {
    contactados,
    sinNivel: false,
    sinOrden: false,
    quedaElFamiliar: rolesPedidos.includes(ROL_FAMILIAR),
  };
}

/**
 * Le llega al celular, y si no, por WhatsApp.
 *
 * Es el mismo criterio que los avisos de rutina al Asistente (`revisarRecordatoriosPush.js`): el
 * push no cuesta nada y llega a quien tiene la aplicación abierta; el mensaje se manda sólo cuando
 * el push no salió, para no pagar dos veces el mismo aviso. La diferencia con los de rutina es que
 * acá no se calla un error: si no se pudo contactar a alguien, quien coordina tiene que saber a
 * cuántos se llegó de verdad.
 */
async function avisarAlAsistente({ prestadoraId, asistenteId, titulo, cuerpo, config }) {
  const porPush = await enviarPushAsistente(asistenteId, { titulo, cuerpo, url: '/' });
  if (porPush) return true;

  const { data: asistente } = await supabase
    .from('asistentes')
    .select('telefono')
    .eq('id', asistenteId)
    .single();
  if (!asistente?.telefono) return false;

  try {
    // Lo empieza la Prestadora, así que sale por la plantilla que le eligió al aviso de incidentes.
    return await avisarPorWhatsapp({ config, prestadoraId, telefono: asistente.telefono, valores: [titulo, cuerpo] });
  } catch (err) {
    console.error(`Error convocando por WhatsApp al asistente ${asistenteId}:`, err.message);
    return false;
  }
}
