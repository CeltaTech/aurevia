// Cómo se lee el Cliente que contrató un Servicio. Escrito una sola vez porque lo necesitan la
// lista de Servicios y la ficha de cada uno, y si la decisión vive en las dos, el día que aparezca
// un Cliente que no sea una Familia una de las dos se va a olvidar.
//
// En la base son dos columnas: `tipo_contratante`, de qué clase es el Cliente, y `contratante_id`,
// cuál. Hoy el único tipo que la base acepta es `familia` —no existe todavía ninguna otra entidad
// que pueda contratar—, y de ahí que los datos de contacto salgan de la solicitud con la que esa
// Familia entró. El día que haya otro tipo se le agrega una rama acá, y las dos pantallas lo
// muestran sin que haya que tocarlas.

export const TIPO_FAMILIA = 'familia';

/**
 * @param {object|null} servicio Una fila de `servicios` que traiga `tipo_contratante`,
 *   `contratante_id` y, si el Cliente es una Familia, la solicitud anidada.
 * @returns {{tipo: string|null, id: string|null, contacto: object|null, ruta: string|null}}
 *   `contacto` es lo que se muestra —nombre, localidad, teléfono, correo—, y `ruta` adónde lleva
 *   el botón que abre su ficha. Los dos vienen en `null` cuando el Cliente no tiene ficha propia.
 */
export function clienteDelServicio(servicio) {
  const tipo = servicio?.tipo_contratante ?? null;
  const id = servicio?.contratante_id ?? null;

  if (tipo === TIPO_FAMILIA && id) {
    return {
      tipo,
      id,
      contacto: servicio.familias?.solicitudes ?? null,
      ruta: `/familias/${id}`,
    };
  }

  return { tipo, id, contacto: null, ruta: null };
}
