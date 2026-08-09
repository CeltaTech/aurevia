// La marca que ve la Familia en esta aplicación.
//
// La Familia contrató a su Prestadora, no a Careonys: nunca escuchó ese nombre.
// Por eso el encabezado y los avisos llevan el nombre (o el logo) de la
// Prestadora, y el producto aparece solamente en una línea chica al pie
// (`CLAUDE.md` §7, regla 1).
//
// Se pregunta una sola vez, acá, y de acá la toma toda la aplicación: si cada
// pantalla lo preguntara por su cuenta serían cinco pedidos para el mismo dato
// y cinco lugares donde arreglarlo el día que cambie (regla 12).

import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { guardarMarca } from '../lib/marcaGuardada';
import { useAuth } from './AuthContext';

const MARCA_VACIA = { nombre: null, logoUrl: null, mostrarMarcaProducto: true };

const MarcaContext = createContext(MARCA_VACIA);

export function MarcaProvider({ children }) {
  const { session } = useAuth();
  const [marca, setMarca] = useState(MARCA_VACIA);

  useEffect(() => {
    if (!session) {
      setMarca(MARCA_VACIA);
      return undefined;
    }

    let activo = true;
    api
      .perfil()
      .then((datos) => {
        if (!activo || !datos.marca) return;
        setMarca(datos.marca);
        guardarMarca(datos.marca);
      })
      .catch(() => {
        // Sin marca la pantalla igual funciona: se ve el encabezado sin nombre
        // hasta el próximo intento. Lo que no puede pasar es que la aplicación
        // no abra porque no se pudo leer un nombre.
      });

    return () => {
      activo = false;
    };
  }, [session]);

  return <MarcaContext.Provider value={marca}>{children}</MarcaContext.Provider>;
}

export function useMarca() {
  return useContext(MarcaContext);
}
