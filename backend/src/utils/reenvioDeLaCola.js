import { supabase } from '../db/connection.js';

/**
 * UN REENVÍO DE LA COLA NO DUPLICA LO QUE YA LLEGÓ.
 *
 * El teléfono anota lo que no pudo mandar y lo vuelve a intentar cuando hay señal. Si el primer
 * intento llegó a la base y lo que se perdió fue la respuesta, el segundo intento escribiría una
 * fila más: dos emergencias de la misma emergencia, dos descansos del mismo descanso.
 *
 * Casi todos los avisos ya están a salvo por su propio estado —una guardia no tiene dos llegadas
 * ni dos cierres—, y para ésos el motor contesta `yaRegistrado` mirando la guardia. Los que sí
 * pueden pasar dos veces de verdad en el mismo turno necesitan esto: el identificador que el
 * teléfono pone ANTES del primer intento y no cambia entre reintentos.
 *
 * SE LEE Y NO SE INVENTA. Un identificador que no viene, o que no es texto, devuelve `null`: la
 * ruta sigue de largo y escribe como siempre. Nunca se genera uno acá, porque uno nuevo en cada
 * llegada no reconocería nada y esta función no serviría para lo único que existe.
 */
export function identificadorDelTelefono(cuerpo, campo = 'clienteUuid') {
  const valor = cuerpo?.[campo];
  return typeof valor === 'string' && valor.trim() ? valor.trim() : null;
}

/**
 * La fila que ese mismo aviso ya escribió, si está. Sin identificador no hay nada que buscar.
 *
 * Se busca por guardia y por identificador juntos, con el mismo par que hace único el índice de
 * la base: el identificador lo genera el teléfono, y la guardia es lo que lo ata a su Prestadora.
 */
export async function filaDeEsteAviso({ tabla, guardiaId, clienteUuid, campos = 'id', columna = 'cliente_uuid' }) {
  if (!clienteUuid) return null;

  const { data, error } = await supabase
    .from(tabla)
    .select(campos)
    .eq('guardia_id', guardiaId)
    .eq(columna, clienteUuid)
    .maybeSingle();

  // Falla cerrado hacia escribir: si la consulta no se pudo hacer, no se afirma que ya estaba.
  // El detalle queda en el registro del servidor y no sale hacia afuera.
  if (error) {
    console.error(`Error buscando un reenvío en ${tabla}:`, error.message);
    return null;
  }
  return data ?? null;
}
