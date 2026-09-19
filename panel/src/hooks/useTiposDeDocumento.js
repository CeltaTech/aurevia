import { useCallback, useMemo } from 'react';
import { useCatalogo } from './useCatalogo';
import { usePaisDeLaPrestadora } from './usePaisDeLaPrestadora';

/* Con qué documentos se identifica una Persona en el país de la Prestadora.
   =========================================================================

   La lista sale de la base y no de la pantalla, porque qué documentos existen lo decide un Estado
   y cambia de país en país. Escribirla adentro del formulario obligaría a publicar una versión
   nueva del Panel cada vez que se vende en otro país.

   DEVUELVE LOS DE LAS DOS CLASES POR SEPARADO. A una persona física y a una jurídica no se les
   pide lo mismo, y el formulario cambia la lista cuando cambia la clase sin salir a preguntar de
   nuevo.

   SI EL PAÍS NO TIENE NINGUNO CARGADO, DEVUELVE VACÍO Y NO SE INVENTA NADA. La pantalla entonces
   no pide el documento: dejarlo como casillero libre haría que cada quien escriba lo que le
   parezca, y un documento tipeado mal crea una persona que no existe. */
export function useTiposDeDocumento(prestadoraId) {
  const {
    pais,
    estado: estadoPais,
    error: errorPais,
    recargar: recargarPais,
  } = usePaisDeLaPrestadora(prestadoraId);

  const {
    filas,
    estado: estadoCatalogo,
    error: errorCatalogo,
    recargar: recargarCatalogo,
  } = useCatalogo('catalogo_documentos_de_identidad', {
    columnas: 'clase, codigo, sigla',
    filtros: { pais, activo: true },
    requiere: [pais],
  });

  const recargar = useCallback(() => {
    recargarPais();
    recargarCatalogo();
  }, [recargarPais, recargarCatalogo]);

  const porClase = useMemo(
    () => ({
      fisica: filas.filter((uno) => uno.clase === 'fisica'),
      juridica: filas.filter((uno) => uno.clase === 'juridica'),
    }),
    [filas],
  );

  const estado = estadoPais === 'listo' ? estadoCatalogo : estadoPais;

  return { porClase, estado, error: errorPais || errorCatalogo, recargar };
}
