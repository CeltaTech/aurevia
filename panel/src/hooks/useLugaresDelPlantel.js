import { useEffect, useMemo, useRef, useState } from 'react';
import { lugaresDeVarias } from '../lib/lugaresDeCadaPersona';
import { useCatalogoDeLugares } from './useCatalogoDeLugares';

/* Dónde acepta trabajar cada una de las personas de una lista, con el nombre de cada lugar.

   POR QUÉ ES UN HOOK Y NO DOS CONSULTAS EN CADA PANTALLA. Tres pantallas muestran la misma cosa:
   la lista del plantel, la sugerencia de una Solicitud y el equipo de un Paciente. Las tres
   necesitan lo mismo —qué lugares tiene cada ficha y cómo se llaman—, y escribirlo tres veces
   terminaría con una mostrando los nombres del catálogo y otra mostrando identificadores.

   POR QUÉ LOS NOMBRES SALEN DEL CATÁLOGO. Lo guardado en la ficha es cuál lugar, no cómo se
   llama. El nombre se busca al mostrarlo: así, corregir una vez el nombre de una localidad lo
   corrige en todas las fichas que la nombran.

   La lista de personas se compara por su contenido y no por su identidad: una pantalla que arma
   el array en cada dibujo no debe volver a consultar por eso. */
export function useLugaresDelPlantel(ids) {
  const clave = [...new Set((ids ?? []).filter(Boolean))].sort().join(',');
  const { lugares: catalogo, estado: estadoCatalogo, error: errorCatalogo } = useCatalogoDeLugares();
  const [lugaresPorPersona, setLugaresPorPersona] = useState(new Map());
  const [estado, setEstado] = useState('cargando');
  const ultima = useRef(0);

  useEffect(() => {
    const pedido = ++ultima.current;
    if (!clave) {
      setLugaresPorPersona(new Map());
      setEstado('listo');
      return;
    }
    setEstado('cargando');
    lugaresDeVarias('asistente_lugares', 'asistente_id', clave.split(','))
      .then((mapa) => {
        if (pedido !== ultima.current) return;
        setLugaresPorPersona(mapa);
        setEstado('listo');
      })
      .catch(() => {
        if (pedido !== ultima.current) return;
        setEstado('error');
      });
  }, [clave]);

  const nombreDeLugar = useMemo(() => {
    const porId = new Map((catalogo ?? []).map((lugar) => [lugar.id, lugar.nombre]));
    return (id) => porId.get(id) ?? '';
  }, [catalogo]);

  // Memorizado porque las pantallas lo usan adentro de un cálculo que se rehace cuando cambia lo
  // que devuelve: un objeto nuevo en cada dibujo volvería a filtrar la lista entera sin motivo.
  return useMemo(
    () => ({
      lugaresDe: (id) => lugaresPorPersona.get(id) ?? [],
      nombresDe: (id) => (lugaresPorPersona.get(id) ?? []).map(nombreDeLugar).filter(Boolean).sort(),
      nombreDeLugar,
      catalogo: catalogo ?? [],
      estado:
        estado === 'error' || estadoCatalogo === 'error'
          ? 'error'
          : estado === 'listo' && estadoCatalogo === 'listo'
            ? 'listo'
            : 'cargando',
      // Devolver el estado y tragarse el error deja a la pantalla con un cartel de error sin
      // texto: el error viaja con el estado o no sirve de nada.
      error: errorCatalogo ?? null,
    }),
    [lugaresPorPersona, nombreDeLugar, catalogo, estado, estadoCatalogo, errorCatalogo],
  );
}
