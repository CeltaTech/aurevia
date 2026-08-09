import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';

const API_URL = import.meta.env.VITE_API_URL;

async function llamarApi(path) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/marketplace${path}`, {
    headers: { Authorization: `Bearer ${data.session?.access_token}` },
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.error);
  return resultado;
}

// Pendiente #85, Grupo 3 Marketplace — auditoría de advertencias legales acotada a las 5
// funcion_clave de riesgo alto de marketplace (backend/src/routes/panelMarketplace.js).
export function MarketplaceAuditoriaLegal() {
  const { t } = useLocale();
  const [eventos, setEventos] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { auditoria: filas } = await llamarApi('/auditoria-legal');
      setEventos(filas);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return (
    <div>
      <h1>{t.marketplace.auditoria_legal_titulo}</h1>
      <p className="panel-explicacion">{t.marketplace.auditoria_legal_explicacion}</p>

      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && eventos.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.marketplace.col_fecha}</th>
              <th>{t.marketplace.col_usuario}</th>
              <th>{t.marketplace.col_funcion}</th>
              <th>{t.marketplace.col_texto_mostrado}</th>
            </tr>
          </thead>
          <tbody>
            {eventos.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.created_at).toLocaleString()}</td>
                <td>{e.usuarios?.nombre || '—'}</td>
                <td>{t.marketplace[`funcion_${e.funcion_clave}`] || e.funcion_clave}</td>
                <td>{e.texto_mostrado}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>
    </div>
  );
}
