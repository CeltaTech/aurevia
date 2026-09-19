import { supabase } from './supabaseClient';

// El único lugar del Panel que resuelve algo.
//
// Resolver no es pisar la columna `estado`. Es escribir una fila nueva en `resoluciones`, con el
// motivo elegido del catálogo de la Prestadora y con la firma de quien decidió. De eso se encarga
// la función `resolver` de la base, que escribe la fila y deja el estado igual en la tabla
// resuelta, todo en la misma transacción. Quién firma sale de la sesión y la Prestadora de la
// membresía verificada: nada de eso viaja en el pedido.
//
// Vive en lib/ porque lo van a usar todas las pantallas que hoy escriben `update({ estado })`, y
// la misma decisión no puede quedar escrita en cada una.

// En qué columna está el nombre del motivo según el idioma en el que está la pantalla. Los tres
// están siempre cargados: la base rechaza el motivo que llegue sin alguno.
const COLUMNA_POR_IDIOMA = {
  'es-AR': 'nombre_es_ar',
  en: 'nombre_en',
  'pt-BR': 'nombre_pt_br',
};

// El nombre del motivo en el idioma de la pantalla.
export function nombreDelMotivo(motivo, locale) {
  if (!motivo) return '';
  const columna = COLUMNA_POR_IDIOMA[locale] ?? COLUMNA_POR_IDIOMA['es-AR'];
  return motivo[columna] ?? motivo.nombre_es_ar ?? '';
}

// Resuelve una fila. `tabla` es el nombre guardado de la tabla cuya fila se resuelve
// —`postulaciones`, `solicitudes`—, y `filaId` su llave, que va como texto porque unas tablas la
// tienen `uuid` y otras `bigint`.
//
// El estado en el que queda no se manda: lo dice el motivo elegido. Así la misma decisión no
// puede terminar en dos estados distintos según desde qué pantalla se haya tomado.
//
// Devuelve { data, error } igual que cualquier otra llamada a la base, para que quien la use pase
// el error por `mensajeDeError` como ya hace con todo lo demás.
export async function resolver({ tabla, filaId, motivoId, detalle = null }) {
  return supabase.rpc('resolver', {
    p_tabla: tabla,
    p_fila_id: String(filaId),
    p_motivo_id: motivoId,
    p_detalle: detalle,
  });
}

// La resolución vigente de cada una de esas filas: la última de cada una. De acá sale el estado
// que se ve. Se piden todas juntas para que una lista no dispare una consulta por renglón.
export async function resolucionesVigentes({ prestadoraId, tabla, filaIds }) {
  const llaves = (filaIds ?? []).map((cada) => String(cada));
  if (!prestadoraId || !tabla || llaves.length === 0) return { data: [], error: null };

  return supabase
    .from('resoluciones_vigentes')
    .select('*')
    .eq('prestadora_id', prestadoraId)
    .eq('tabla', tabla)
    .in('fila_id', llaves);
}
