// La lista de lugares de una Prestadora, leída una sola vez y desde un solo lado.
//
// **Por qué no vive adentro de una ruta.** La misma lista la necesitan tres pantallas: la de
// Configuración, que la carga; la ficha de la Asistente, donde se marca dónde acepta trabajar; y
// la de Usuarios, donde se fija hasta dónde llega una coordinadora. Las dos últimas las abre gente
// que no entra a Configuración, así que la lectura no puede quedar del lado de la configuración.
// Escrita tres veces, terminaría ordenando distinto o mostrando los apagados en una y no en otra.
//
// **Las zonas vienen con sus lugares porque la zona es el atajo para cargar.** En pantalla se
// marca una zona entera y después se desmarca lo que no; lo que queda guardado son los lugares.
// Para poder ofrecer ese atajo hace falta saber qué abarca cada zona, y eso se resuelve acá y no
// con una llamada más desde el navegador.

import { supabase } from '../db/connection.js';

/** El país de esa Organización. Un lugar de una Prestadora argentina es argentino: el país no lo
 *  manda la pantalla, porque un valor que viaja en el pedido lo escribe quien llama. */
export async function paisDeLaPrestadora(prestadoraId) {
  const { data, error } = await supabase
    .from('prestadoras')
    .select('pais')
    .eq('id', prestadoraId)
    .maybeSingle();
  if (error) throw error;
  return String(data?.pais ?? '').trim().toUpperCase() || null;
}

/** Todos los lugares de esa Organización, ordenados por nombre. Incluye los apagados: quien carga
 *  necesita verlos para volver a encenderlos, y quien elige necesita que un lugar apagado que ya
 *  estaba marcado siga teniendo nombre en pantalla. */
export async function lugaresDeLaPrestadora(prestadoraId) {
  const { data, error } = await supabase
    .from('lugares')
    .select('*')
    .eq('prestadora_id', prestadoraId)
    .order('nombre');
  if (error) throw error;
  return data ?? [];
}

/** Las zonas de cobertura de esa Organización con los lugares que abarca cada una. */
export async function zonasConSusLugares(prestadoraId) {
  const [{ data: zonas, error: errorZonas }, { data: cruces, error: errorCruces }] = await Promise.all([
    supabase.from('zonas_cobertura').select('id, codigo, nombre, activa').eq('prestadora_id', prestadoraId).order('nombre'),
    supabase.from('zona_lugares').select('zona_id, lugar_id').eq('prestadora_id', prestadoraId),
  ]);
  if (errorZonas) throw errorZonas;
  if (errorCruces) throw errorCruces;

  const porZona = new Map();
  for (const cruce of cruces ?? []) {
    if (!porZona.has(cruce.zona_id)) porZona.set(cruce.zona_id, []);
    porZona.get(cruce.zona_id).push(cruce.lugar_id);
  }
  return (zonas ?? []).map((zona) => ({ ...zona, lugares: porZona.get(zona.id) ?? [] }));
}

/** Lo que necesita cualquier pantalla donde se eligen lugares: la lista y el atajo por zona. */
export async function catalogoDeLugares(prestadoraId) {
  const [lugares, zonas] = await Promise.all([
    lugaresDeLaPrestadora(prestadoraId),
    zonasConSusLugares(prestadoraId),
  ]);
  return { lugares, zonas };
}
