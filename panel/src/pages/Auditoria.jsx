import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { supabase } from '../lib/supabaseClient';
import { EstadoLista } from '../components/layout/EstadoLista';

const API_URL = import.meta.env.VITE_API_URL;

async function llamarApi(path) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel${path}`, {
    headers: { Authorization: `Bearer ${data.session?.access_token}` },
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.error);
  return resultado;
}

// Ítem G del pendiente #30 — lectura del log de auditoría de las sesiones de soporte técnico
// (auditoria_soporte_tecnico). Superadmin ve todo; admin_prestadora ve solo lo que pasó
// dentro de su propia Prestadora (filtro ya aplicado por el backend, no acá).
export function Auditoria() {
  const { t } = useLocale();
  const [eventos, setEventos] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { eventos: filas } = await llamarApi('/auditoria');
      setEventos(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

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

      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && eventos.length === 0} recargar={recargar}>
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
