import { useCallback, useMemo, useState } from 'react';

// Punto único de verdad de los FILTROS de una lista (regla 12 de CLAUDE.md §7).
// ============================================================================
//
// El problema que resuelve. Casi toda pantalla del Panel tiene una lista con filtros arriba:
// un buscador, un desplegable de estado, a veces una zona o una fecha. Cada pantalla los
// escribía a mano, con un `useState` por filtro. Eso funciona hasta que hace falta responder
// dos preguntas que ninguna pantalla sabía responder sola:
//
//   1. ¿Hay algún filtro puesto ahora mismo?
//   2. ¿Cómo se sacan todos de una?
//
// Y hacen falta las dos, porque el cartel de "no hay nada" tiene que ser distinto según el
// caso: si no hay ni un dato cargado, lo que corresponde es crear el primero; si hay datos
// pero el filtro los tapó, lo que corresponde es ofrecer sacarlo. Ver
// `components/layout/EstadoLista.jsx`. Sin este dato, alguien con un filtro puesto cree que
// perdió los datos.
//
// Escribir esa respuesta once veces —una por pantalla— es exactamente lo que la regla 12
// prohíbe. Acá está escrita una sola vez.
//
// Cómo se usa:
//
//   const { f, set, limpiar, hayFiltros } = useFiltros({ busqueda: '', estado: '' });
//
//   <input value={f.busqueda} onChange={(e) => set('busqueda', e.target.value)} />
//   <select value={f.estado} onChange={(e) => set('estado', e.target.value)}>…</select>
//
//   <EstadoLista … vacio={filas.length === 0} filtrado={hayFiltros} onLimpiarFiltros={limpiar}>
//
// Qué cuenta como "filtro puesto": que el valor sea distinto del que tenía al abrir la
// pantalla. Por eso el valor inicial se declara una sola vez, arriba: es a la vez el valor
// de arranque y el punto de comparación. Una pantalla que arranca ya filtrada (por ejemplo
// Documentación, que abre mostrando solo lo vencido) declara ese valor como inicial, y
// entonces "sacar los filtros" la devuelve a como estaba, no a mostrar todo.

/**
 * @param {Record<string, unknown>} iniciales Los filtros de la pantalla y su valor de arranque.
 * @returns {{ f: Record<string, unknown>, set: (clave: string, valor: unknown) => void,
 *             limpiar: () => void, hayFiltros: boolean }}
 */
export function useFiltros(iniciales) {
  // Se congela el valor inicial en el primer render. Si se leyera el objeto que llega por
  // parámetro, cada render crearía uno nuevo y "hay filtros puestos" cambiaría solo.
  const [porDefecto] = useState(iniciales);
  const [f, setF] = useState(iniciales);

  const set = useCallback((clave, valor) => {
    setF((actual) => ({ ...actual, [clave]: valor }));
  }, []);

  const limpiar = useCallback(() => setF(porDefecto), [porDefecto]);

  const hayFiltros = useMemo(
    () => Object.keys(porDefecto).some((clave) => f[clave] !== porDefecto[clave]),
    [f, porDefecto]
  );

  return { f, set, limpiar, hayFiltros };
}
