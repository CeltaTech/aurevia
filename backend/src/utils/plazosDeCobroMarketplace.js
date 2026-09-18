/* Los plazos del cobro de marketplace, tal como los eligió cada Prestadora.
   ========================================================================

   QUÉ RESUELVE. Tres plazos comerciales estaban escritos en el motor: con cuántos días se avisa un
   cobro que viene, cuántos dura la gracia cuando un cobro no entra, y cuántos vive el cupón de la
   red de cobranza. Los tres miran a la Familia, así que los elige la Prestadora
   (`configuracion_cobro_marketplace`).

   ES LA ÚNICA PUERTA. Los tres trabajos que los usan —`avisoPrevioAlCobro.js`,
   `periodoDeGracia.js` y `cobrosMarketplace.js`— preguntan acá y ninguno guarda un número propio
   (`celtatech\CLAUDE.md` §8, ningún patrón repetido sin punto único de verdad).

   NINGÚN VALOR DE ARRANQUE SE ESCRIBE ACÁ. Los que valen mientras la Prestadora no tocó nada son
   los `DEFAULT` de cada columna, y esa es la única fuente. Toda Prestadora nace con su fila; si
   llegara a faltar se le pide a la base que la cree, que es lo mismo que hace el alta. Copiar los
   números acá haría que el formulario prometa un plazo y el trabajo use otro.

   SE PREGUNTA UNA VEZ POR VUELTA, no una vez por acceso. Los trabajos de fondo recorren todas las
   Prestadoras y tocan varios accesos de cada una: el mapa que se les pasa guarda lo leído mientras
   dura la vuelta, y se tira al terminarla. No se guarda entre vueltas, por el mismo motivo que el
   idioma: un plazo que se cambia desde el Panel tiene que regir a la vuelta siguiente, sin que
   nadie reinicie el motor. */

import { supabase } from '../db/connection.js';

const TABLA = 'configuracion_cobro_marketplace';
const COLUMNAS = 'dias_de_aviso_antes_del_cobro, dias_de_gracia_por_cobro_rechazado, dias_de_vida_del_cupon';

/** La memoria de una vuelta. Se crea al empezar el trabajo y se pasa a cada lectura. */
export function memoriaDePlazos() {
  return new Map();
}

/**
 * Los plazos de una Prestadora. Devuelve `null` cuando no se pudieron leer: quien pregunta decide
 * qué hacer con eso, y ninguno de los tres trabajos inventa un plazo para seguir adelante.
 *
 * @param {string|null|undefined} prestadoraId
 * @param {Map} [memoria]  Lo leído en esta misma vuelta.
 * @returns {Promise<{dias_de_aviso_antes_del_cobro: number, dias_de_gracia_por_cobro_rechazado: number, dias_de_vida_del_cupon: number}|null>}
 */
export async function plazosDeLaPrestadora(prestadoraId, memoria) {
  if (!prestadoraId) return null;
  if (memoria?.has(prestadoraId)) return memoria.get(prestadoraId);

  const plazos = await leerlos(prestadoraId);
  memoria?.set(prestadoraId, plazos);
  return plazos;
}

async function leerlos(prestadoraId) {
  const { data, error } = await supabase
    .from(TABLA)
    .select(COLUMNAS)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  if (error) {
    console.error(`Error leyendo los plazos de cobro de la Prestadora ${prestadoraId}:`, error.message);
    return null;
  }
  if (data) return data;

  // La fila la crea el disparador del alta. Si falta, se le pide a la misma función que usa el
  // alta y se vuelve a leer: así el plazo que rige es el que la base guarda, no una copia.
  const { error: errorSiembra } = await supabase.rpc('sembrar_configuracion_prestadora', {
    p_prestadora_id: prestadoraId,
  });
  if (errorSiembra) {
    console.error(`No se pudo sembrar la configuración de cobro de la Prestadora ${prestadoraId}:`, errorSiembra.message);
    return null;
  }

  const { data: recien, error: errorRelectura } = await supabase
    .from(TABLA)
    .select(COLUMNAS)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  if (errorRelectura) {
    console.error(`Error leyendo los plazos de cobro de la Prestadora ${prestadoraId}:`, errorRelectura.message);
    return null;
  }
  return recien ?? null;
}

/**
 * El plazo de aviso más largo que hay configurado. Es lo que abre la ventana de la consulta del
 * aviso previo, que recorre todas las Prestadoras de una vez: se traen los accesos que entran en
 * la ventana más ancha y después cada uno se mide contra el plazo de la suya.
 *
 * @returns {Promise<number|null>}
 */
export async function elPlazoDeAvisoMasLargo() {
  const { data, error } = await supabase
    .from(TABLA)
    .select('dias_de_aviso_antes_del_cobro')
    .order('dias_de_aviso_antes_del_cobro', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('Error leyendo el plazo de aviso más largo:', error.message);
    return null;
  }
  return data?.dias_de_aviso_antes_del_cobro ?? null;
}
