import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

// Este proveedor contesta tres cosas distintas, y nunca las confunde entre sí:
//   'cargando' — todavía no se sabe quién entró;
//   'error'    — no se pudo averiguar, y la pantalla lo dice en vez de mostrarse vacía;
//   'listo'    — se averiguó, haya sesión o no la haya.
// Antes, una lectura fallida dejaba la ficha en nulo y quien la recibía no podía distinguir
// «todavía no llegó» de «falló», así que mostraba un vacío tranquilizador.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined);
  const [usuario, setUsuario] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const cargando = estado === 'cargando';

  useEffect(() => {
    let activo = true;

    async function traerUsuario(userId) {
      const { data, error } = await supabase
        .from('usuarios')
        .select('id, rol, nombre, prestadora_id')
        .eq('id', userId)
        .maybeSingle();
      if (error) return { usuario: null, fallo: true };
      return { usuario: data ?? null, fallo: false };
    }

    async function cargarUsuario(userId) {
      setEstado('cargando');
      let traido;
      try {
        traido = await traerUsuario(userId);
      } catch {
        traido = { usuario: null, fallo: true };
      }
      if (!activo) return;
      if (traido.fallo) {
        setUsuario(null);
        setEstado('error');
        return;
      }
      setUsuario(traido.usuario);
      setEstado('listo');
    }

    async function cargarSesion() {
      let datos;
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        datos = data;
      } catch {
        if (!activo) return;
        setSession(null);
        setUsuario(null);
        setEstado('error');
        return;
      }
      if (!activo) return;
      setSession(datos.session);
      if (datos.session) {
        await cargarUsuario(datos.session.user.id);
      } else {
        setEstado('listo');
      }
    }

    cargarSesion();

    const { data: listener } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      setSession(nuevaSesion);
      if (nuevaSesion) {
        cargarUsuario(nuevaSesion.user.id);
      } else {
        setUsuario(null);
        setEstado('listo');
      }
    });

    return () => {
      activo = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function login(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function logout() {
    await supabase.auth.signOut();
  }

  return (
    <AuthContext.Provider value={{ session, usuario, estado, cargando, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
