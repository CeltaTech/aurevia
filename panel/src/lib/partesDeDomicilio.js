// Las partes del domicilio del lado del Panel: cómo se leen de una fila, cómo se muestran en un
// renglón y cómo vuelven a la base.
//
// Están afuera del componente porque son funciones, no pantalla: un archivo que exporta las dos
// cosas a la vez rompe el refresco en caliente del navegador mientras se programa.
//
// EL DOMICILIO ES DATO SENSIBLE: no se escribe en registros, ni en direcciones web, ni en mensajes
// de error, ni siquiera para depurar (celtatech/CLAUDE.md §6).

import { domicilioEscrito, partesDelDomicilio } from './domicilioEscrito';

/** Un domicilio sin nada cargado. Existe para que ninguna pantalla lo escriba por su cuenta. */
export const DOMICILIO_VACIO = { calle: '', numero: '', piso: '', unidad: '', lugar_id: '' };

/**
 * Las partes tal como salen de una fila de la base, listas para el componente.
 *
 * Lo que la base tiene en nulo llega acá como cadena vacía, porque un casillero con `null` adentro
 * deja de ser controlado y React avisa por consola en cada tecla.
 */
export function partesDesdeFila(fila) {
  return {
    calle: fila?.calle ?? '',
    numero: fila?.numero ?? '',
    piso: fila?.piso ?? '',
    unidad: fila?.unidad ?? '',
    lugar_id: fila?.lugar_id ?? '',
  };
}

/**
 * El domicilio en un renglón, con el nombre del lugar buscado en el catálogo.
 *
 * Lo necesitan las pantallas que escriben derecho contra la base y tienen que dejar al día la
 * columna del renglón. Las que guardan a través del motor no lo usan: ahí el renglón lo arma el
 * motor con la misma función, porque es él quien conoce los lugares de esa Prestadora.
 *
 * `textos` se pasa solamente para mostrar. Para escribir la columna se omite, y entonces las
 * palabras salen en castellano igual que del lado del motor: una misma columna escrita en tres
 * idiomas según quién la guardó se lee distinta en cada ficha. Es otro motivo por el cual el
 * renglón se arma al mostrarlo y no se guarda.
 */
export function renglonDelDomicilio(partes, lugares, textos) {
  const lugar = (lugares ?? []).find((uno) => uno.id === partes?.lugar_id);
  return domicilioEscrito({ ...partes, lugar: lugar?.nombre }, textos);
}

/** Las palabras del piso y la unidad en el idioma de quien mira, para mostrar el renglón. */
export function palabrasDelDomicilio(t) {
  return { piso: t.comun.domicilio_palabra_piso, unidad: t.comun.domicilio_palabra_unidad };
}

/** Las partes listas para guardar. Lo hace `partesDelDomicilio`, que es la misma función que usa el
 *  motor: si cada lado decidiera por su cuenta qué es un casillero vacío, uno guardaría nulo y el
 *  otro una cadena, y las dos fichas se verían distintas sin serlo. */
export { partesDelDomicilio as partesParaGuardar };
