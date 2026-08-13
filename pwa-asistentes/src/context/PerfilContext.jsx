// Lo que esta aplicación necesita saber de la Prestadora de quien la está usando:
// con qué marca se presenta y qué funciones tiene encendidas.
//
// Las dos cosas llegan juntas en la misma respuesta de `/perfil`, así que se preguntan
// juntas y una sola vez. Si cada pantalla lo preguntara por su cuenta serían cinco pedidos
// para el mismo dato y cinco lugares donde arreglarlo el día que cambie (CLAUDE.md §7
// regla 12).
//
// LA MARCA. Quien usa esta aplicación contrató a su Prestadora, no a Careonys: nunca
// escuchó ese nombre. Por eso el encabezado y los avisos llevan el nombre (o el logo) de la
// Prestadora, y el producto aparece solamente en una línea chica al pie (regla 1).
//
// QUÉ SE VE Y QUÉ NO. Cada Prestadora elige, desde Configuración › Las aplicaciones, qué
// muestran los teléfonos. El candado de verdad está en el motor, que directamente no manda
// lo apagado; esto de acá es para que no quede un botón que no lleva a ningún lado ni un
// casillero vacío que haga creer que alguien lo está controlando (tarea 65).
//
// Este archivo es idéntico en las dos aplicaciones y `scripts/verificar_identidad.mjs` corta
// la publicación si alguna copia se despega. No se edita la copia: se edita el original y se
// corre `scripts/sincronizar_copias.mjs`.

import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { guardarMarca } from '../lib/marcaGuardada';
import { useAuth } from './AuthContext';

const MARCA_VACIA = { nombre: null, logoUrl: null, mostrarMarcaProducto: true };
const PERFIL_VACIO = { marca: MARCA_VACIA, visibilidad: null };

const PerfilContext = createContext(PERFIL_VACIO);

export function PerfilProvider({ children }) {
  const { session } = useAuth();
  const [perfil, setPerfil] = useState(PERFIL_VACIO);

  useEffect(() => {
    if (!session) {
      setPerfil(PERFIL_VACIO);
      return undefined;
    }

    let activo = true;
    api
      .perfil()
      .then((datos) => {
        if (!activo) return;
        setPerfil({
          marca: datos.marca ?? MARCA_VACIA,
          visibilidad: datos.visibilidad ?? null,
        });
        if (datos.marca) guardarMarca(datos.marca);
      })
      .catch(() => {
        // Sin esta respuesta la pantalla igual funciona: se ve el encabezado sin nombre y
        // todo encendido hasta el próximo intento. Lo que no puede pasar es que la
        // aplicación no abra porque no se pudo leer un nombre.
      });

    return () => {
      activo = false;
    };
  }, [session]);

  return <PerfilContext.Provider value={perfil}>{children}</PerfilContext.Provider>;
}

export function useMarca() {
  return useContext(PerfilContext).marca;
}

// Devuelve la pregunta, no la lista: `seVe('familia_signos_vitales')`.
//
// Se pregunta por la clave en vez de repartir la lista entera porque la lista vive en el
// motor (`backend/src/utils/catalogoVisibilidad.js`) y no se copia acá: un interruptor nuevo
// no obliga a tocar este archivo.
//
// Mientras la respuesta no llegó, contesta que sí a todo. Es lo mismo que hacían las dos
// aplicaciones antes de que existieran los interruptores, y es la respuesta segura: el dato
// apagado no viene igual, así que en el peor caso se ve un botón de más un instante, nunca
// un dato de más.
export function useSeVe() {
  const { visibilidad } = useContext(PerfilContext);
  return (clave) => (visibilidad ? visibilidad[clave] !== false : true);
}
