// Dónde estaba viviendo cada Paciente un día determinado.
//
// La regla —cuándo manda la dirección de siempre y cuándo una temporal— está escrita una sola
// vez, en la función `domicilios_de_pacientes_en` de la base, y desde ahí la usan el motor y
// el Panel (regla 12 de CLAUDE.md §7). Este archivo no la vuelve a escribir: solamente le
// pregunta, y acomoda la respuesta para que la pantalla la pueda buscar por fecha y Paciente.
//
// Por qué hace falta acá: una pantalla que revisa turnos de días pasados no puede medir contra
// la dirección que figura hoy en la ficha. Si el Paciente pasó marzo en la casa de una hija, el
// Asistente fue ahí, y medir contra la casa de siempre lo daría lejos cuando llegó bien.

import { supabase } from './supabaseClient';

// La función de la base contesta por una fecha por vez, así que un rango largo son varias
// preguntas. Se mandan de a tandas y no todas juntas: un filtro de seis meses son ciento
// ochenta consultas, y largarlas al mismo tiempo es la forma de que la pantalla se trabe sola.
const CONSULTAS_A_LA_VEZ = 8;

/**
 * @param {Record<string, string[]>} pacientesPorFecha  qué Pacientes preguntar en cada fecha.
 * @returns {Promise<Record<string, Record<string, object>>>} fecha → Paciente → su domicilio
 *   de ese día, con `lat`, `lng`, `domicilio`, `es_temporal` y el motivo cuando lo hay.
 */
export async function domiciliosPorFecha(pacientesPorFecha) {
  const fechas = Object.keys(pacientesPorFecha).filter((f) => pacientesPorFecha[f]?.length);
  const porFecha = {};

  for (let i = 0; i < fechas.length; i += CONSULTAS_A_LA_VEZ) {
    const tanda = fechas.slice(i, i + CONSULTAS_A_LA_VEZ);
    const respuestas = await Promise.all(
      tanda.map((fecha) =>
        supabase.rpc('domicilios_de_pacientes_en', {
          p_pacientes: pacientesPorFecha[fecha],
          p_fecha: fecha,
        })
      )
    );
    respuestas.forEach(({ data, error }, indice) => {
      // Un error acá no voltea la pantalla: deja esa fecha sin domicilios, y cada turno de ese
      // día se muestra como "sin domicilio", que es exactamente lo que pasa — no se sabe.
      if (error) return;
      porFecha[tanda[indice]] = Object.fromEntries((data ?? []).map((d) => [d.paciente_id, d]));
    });
  }

  return porFecha;
}

/** El domicilio de un Paciente en una fecha, o `null` si no se pudo averiguar. */
export function domicilioDe(porFecha, fecha, pacienteId) {
  return porFecha?.[fecha]?.[pacienteId] ?? null;
}
