// Registro de adaptadores de geocodificación — qué servicio convierte una dirección escrita
// en un punto del mapa, según el país de la Prestadora.
//
// Un solo punto de verdad (CLAUDE.md §7 regla 12): cualquier ruta que guarde un domicilio
// llama a `coordenadasDeDomicilio`, nunca importa un adaptador por el nombre de su país.
//
// **Por qué adaptadores y no una llamada suelta.** El producto se vende en más de un país
// desde el día uno (CLAUDE.md §2 y regla 14). Un servicio que solo sepa de calles argentinas
// no alcanza, y llamarlo derecho desde la ruta obliga a reescribir cada lugar que guarda un
// domicilio el día que se sume otro país o cambie el proveedor. Con esta capa en el medio,
// sumar un país es agregar un archivo y una línea en la tabla de abajo.
//
// Interfaz común que todo adaptador implementa:
//   geocodificar({ direccion, localidad, provincia })
//     -> { lat, lng, confianza, fuente } | null
//     `confianza` dice hasta dónde llegó el servicio, con dos valores para todos los países:
//       'exacta'      — ubicó la altura de la calle, o sea la puerta;
//       'aproximada'  — ubicó la calle o la localidad, pero no la puerta.
//     Devuelve `null` cuando el servicio contestó bien y no encontró nada. Cuando el servicio
//     falla —se cayó, contestó un error, tardó demasiado— lanza, y quien llama decide qué
//     hacer. Lo que lanza nunca lleva la dirección adentro (CLAUDE.md §6).
//
// La dirección es dato sensible: no se escribe en registros ni en mensajes de error, ni
// siquiera para depurar.

import { supabase } from '../db/connection.js';
import * as georefAr from './georefAr.js';

// País (código ISO de dos letras, como lo guarda `prestadoras.pais`) → adaptador.
const ADAPTADORES = {
  AR: georefAr,
};

export function paisesConGeocodificador() {
  return Object.keys(ADAPTADORES);
}

/** El adaptador de ese país, o `null` si todavía no hay ninguno. **No lanza**: un país sin
 *  geocodificador no es un error, es un domicilio que se guarda sin coordenadas y ya. */
export function obtenerGeocodificador(pais) {
  return ADAPTADORES[String(pais ?? '').trim().toUpperCase()] ?? null;
}

/** Lo que se guarda cuando no se pudo ubicar la dirección: las dos columnas en nulo, nunca un
 *  punto inventado. Todo lo que mide distancias ya sabe callarse cuando faltan. */
export const SIN_COORDENADAS = Object.freeze({ lat: null, lng: null });

/**
 * Las coordenadas de un domicilio, para guardarlas al lado del texto.
 *
 * **Nunca falla y nunca inventa.** Si el país no tiene adaptador, si el servicio se cayó, si
 * no encontró nada o si lo que encontró no llega a la puerta, devuelve las dos columnas en
 * nulo y quien la llamó guarda el domicilio igual. El texto es el dato; las coordenadas son
 * una comodidad para poder medir distancias, y ninguna alta se cae por no tenerlas.
 *
 * **Por qué se descarta lo aproximado.** Un punto en el medio de la cuadra parece un dato
 * bueno y no lo es: el aviso de check-in fuera de rango tolera 150 metros por omisión
 * (`configuracion_ausencia_automatica.metros_tolerancia_checkin`), y una dirección ubicada
 * solo hasta la calle cae adentro o afuera de esos metros por azar. Una distancia inventada
 * es peor que ninguna distancia, porque parece confiable.
 *
 * **Es una consulta por dirección, no una búsqueda.** Quien actualice una fila que ya existe
 * compara antes: si la dirección escrita es la misma que ya estaba guardada, no llama a esta
 * función y deja las coordenadas como están. Preguntar de nuevo por lo mismo gasta el servicio
 * de un tercero para recibir la misma respuesta.
 */
export async function coordenadasDeDomicilio({ prestadoraId, direccion, localidad, provincia }) {
  if (!prestadoraId || !String(direccion ?? '').trim()) return SIN_COORDENADAS;

  try {
    // El país es el de la Prestadora dueña de la fila, nunca uno por omisión escrito acá: cada
    // Prestadora resuelve sus direcciones con el servicio de su propio país (CLAUDE.md §2).
    const { data, error } = await supabase
      .from('prestadoras')
      .select('pais')
      .eq('id', prestadoraId)
      .maybeSingle();
    if (error) throw new Error(error.message);

    const geocodificador = obtenerGeocodificador(data?.pais);
    if (!geocodificador) return SIN_COORDENADAS;

    const ubicada = await geocodificador.geocodificar({ direccion, localidad, provincia });
    if (!ubicada || ubicada.confianza !== 'exacta') return SIN_COORDENADAS;

    return { lat: ubicada.lat, lng: ubicada.lng };
  } catch (error) {
    // Queda constancia de que el servicio no contestó, porque si esto aparece seguido hay algo
    // roto. Nunca la dirección ni la localidad: esto va al registro del servidor (CLAUDE.md §6).
    console.warn('geocodificacion: no se pudo ubicar un domicilio', error.message);
    return SIN_COORDENADAS;
  }
}
