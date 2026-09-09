import { distanciaMetros } from './reporteIA.js';
import { conPacientes } from './pacientesDeGuardia.js';
import { conDomicilioDelDia } from './domicilioDelDia.js';
import { horaEstimadaDeLlegada } from './llegadaEstimada.js';

// A qué hora se estima que llega quien ya marcó la salida (pendiente #101).
//
// LA CUENTA NO ESTÁ ACÁ: está en `llegadaEstimada.js`, que es el punto único de verdad y vive
// también del lado del Panel. Este archivo es lo que le falta a esa cuenta para poder hacerse
// contra la base: de dónde salió la persona, a qué domicilio va, y qué domicilio rige ese día.
//
// CONTRA QUÉ DOMICILIO SE MIDE. Contra el que rige la fecha de esa guardia, no el de la ficha —el
// mismo criterio que ya usa el check-in—: quien está pasando una temporada en la casa de un hijo
// se atiende ahí, y medir contra la casa de siempre daría una estimación falsa. Con varios
// Pacientes se mide contra el más cercano, por el mismo motivo que en el check-in.
//
// DEVUELVE `null` SIN INVENTAR NADA. Sin marca de salida, sin punto de salida o sin coordenadas
// del domicilio no hay estimación, y eso se dice: quien llama tiene que distinguir «no se sabe»
// de «llega a horario». Una hora inventada parece confiable y nadie la vuelve a mirar.
//
// LAS COORDENADAS NO SALEN DE ACÁ. Lo que devuelve es una hora, nunca un punto. El lugar del que
// salió el Asistente es casi siempre su casa, y eso no viaja a ninguna pantalla: ni a la de la
// Familia, ni a la del Coordinador.

/**
 * La hora estimada de llegada de cada guardia, por id.
 *
 * @param {Array<object>} guardias filas con `id`, `fecha`, `paciente_id`, `salida_checkin_at`,
 *   `salida_lat` y `salida_lng`
 * @returns {Promise<Map<string, Date|null>>}
 */
export async function llegadaEstimadaDeGuardias(guardias) {
  const lista = (guardias ?? []).filter(Boolean);
  const estimadas = new Map();
  if (lista.length === 0) return estimadas;

  // Sólo se le pregunta el domicilio a las guardias que ya tienen salida marcada con punto: las
  // demás no tienen estimación posible y traer sus Pacientes sería una consulta de más.
  const conSalida = lista.filter(
    (g) => g.salida_checkin_at && typeof g.salida_lat === 'number' && typeof g.salida_lng === 'number'
  );
  for (const guardia of lista) estimadas.set(guardia.id, null);
  if (conSalida.length === 0) return estimadas;

  // Acá no se pide `domicilio` a propósito, igual que en el check-in: esto mide una distancia,
  // no muestra una dirección.
  const conSuGente = await conDomicilioDelDia(await conPacientes(conSalida, 'id, lat, lng'));

  for (const guardia of conSuGente) {
    const distancias = (guardia.pacientes ?? [])
      .filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number')
      .map((p) => distanciaMetros(guardia.salida_lat, guardia.salida_lng, p.lat, p.lng));
    if (distancias.length === 0) continue;

    estimadas.set(
      guardia.id,
      horaEstimadaDeLlegada({ salidaAt: guardia.salida_checkin_at, metros: Math.min(...distancias) })
    );
  }

  return estimadas;
}

/** Lo mismo para una sola guardia. */
export async function llegadaEstimadaDeGuardia(guardia) {
  if (!guardia) return null;
  const estimadas = await llegadaEstimadaDeGuardias([guardia]);
  return estimadas.get(guardia.id) ?? null;
}
