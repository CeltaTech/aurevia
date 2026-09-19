import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { mensajeDeError, situacionDelError } from '../lib/errores';
import { useLocale } from '../i18n/LocaleContext';

/* La única pieza que trae una lista de la base y devuelve siempre los cuatro estados.
 *
 * QUÉ PASABA. Veinte enganches distintos repetían el mismo cuerpo —poner «cargando», consultar,
 * clasificar el error, guardar las filas, poner «listo»—, cada uno con su variante: unos no
 * devolvían el error, otro no devolvía el estado, otro se quedaba en «cargando» para siempre
 * cuando todavía no se sabía la Prestadora. Y las pantallas que los usaban se quedaban con las
 * filas y tiraban el resto, así que mientras cargaba, o si fallaba, el filtro se veía igual que
 * si la Prestadora no tuviera ninguna opción cargada.
 *
 * LOS CUATRO ESTADOS SALEN DE ACÁ, NO DE LA PANTALLA. `estado` es siempre uno de
 * `cargando | error | vacio | listo`, y `vacio` lo decide esta pieza, no quien la llama: una lista
 * que volvió sin filas es un estado del catálogo y no una cuenta que cada pantalla tenga que
 * hacer. `EstadoLista` lo entiende tal cual.
 *
 * PRIMERO LA BASE, Y EL ARCHIVO GUARDADO SÓLO SI LA BASE NO CONTESTA. El catálogo que viaja con
 * el producto también está escrito en un archivo, pero ese archivo no es la fuente: es lo que
 * queda cuando no hay con quién hablar. Por eso se cae a él únicamente ante `sin_conexion` —el
 * aparato se quedó sin internet o el servidor no contesta—, nunca ante un permiso denegado ni
 * ante un error de la consulta, que son cosas que hay que ver y no tapar con datos viejos.
 *
 * MIENTRAS NO SE SEPA LA PRESTADORA NO SE CONSULTA. Si algo de `requiere` viene vacío, la sesión
 * todavía se está resolviendo: se queda en «cargando» y se vuelve a intentar solo cuando llegue.
 *
 * CÓMO SE USA:
 *
 *   const { filas, estado, error, recargar } = useCatalogo('zonas_cobertura', {
 *     filtros: { prestadora_id: prestadoraId, activa: true },
 *     requiere: [prestadoraId],
 *   });
 *
 * @param tabla     la tabla del catálogo.
 * @param columnas  qué columnas traer. Por defecto, todas.
 * @param filtros   comparaciones por igual, en un objeto `{ columna: valor }`.
 * @param orden     por qué columna se ordena: el nombre, o `{ columna, ascendente }` cuando hace
 *                  falta al revés. Por defecto, `orden`.
 * @param requiere  valores sin los cuales no tiene sentido consultar todavía.
 * @param guardado  el catálogo que trae el producto, para cuando la base no conteste.
 */
export function useCatalogo(tabla, opciones = {}) {
  const {
    columnas = '*',
    filtros = null,
    orden = 'orden',
    requiere = [],
    guardado = null,
  } = opciones;

  const { t } = useLocale();
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando'); // cargando | error | vacio | listo
  const [error, setError] = useState(null);

  // Los filtros y lo que se espera llegan como objeto y como lista nuevos en cada dibujo. Se
  // comparan por su contenido para no volver a consultar la base en cada dibujo de la pantalla.
  const filtrosFirmados = JSON.stringify(filtros ?? {});
  const requiereFirmado = JSON.stringify(requiere);
  const ordenFirmado = JSON.stringify(orden ?? null);

  // El catálogo guardado no cambia nunca, y como llega como objeto nuevo en cada dibujo se
  // guarda una sola vez para que no reinicie la consulta.
  const guardadoRef = useRef(guardado);
  guardadoRef.current = guardado;

  const recargar = useCallback(async () => {
    const faltaAlgo = JSON.parse(requiereFirmado).some(
      (valor) => valor === null || valor === undefined || valor === '',
    );
    if (faltaAlgo) {
      setEstado('cargando');
      setError(null);
      return;
    }

    setEstado('cargando');
    setError(null);

    let consulta = supabase.from(tabla).select(columnas);
    for (const [columna, valor] of Object.entries(JSON.parse(filtrosFirmados))) {
      consulta = valor === null ? consulta.is(columna, null) : consulta.eq(columna, valor);
    }
    const porDonde = JSON.parse(ordenFirmado);
    if (typeof porDonde === 'string') {
      consulta = consulta.order(porDonde);
    } else if (porDonde && porDonde.columna) {
      consulta = consulta.order(porDonde.columna, { ascending: porDonde.ascendente !== false });
    }

    const { data, error: errorConsulta } = await consulta;

    if (errorConsulta) {
      // La base no contestó: recién ahí vale lo que trae guardado el producto, y la pantalla se
      // dibuja con el catálogo de fábrica en vez de quedarse en blanco.
      if (situacionDelError(errorConsulta) === 'sin_conexion' && guardadoRef.current) {
        const deFabrica = guardadoRef.current;
        setFilas(deFabrica);
        setEstado(deFabrica.length === 0 ? 'vacio' : 'listo');
        return;
      }

      setError(mensajeDeError(errorConsulta, t, tabla));
      setEstado('error');
      return;
    }

    const traidas = data ?? [];
    setFilas(traidas);
    setEstado(traidas.length === 0 ? 'vacio' : 'listo');
  }, [tabla, columnas, filtrosFirmados, ordenFirmado, requiereFirmado, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { filas, estado, error, recargar };
}

/* Una lista que terminó de cargar, haya traído filas o no.
 *
 * Hace falta cuando una pantalla espera dos o tres catálogos a la vez: preguntar por «listo»
 * dejaría esperando para siempre a la que además tiene una lista vacía, que ya terminó. */
export function yaCargo(estado) {
  return estado === 'listo' || estado === 'vacio';
}

/* El diccionario `clave → texto` de un catálogo ya traído.
 *
 * Lo necesita toda pantalla que muestra algo que se eligió antes: lo guardado es la clave, y lo
 * que se lee es el texto. Una clave sin opción cargada se muestra tal cual, porque lo que ya se
 * eligió no depende de que el catálogo de hoy la siga teniendo. */
export function useTextosPorClave(filas, campoClave = 'clave', campoTexto = 'etiqueta') {
  return useMemo(
    () => Object.fromEntries((filas ?? []).map((fila) => [fila[campoClave], fila[campoTexto]])),
    [filas, campoClave, campoTexto],
  );
}
