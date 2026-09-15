import { supabase } from '../db/connection.js';
import { IDIOMA_POR_DEFECTO, idiomaDePais } from './idiomas.js';

/* En qué idioma escribe una Prestadora.
   ====================================

   Es la única consulta del motor que contesta esa pregunta. Sale del país configurado de la
   Prestadora, que es lo único que se sabe sobre dónde está la gente que va a leer el aviso.

   SE PREGUNTA UNA VEZ POR VUELTA, no una vez por aviso: los procesos de fondo recorren todas las
   Prestadoras y le mandan varios avisos a cada una, y preguntar adentro del bucle serían decenas
   de consultas para obtener siempre la misma respuesta.

   NO SE GUARDA EN MEMORIA ENTRE VUELTAS. El país de una Prestadora se cambia desde Configuración,
   y una copia guardada haría que el aviso siguiera saliendo en el idioma viejo hasta que alguien
   reiniciara el motor. */

/**
 * El idioma de una Prestadora. Si no se la encuentra o no tiene país, el de por defecto: un aviso
 * que sale en castellano es mejor que un aviso que no sale.
 *
 * @param {string|null|undefined} prestadoraId
 * @returns {Promise<string>}
 */
export async function idiomaDeLaPrestadora(prestadoraId) {
  if (!prestadoraId) return IDIOMA_POR_DEFECTO;

  const { data, error } = await supabase
    .from('prestadoras')
    .select('pais')
    .eq('id', prestadoraId)
    .maybeSingle();

  if (error) {
    console.error(`Error resolviendo el idioma de la Prestadora ${prestadoraId}:`, error.message);
    return IDIOMA_POR_DEFECTO;
  }

  return idiomaDePais(data?.pais);
}
