import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const EmpresaContext = createContext(null);

// Con sesión, cada Organización lee su propia fila vía RLS (prestadora_lee_su_configuracion).
//
// Sin sesión —la pantalla de ingreso— no se carga nada, y es a propósito: el Panel es uno solo
// para todas las Prestadoras, así que antes de entrar no hay forma de saber de cuál se trata.
// Hasta el 2026-08-23 se le preguntaba al camino público del motor, que sin dominio que
// coincidiera contestaba con la única Prestadora que hubiera cargada: mostraba un nombre acertado
// por descarte, y con dos Prestadoras habría mostrado el equivocado. Ese camino público ahora
// exige que la Prestadora venga en la dirección y no adivina ninguna. Que la
// pantalla de ingreso sepa a qué Prestadora pertenece quien está por entrar es el pendiente #141;
// mientras tanto el subtítulo queda vacío, que es lo que ya hace `Login.jsx` cuando no hay dato.
async function cargarConfiguracionPropia() {
  const { data } = await supabase
    .from('configuracion_prestadora')
    .select('nombre, telefono, whatsapp_numero, email, dominio, zona_cobertura_texto')
    .maybeSingle();
  return data ?? null;
}

export function EmpresaProvider({ children }) {
  const [empresa, setEmpresa] = useState(null);

  useEffect(() => {
    let activo = true;

    async function cargarSegunSesion(session) {
      const data = session ? await cargarConfiguracionPropia() : null;
      if (activo) setEmpresa(data);
    }

    supabase.auth.getSession().then(({ data: { session } }) => cargarSegunSesion(session));

    const { data: suscripcion } = supabase.auth.onAuthStateChange((_evento, session) => {
      cargarSegunSesion(session);
    });

    return () => {
      activo = false;
      suscripcion.subscription.unsubscribe();
    };
  }, []);

  return <EmpresaContext.Provider value={{ empresa }}>{children}</EmpresaContext.Provider>;
}

export function useEmpresa() {
  const ctx = useContext(EmpresaContext);
  if (!ctx) throw new Error('useEmpresa debe usarse dentro de EmpresaProvider');
  return ctx;
}
