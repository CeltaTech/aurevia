// Dónde se atiende a cada Paciente el día de su guardia, del lado del motor.
//
// POR QUÉ EXISTE. El Paciente tiene una sola dirección, la de su ficha, y hay temporadas en que
// no está ahí: el verano en la casa de un hijo, una internación, una mudanza mientras arreglan
// el departamento. Esas temporadas se cargan desde el Panel en
// `domicilios_temporales_paciente`, pero hasta acá nadie las preguntaba, así que todo el
// producto seguía mandando gente a la casa de siempre. Lo que se rompía con eso no era
// prolijidad: el check-in medía la distancia contra la casa de siempre, la daba por fuera de
// rango y le mandaba al Coordinador un aviso automático que era un falso positivo.
//
// LA REGLA NO VIVE ACÁ, Y ES A PROPÓSITO (regla 12 de CLAUDE.md §7). Cuál dirección gana un día
// dado —la temporal vigente, o la de la ficha si no hay ninguna— lo decide una sola vez la
// función `public.domicilios_de_pacientes_en`, escrita en la migración
// 20260821220000_donde_se_atiende_al_paciente_este_dia.sql. Este archivo no vuelve a comparar
// fechas ni a elegir: pregunta y aplica lo que le contestan. Si mañana el criterio cambia
// —porque una internación deja de contar, por ejemplo—, cambia en la base y llega solo a las
// dos aplicaciones y al Panel.
//
// UNA PREGUNTA POR FECHA, NO UNA POR PACIENTE. La lista de turnos del Asistente trae cien
// guardias de golpe. Preguntar de a un Paciente serían cien viajes a la base para contestar
// algo que cambia por día y no por persona: se agrupa por fecha y se pregunta una vez por cada
// día distinto. Una semana de turnos son siete preguntas como mucho.
//
// LO QUE NO SE PIDIÓ, NO SE COMPLETA. La Prestadora puede tener apagado el interruptor
// `asistente_domicilio_del_paciente`, y entonces la consulta que trajo a los Pacientes ni
// siquiera pidió la dirección: el dato no viaja al teléfono de nadie (tarea 65). Acá se mira
// qué campos trae cada Paciente y se pisan solamente esos — a un Paciente que vino sin
// dirección no se le inventa una, ni temporal ni de la ficha.

import { supabase } from '../db/connection.js';

// Los tres campos de la ficha que contestan "¿dónde se lo atiende?". Cada consulta pide los que
// necesita: la pantalla de una guardia pide los tres, el check-in solamente las coordenadas
// —mide una distancia, no muestra una dirección—, y una Prestadora con el interruptor apagado
// no pide ninguno.
const CAMPOS_DE_UBICACION = ['domicilio', 'lat', 'lng'];

/**
 * ¿Esta consulta pidió saber dónde se atiende a este Paciente?
 *
 * Se mira si el campo **está**, no si tiene valor: un Paciente sin dirección cargada en la ficha
 * igual puede tener una temporal ese día, y ahí la respuesta correcta es la temporal. Lo que no
 * se pidió es lo que no hay que completar.
 */
function pidioLaDireccion(paciente) {
  return CAMPOS_DE_UBICACION.some((campo) => Object.hasOwn(paciente, campo));
}

/** La misma llave a los dos lados: un Paciente en un día es una respuesta. */
function llave(fecha, pacienteId) {
  return `${fecha}|${pacienteId}`;
}

/**
 * Le aplica a un Paciente la dirección que le corresponde ese día.
 *
 * Pisa `domicilio`, `lat` y `lng` —los que hayan venido— en vez de agregar campos nuevos al
 * lado: así ninguna pantalla de hoy tiene que enterarse de que existen las direcciones
 * temporales para mostrar la correcta. Lo que sí se agrega son los dos campos que dicen que la
 * dirección de hoy no es la de siempre, que es lo que le permite a la aplicación avisarlo.
 */
