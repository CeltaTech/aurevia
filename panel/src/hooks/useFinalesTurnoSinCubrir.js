import { useMemo } from 'react';
import { useCatalogo } from './useCatalogo';
import { finalesQueSeOfrecen } from '../lib/incidenteTurnoSinCubrir';

// Cómo puede terminar un turno que quedó sin nadie, según esta Prestadora. Nace con los que trae
// el producto y a partir de ahí la lista es de ella, igual que los motivos de cierre de servicio y
// las causas de sustitución.
//
// Se piden los encendidos y se descartan acá los dos que escribe el motor: son finales de verdad
// —quedan escritos en expedientes cerrados— pero no se eligen, porque la base ya los dice.
export function useFinalesTurnoSinCubrir(prestadoraId) {
  const { filas: traidos, estado, error, recargar } = useCatalogo('finales_turno_sin_cubrir', {
    filtros: { prestadora_id: prestadoraId, activo: true },
    requiere: [prestadoraId],
  });

  const filas = useMemo(() => finalesQueSeOfrecen(traidos), [traidos]);

  // El vacío se cuenta sobre lo que queda para elegir, no sobre lo que trajo la base: una
  // Prestadora cuyos únicos finales encendidos son los dos que escribe el motor no tiene ninguno
  // que ofrecer, y eso es lo que hay que decirle.
  return {
    filas,
    estado: estado === 'listo' && filas.length === 0 ? 'vacio' : estado,
    error,
    recargar,
  };
}
