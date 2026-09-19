import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';

const PermisosContext = createContext(null);
const API_URL = import.meta.env.VITE_API_URL;

// Permisos efectivos del usuario logueado (admin/superadmin: todo true; coordinador:
// según lo que haya configurado su Prestadora en Configuración > Permisos — motor
// backend/src/utils/permisos.js). Se carga una vez por sesión, no por pantalla.
//
// LAS TRES SITUACIONES SE DICEN POR SEPARADO. `estado` vale 'cargando' mientras la respuesta
// viaja, 'error' cuando no se pudo resolver, y 'listo' cuando llegó. Antes el
// fallo se tragaba: la carga volvía sin decir nada, `cargado` se quedaba en falso para siempre y
// quien miraba no podía distinguir «todavía no llegó» de «falló».
//
// Y UN PERMISO QUE NO SE PUDO RESOLVER NO ES UN PERMISO CONCEDIDO. `puede()` contesta que no
// mientras el estado no sea 'listo', sin comparar nada: ante una membresía ausente o un dato que
// no se pudo resolver, la respuesta es denegar (`celtatech/CLAUDE.md` §5). Los permisos
// anteriores tampoco quedan puestos —se vacían al empezar cada carga—, porque contestar con los
// de la sesión de antes es contestar por otra persona.
export function PermisosProvider({ children }) {
  const { usuario } = useAuth();
  const [permisos, setPermisos] = useState({});
  const [estado, setEstado] = useState('cargando');

  const cargar = useCallback(
    async (sigueValiendo = () => true) => {
      if (!usuario) {
        if (sigueValiendo()) {
          setPermisos({});
          setEstado('cargando');
        }
        return;
      }
      if (sigueValiendo()) {
        setPermisos({});
        setEstado('cargando');
      }
      try {
        const { data } = await supabase.auth.getSession();
        const respuesta = await fetch(`${API_URL}/api/panel/cuentas/permisos-efectivos`, {
          headers: { Authorization: `Bearer ${data.session?.access_token}` },
        });
        if (!respuesta.ok) throw new Error('permisos-efectivos');
        const resultado = await respuesta.json();
        if (!sigueValiendo()) return;
        setPermisos(resultado.permisos || {});
        setEstado('listo');
      } catch {
        if (!sigueValiendo()) return;
        setPermisos({});
        setEstado('error');
      }
    },
    [usuario],
  );

  useEffect(() => {
    let activo = true;
    cargar(() => activo);
    return () => {
      activo = false;
    };
  }, [cargar]);

  function puede(accion) {
    if (estado !== 'listo') return false;
    return !!permisos[accion];
  }

  return (
    <PermisosContext.Provider
      value={{ permisos, puede, estado, cargado: estado === 'listo', recargar: () => cargar() }}
    >
      {children}
    </PermisosContext.Provider>
  );
}

export function usePermisos() {
  const ctx = useContext(PermisosContext);
  if (!ctx) throw new Error('usePermisos debe usarse dentro de PermisosProvider');
  return ctx;
}