function conSuDireccionDelDia(paciente, resuelto) {
  if (!paciente || !resuelto || !pidioLaDireccion(paciente)) return paciente;

  const delDia = { ...paciente };
  if (Object.hasOwn(paciente, 'domicilio')) delDia.domicilio = resuelto.domicilio ?? null;
  if (Object.hasOwn(paciente, 'lat')) delDia.lat = resuelto.lat ?? null;
  if (Object.hasOwn(paciente, 'lng')) delDia.lng = resuelto.lng ?? null;

  // `domicilio_es_temporal` y `domicilio_motivo` son el contrato con las dos aplicaciones: con
  // el primero dibujan el cartelito de "esta semana se lo atiende en otro lado" y con el
  // segundo explican por qué. Los nombres no se cambian.
  delDia.domicilio_es_temporal = Boolean(resuelto.es_temporal);

  // El motivo viaja pegado a la dirección y nunca solo: lo escribe el Panel a mano y puede
  // decir "internación", que es un dato de salud (CLAUDE.md §6). Donde la dirección no se
  // pidió —el check-in, que mide coordenadas y no muestra nada—, el motivo tampoco sale.
  delDia.domicilio_motivo = Object.hasOwn(paciente, 'domicilio') && resuelto.es_temporal
    ? resuelto.motivo ?? null
    : null;

  return delDia;
}

/**
 * Le pone a cada Paciente de cada guardia la dirección que rige **la fecha de esa guardia**.
 *
 * Recibe las guardias como las deja `utils/pacientesDeGuardia.js` —cada una con su `fecha` y su
 * lista `pacientes`— y devuelve la misma lista con las direcciones del día ya aplicadas. Una
 * guardia sin fecha, o sin nadie a quien atender, pasa igual y sin tocar.
 *
 * Devuelve copias: nada de lo que llegó se modifica en el lugar.
 */
export async function conDomicilioDelDia(guardias) {
  const lista = (guardias ?? []).filter(Boolean);
  if (lista.length === 0) return lista;

  // A quién hay que preguntar por cada día distinto. El conjunto evita repetir al mismo
  // Paciente cuando tiene dos turnos la misma fecha.
  const pacientesPorFecha = new Map();
  for (const guardia of lista) {
    if (!guardia.fecha || !Array.isArray(guardia.pacientes)) continue;
    for (const paciente of guardia.pacientes) {
      if (!paciente?.id || !pidioLaDireccion(paciente)) continue;
      if (!pacientesPorFecha.has(guardia.fecha)) pacientesPorFecha.set(guardia.fecha, new Set());
      pacientesPorFecha.get(guardia.fecha).add(paciente.id);
    }
  }
  if (pacientesPorFecha.size === 0) return lista;

  const resueltos = new Map();
  await Promise.all(
    [...pacientesPorFecha].map(async ([fecha, ids]) => {
      const { data, error } = await supabase.rpc('domicilios_de_pacientes_en', {
        p_pacientes: [...ids],
        p_fecha: fecha,
      });
      if (error) throw new Error(error.message);
      for (const fila of data ?? []) {
        resueltos.set(llave(fecha, fila.paciente_id), fila);
      }
    })
  );

  return lista.map((guardia) => {
    if (!Array.isArray(guardia.pacientes)) return guardia;
    return {
      ...guardia,
      pacientes: guardia.pacientes.map((paciente) =>
        conSuDireccionDelDia(paciente, resueltos.get(llave(guardia.fecha, paciente?.id)))
      ),
    };
  });
}

/**
 * Lo mismo para una sola guardia: recibe su lista de Pacientes y la devuelve con la dirección
 * del día puesta. Es la forma en que se lee mejor donde ya se tiene la guardia en la mano —el
 * check-in, sin ir más lejos—, y no repite nada: llama a la de arriba.
 */
export async function pacientesConDomicilioDelDia(guardia, pacientes) {
  const [conDia] = await conDomicilioDelDia([{ ...guardia, pacientes: pacientes ?? [] }]);
  return conDia?.pacientes ?? [];
}

/**
 * Dónde se atiende hoy a estos Pacientes.
 *
 * La Familia no está mirando un turno: está mirando a los suyos, y lo que pregunta es dónde
 * se los está atendiendo ahora. Por eso acá la fecha es la de hoy y no la de ninguna guardia.
 *
 * El día se saca igual que en todo el resto del motor, con la fecha del servidor; no hay una
 * hora por Prestadora en ningún lado del producto todavía, y resolverlo acá solo para esta
 * pantalla dejaría dos criterios de "hoy" conviviendo.
 */
export async function pacientesConDomicilioDeHoy(pacientes) {
  const hoy = new Date().toISOString().slice(0, 10);
  return pacientesConDomicilioDelDia({ fecha: hoy }, pacientes);
}
