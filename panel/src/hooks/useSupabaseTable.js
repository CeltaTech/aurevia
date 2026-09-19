import { useCatalogo } from './useCatalogo';

/**
 * La lista completa de una tabla, con los cuatro estados. Es `useCatalogo` con el orden por
 * fecha de creación, que es lo que pide una lista de registros en vez de un catálogo.
 *
 * `select` sirve para traer también una tabla adjunta —por ejemplo los datos que viven aparte
 * de la ficha del Asistente—. Por defecto trae las columnas de la tabla y nada más.
 */
export function useSupabaseTable(tabla, { orderBy = 'creado_en', ascending = false, select = '*' } = {}) {
  return useCatalogo(tabla, {
    columnas: select,
    orden: { columna: orderBy, ascendente: ascending },
  });
}
