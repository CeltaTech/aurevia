// Cómo se lee el Cliente que contrató un Servicio. Escrito una sola vez porque lo necesitan la
// lista de Servicios y la ficha de cada uno, y si la decisión vive en las dos, el día que aparezca
// un Cliente que no sea una Familia una de las dos se va a olvidar.
//
// En la base son dos columnas: `tipo_contratante`, de qué clase es el Cliente, y `contratante_id`,
// cuál. Hoy el único tipo que la base acepta es `familia` —no existe todavía ninguna otra entidad
// que pueda contratar—, y de ahí que los datos de contacto salgan de la solicitud con la que esa
// Familia entró. El día que haya otro tipo se le agrega una rama acá, y las dos pantallas lo
// muestran sin que haya que tocarlas.
//
// El contacto llega aparte, en un mapa, y no anidado adentro del Servicio: `contratante_id` no
// apunta siempre a la misma tabla, así que no puede haber una clave foránea que lo ate a ninguna,
// y sin clave foránea la base no sabe anidar. Cada pantalla trae los contactos que necesita en una
// consulta suya y arma ese mapa.

export const TIPO_FAMILIA = 'familia';

/**
 * @param {object|null} servicio Una fila de `servicios` que traiga `tipo_contratante` y
 *   `contratante_id`.
 * @param {Map<string, object>} [contactos] Mapa de identificador de Cliente a sus datos de
 *   contacto —nombre, localidad, teléfono, correo—. Puede venir vacío mientras se carga.
 * @returns {{tipo: string|null, id: string|null, contacto: object|null, ruta: string|null}}
 *   `contacto` es lo que se muestra, y `ruta` adónde lleva el botón que abre su ficha. Los dos
 *   vienen en `null` cuando el Cliente no tiene ficha propia.
 */
export function clienteDelServicio(servicio, contactos) {
  const tipo = servicio?.tipo_contratante ?? null;
  const id = servicio?.contratante_id ?? null;

  if (tipo === TIPO_FAMILIA && id) {
    return {
      tipo,
      id,
      contacto: contactos?.get?.(id) ?? null,
      ruta: `/familias/${id}`,
    };
  }

  return { tipo, id, contacto: null, ruta: null };
}

/**
 * Trae los datos de contacto de los Clientes de una lista de Servicios y los devuelve en el mapa
 * que espera `clienteDelServicio`. Está acá, y no en cada pantalla, por el mismo motivo que la
 * función de arriba: es una sola decisión —de qué tabla sale el contacto de cada tipo de Cliente—
 * y tiene que vivir en un solo lugar.
 *
 * @param {object} supabase El cliente de la base.
 * @param {Array<object>} servicios Filas con `tipo_contratante` y `contratante_id`.
 * @returns {Promise<{contactos: Map<string, object>, error: object|null}>}
 */
export async function contactosDeClientes(supabase, servicios) {
  const idsFamilia = [
    ...new Set(
      (servicios ?? [])
        .filter((s) => s?.tipo_contratante === TIPO_FAMILIA && s?.contratante_id)
        .map((s) => s.contratante_id),
    ),
  ];

  if (idsFamilia.length === 0) return { contactos: new Map(), error: null };

  const { data, error } = await supabase
    .from('familias')
    .select('id, solicitudes!familias_solicitud_id_fkey(nombre, telefono, email, localidad)')
    .in('id', idsFamilia);

  if (error) return { contactos: new Map(), error };

  return {
    contactos: new Map((data ?? []).filter((f) => f.solicitudes).map((f) => [f.id, f.solicitudes])),
    error: null,
  };
}
