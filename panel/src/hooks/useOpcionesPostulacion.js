import { useCatalogo, useTextosPorClave } from './useCatalogo';

// Una de las listas de opciones del formulario de postulación, tal como la cargó esta Prestadora
// (tabla `opciones_postulacion`, una fila por opción y por grupo). Mismo molde que
// `useZonasCobertura`: sólo las activas, en el orden que ella les dio, y con el pase de quien
// mira, así que la protección por fila resuelve de qué Prestadora se trata.
//
// `labels` es el diccionario `código → etiqueta` que `traducirCodigos` necesita para mostrar lo
// que quedó guardado en una postulación. Un código sin opción cargada se muestra tal cual: lo que
// ya se escribió no depende de que el catálogo de hoy lo siga teniendo.
export function useOpcionesPostulacion(prestadoraId, grupo) {
  const { filas, estado, error, recargar } = useCatalogo('opciones_postulacion', {
    columnas: 'clave, etiqueta, orden',
    filtros: { prestadora_id: prestadoraId, grupo, activo: true },
    requiere: [prestadoraId, grupo],
  });

  const labels = useTextosPorClave(filas);

  return { filas, labels, estado, error, recargar };
}
