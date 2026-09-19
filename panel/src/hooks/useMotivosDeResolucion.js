import { useMemo } from 'react';
import { useCatalogo } from './useCatalogo';
import { useLocale } from '../i18n/LocaleContext';
import { nombreDelMotivo } from '../lib/resoluciones';

// Por qué se puede resolver algo, según esta Prestadora. Nace con los motivos que trae el producto
// y a partir de ahí la lista es de ella, igual que los motivos de cierre de servicio y los finales
// de un turno que quedó sin nadie.
//
// Se piden los encendidos de una sola cosa —`postulaciones`, `solicitudes`, `guardias`—, porque un
// motivo vale para lo que se resuelve con él y no para todo. Cada motivo trae también en qué estado
// deja lo resuelto y si además obliga a escribir qué pasó.
//
// Y se puede pedir además los de un solo estado. Hace falta cuando una misma cosa se resuelve desde
// dos lugares distintos: una Guardia se cancela en un lado y se cierra en otro, y ofrecer ahí los
// motivos del otro sería invitar a elegir el equivocado. Sin ese tercer valor vienen todos, que es
// lo que necesita una pantalla donde la decisión y el estado se eligen juntos.
export function useMotivosDeResolucion(prestadoraId, tabla, estadoResultante = null) {
  const { locale } = useLocale();

  const { filas, estado, error, recargar } = useCatalogo('motivos_resolucion', {
    filtros: {
      prestadora_id: prestadoraId,
      tabla,
      activo: true,
      ...(estadoResultante ? { estado: estadoResultante } : {}),
    },
    requiere: [prestadoraId, tabla],
  });

  // Con el nombre ya resuelto al idioma de la pantalla, para que ninguna pantalla tenga que saber
  // en qué columna está.
  const motivos = useMemo(
    () => filas.map((fila) => ({ ...fila, nombre: nombreDelMotivo(fila, locale) })),
    [filas, locale],
  );

  return { filas: motivos, estado, error, recargar };
}
