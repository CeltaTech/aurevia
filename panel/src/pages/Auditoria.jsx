import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { supabase } from '../lib/supabaseClient';
import { EstadoLista } from '../components/layout/EstadoLista';
import { mensajeDeError, errorDeLaRespuesta } from '../lib/errores';
import { useAuth } from '../context/AuthContext';
import { useTenantSession } from '../context/TenantSessionContext';

const API_URL = import.meta.env.VITE_API_URL;

async function llamarApi(path) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel${path}`, {
    headers: { Authorization: `Bearer ${data.session?.access_token}` },
  });
  const resultado = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw errorDeLaRespuesta(respuesta, resultado);
  return resultado;
}

// Ítem G del pendiente #30 — lectura del registro de auditoría de las sesiones de soporte
// técnico (auditoria_soporte_tecnico). El alcance lo decide el motor, no esta pantalla: se ve
// el registro de una sola Organización, la de la sesión de soporte abierta —y, si no hay
// ninguna, la Organización de pruebas—. El porqué está escrito en
// `backend/src/routes/panelAuditoria.js`, que es donde vive el filtro.
//
// Lo que sí es de esta pantalla es que el vacío se entienda. Sin sesión de soporte abierta la
// lista casi siempre viene vacía, y una lista vacía sin explicación se lee como "se perdieron
// los datos" o como una pantalla rota. Por eso el cartel del vacío cambia en ese caso y dice
// cuál es la salida: abrir la sesión de soporte sobre la Prestadora que se quiere mirar.
export function Auditoria() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const { sesion } = useTenantSession();
  const [eventos, setEventos] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const esSuperadmin = usuario?.rol === 'superadmin';
  const sinSesionDeSoporte = esSuperadmin && !sesion;

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { eventos: filas } = await llamarApi('/auditoria');
      setEventos(filas);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  // Abrir o cerrar una sesión de soporte cambia qué Organización contesta el motor, así que la
  // lista se vuelve a pedir cuando cambia la sesión: si no, quedaría en pantalla el registro de
  // la Prestadora de la que se acaba de salir.
  useEffect(() => {
    recargar();
  }, [recargar, sesion?.id]);

  function descripcionEvento(evento) {
    if (evento.tipo_evento === 'login') return t.auditoria.evento_login;
    if (evento.tipo_evento === 'renovacion') return t.auditoria.evento_renovacion;
    if (evento.tipo_evento === 'logout') {
      const motivo = evento.detalle?.motivo;
      if (motivo === 'tope_60min') return t.auditoria.evento_logout_tope;
      if (motivo === 'inactividad_5min') return t.auditoria.evento_logout_inactividad;
      return t.auditoria.evento_logout_manual;
    }
    // mutacion
    if (evento.tabla_afectada) {
      return `${t.auditoria.evento_mutacion} — ${evento.tabla_afectada} (${evento.operacion})`;
    }
    if (evento.detalle?.ruta) {
      return `${t.auditoria.evento_mutacion} — ${evento.detalle.metodo} ${evento.detalle.ruta}`;
    }
    return t.auditoria.evento_mutacion;
  }

  return (
    <div>
      <h1>{t.auditoria.titulo}</h1>
      <p className="panel-explicacion">{t.auditoria.explicacion}</p>
      {esSuperadmin && <p className="panel-explicacion">{t.auditoria.alcance_superadmin}</p>}

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && eventos.length === 0}
        recargar={recargar}
        mensajeVacio={sinSesionDeSoporte ? t.auditoria.vacio_sin_sesion_titulo : undefined}
        ayudaVacio={sinSesionDeSoporte ? t.auditoria.vacio_sin_sesion_ayuda : undefined}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.auditoria.col_fecha}</th>
              <th>{t.auditoria.col_admin}</th>
              <th>{t.auditoria.col_prestadora}</th>
              <th>{t.auditoria.col_evento}</th>
            </tr>
          </thead>
          <tbody>
            {eventos.map((evento) => (
              <tr key={evento.id}>
                <td>{new Date(evento.created_at).toLocaleString()}</td>
                <td>{evento.usuarios?.nombre || '—'}</td>
                <td>{evento.prestadoras?.nombre_fantasia || '—'}</td>
                <td>{descripcionEvento(evento)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>
    </div>
  );
}
