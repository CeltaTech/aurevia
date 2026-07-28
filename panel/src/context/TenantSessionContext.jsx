import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { useLocale } from '../i18n/LocaleContext';
import { supabase } from '../lib/supabaseClient';
import { Button } from '../components/ui/Button';

const API_URL = import.meta.env.VITE_API_URL;
const TenantSessionContext = createContext(null);

const POLLING_MS = 30 * 1000; // refleja el corte automático (inactividad o tope) sin recargar
const HEARTBEAT_MINIMO_MS = 60 * 1000; // no manda un heartbeat por cada click, uno por minuto alcanza

async function llamarApi(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel${path}`, {
    ...opciones,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session?.access_token}`,
      ...opciones.headers,
    },
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.error);
  return resultado;
}

export function TenantSessionProvider({ children }) {
  const { t } = useLocale();
  const { usuario } = useAuth();
  // Solo superadmin abre sesiones de soporte técnico dentro de una Prestadora (CLAUDE.md §5).
  const puedeTenerSesion = usuario?.rol === 'superadmin';
  const [sesion, setSesion] = useState(null);
  const ultimoHeartbeatRef = useRef(0);
  const [mensajeConfirmacion, setMensajeConfirmacion] = useState(null);
  const resolverConfirmacionRef = useRef(null);

  const pedirConfirmacion = useCallback((mensaje) => {
    return new Promise((resolve) => {
      resolverConfirmacionRef.current = resolve;
      setMensajeConfirmacion(mensaje);
    });
  }, []);

  const resolverConfirmacion = useCallback((resultado) => {
    resolverConfirmacionRef.current?.(resultado);
    resolverConfirmacionRef.current = null;
    setMensajeConfirmacion(null);
  }, []);

  const recargar = useCallback(async () => {
    if (!puedeTenerSesion) {
      setSesion(null);
      return;
    }
    try {
      const { sesion: sesionActiva } = await llamarApi('/sesion-tenant');
      setSesion(sesionActiva);
    } catch {
      setSesion(null);
    }
  }, [puedeTenerSesion]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  // Ítem D del pendiente #30: mientras hay sesión de tenant activa, el polling refleja el
  // corte automático (5 min de inactividad o tope de 60 min) sin que el usuario tenga que
  // hacer nada — así el banner desaparece solo.
  useEffect(() => {
    if (!sesion) return undefined;
    const intervalo = setInterval(recargar, POLLING_MS);
    return () => clearInterval(intervalo);
  }, [sesion, recargar]);

  // La actividad real del usuario (click/tecla) es lo que mantiene viva la sesión de
  // tenant — no alcanza con contar los requests al backend, porque buena parte del Panel
  // consulta Supabase directo con RLS sin pasar por el backend Express.
  useEffect(() => {
    if (!sesion) return undefined;

    function marcarActividad() {
      const ahora = Date.now();
      if (ahora - ultimoHeartbeatRef.current < HEARTBEAT_MINIMO_MS) return;
      ultimoHeartbeatRef.current = ahora;
      llamarApi('/sesion-tenant/actividad', { method: 'POST' }).catch(() => {});
    }

    window.addEventListener('click', marcarActividad);
    window.addEventListener('keydown', marcarActividad);
    return () => {
      window.removeEventListener('click', marcarActividad);
      window.removeEventListener('keydown', marcarActividad);
    };
  }, [sesion]);

  const salir = useCallback(async () => {
    await llamarApi('/sesion-tenant/salir', { method: 'POST' });
    await recargar();
  }, [recargar]);

  const renovar = useCallback(async () => {
    await llamarApi('/sesion-tenant/renovar', { method: 'POST' });
    await recargar();
  }, [recargar]);

  return (
    <TenantSessionContext.Provider value={{ sesion, recargar, salir, renovar, pedirConfirmacion }}>
      {children}
      {mensajeConfirmacion !== null && (
        <div className="panel-modal-fondo" onClick={() => resolverConfirmacion(false)}>
          <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
            <p>{mensajeConfirmacion}</p>
            <div className="panel-modal-acciones">
              <Button variant="secondary" onClick={() => resolverConfirmacion(false)}>
                {t.comun.cancelar}
              </Button>
              <Button onClick={() => resolverConfirmacion(true)}>{t.comun.confirmar}</Button>
            </div>
          </div>
        </div>
      )}
    </TenantSessionContext.Provider>
  );
}

export function useTenantSession() {
  const ctx = useContext(TenantSessionContext);
  if (!ctx) throw new Error('useTenantSession debe usarse dentro de TenantSessionProvider');
  return ctx;
}

// Ítem F del pendiente #30: refuerza en el momento de cada confirmación destructiva
// (Regla 4) que se está actuando dentro de una Prestadora ajena — el banner
// persistente (item D) ya lo indica todo el tiempo, esto es el aviso puntual al ejecutar.
export function useConfirmarDestructivo() {
  const { t } = useLocale();
  const { sesion, pedirConfirmacion } = useTenantSession();

  return useCallback(
    (mensaje) => {
      const advertencia = sesion
        ? t.prestadoras.confirmar_advertencia_tenant.replace('{prestadora}', sesion.prestadoras?.nombre_fantasia ?? '')
        : '';
      return pedirConfirmacion(`${advertencia}${mensaje}`);
    },
    [sesion, t, pedirConfirmacion]
  );
}
