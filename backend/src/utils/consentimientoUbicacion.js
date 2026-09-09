// ¿Se puede guardar dónde está esta persona?
//
// La única fuente de verdad es `consentimiento_seguimiento_vigente`, la función de la base que
// mira el consentimiento otorgado, no retirado, contra un texto vigente que no sea borrador.
// Acá no se reescribe esa condición: se la consulta.
//
// Retirar el consentimiento no traba nada. El Asistente marca su llegada, marca su salida y
// trabaja igual: lo único que deja de pasar es que quede registrada la coordenada. Por eso esto
// no devuelve un error, devuelve si se puede o no, y quien llama arma el registro sin posición.
//
// Ante cualquier falla de la consulta se contesta que NO. Es un control de privacidad y falla
// cerrado: si no se pudo saber si la persona dio permiso, no se la ubica.
import { supabase } from '../db/connection.js';

export async function puedeRegistrarUbicacion(asistenteId) {
  if (!asistenteId) return false;

  const { data, error } = await supabase.rpc('consentimiento_seguimiento_vigente', {
    p_asistente_id: asistenteId,
  });

  if (error) {
    console.error('Error consultando el consentimiento de seguimiento de ubicación:', error.message);
    return false;
  }

  return data === true;
}
