import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useAuth } from './AuthContext';

const ModalidadesContext = createContext(null);
const API_URL = import.meta.env.VITE_API_URL;

// Modalidades de negocio activas de la Prestadora (directa/marketplace/subcontratacion —
// PRD_08_Dashboard_Modalidades.md, aprobado 2026-07-24). Se carga una vez por sesión, igual
// que PermisosContext, para que Layout.jsx sepa qué grupos de menú mostrar sin volver a
// pedirlo pantalla por pantalla.
export function ModalidadesProvider({ children }) {
  const { usuario } = useAuth();
  const [modalidades, setModalidades] = useState([]);
  const [cargado, setCargado] = useState(false);

  async function cargar() {
    if (!usuario) {
      setModalidades([]);
      setCargado(false);
      return;
    }
    const { data } = await supabase.auth.getSession();
    const respuesta = await fetch(`${API_URL}/api/panel/cuentas/modalidades-activas`, {
      headers: { Authorization: `Bearer ${data.session?.access_token}` },
    });
    if (!respuesta.ok) return;
    const resultado = await respuesta.json();
    setModalidades(resultado.modalidades || []);
    setCargado(true);
  }

  useEffect(() => {
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usuario]);

  function tieneModalidad(modalidad) {
    return modalidades.includes(modalidad);
  }

  return (
    <ModalidadesContext.Provider value={{ modalidades, tieneModalidad, cargado, recargar: cargar }}>
      {children}
    </ModalidadesContext.Provider>
  );
}

export function useModalidades() {
  const ctx = useContext(ModalidadesContext);
  if (!ctx) throw new Error('useModalidades debe usarse dentro de ModalidadesProvider');
  return ctx;
}
