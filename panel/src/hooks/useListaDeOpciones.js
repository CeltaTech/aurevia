import { useMemo } from 'react';
import { useCatalogo } from './useCatalogo';
import { useLocale } from '../i18n/LocaleContext';
import { textoDeLaOpcion } from '../lib/listasDeOpciones';
import { opcionesDeFabrica } from '../datos/listasDeOpciones';

/* Una lista de opciones del registro de dos pisos, lista para dibujar.
 *
 * Devuelve las dos capas juntas y en orden: primero lo que trae el producto, después lo que
 * agregó esta Prestadora. No hace falta pedir ninguna de las dos por separado ni filtrar por
 * Prestadora: la protección por fila de la base ya devuelve el catálogo general más lo de la
 * Prestadora de la sesión, y nada de ninguna otra.
 *
 * `opciones` viene con el texto ya resuelto al idioma de quien mira, en `texto`. `textos` es el
 * diccionario `clave → texto`, que es lo que hace falta para mostrar lo que alguien eligió antes.
 *
 * Los cuatro estados salen de `useCatalogo`, así que esto se le pasa entero a `EstadoLista`. */
export function useListaDeOpciones(claveDeLaLista) {
  const { locale } = useLocale();

  const { filas, estado, error, recargar } = useCatalogo('opciones_de_lista', {
    columnas: 'id, prestadora_id, clave, i18n, orden, listas_de_opciones!inner(clave)',
    filtros: { 'listas_de_opciones.clave': claveDeLaLista, activa: true },
    orden: 'orden',
    requiere: [claveDeLaLista],
    guardado: opcionesDeFabrica(claveDeLaLista),
  });

  const opciones = useMemo(
    () => filas.map((fila) => ({ ...fila, texto: textoDeLaOpcion(fila.i18n, locale) })),
    [filas, locale],
  );

  const textos = useMemo(
    () => Object.fromEntries(opciones.map((opcion) => [opcion.clave, opcion.texto])),
    [opciones],
  );

  return { opciones, textos, estado, error, recargar };
}
