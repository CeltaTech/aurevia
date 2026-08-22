import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { con } from '../../lib/textos';

const API_URL = import.meta.env.VITE_API_URL;

async function llamarApi(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/marketplace${path}`, {
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

export function MarketplaceCalificaciones() {
  const { t } = useLocale();
  const [calificaciones, setCalificaciones] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [cambiandoId, setCambiandoId] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { calificaciones: filas } = await llamarApi('/calificaciones');
      setCalificaciones(filas);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function alternarVisibilidad(calificacion) {
    setCambiandoId(calificacion.id);
    setError(null);
    try {
      await llamarApi(`/calificaciones/${calificacion.id}/visibilidad`, {
        method: 'PATCH',
        body: JSON.stringify({ visible_publica: !calificacion.visible_publica }),
      });
      await recargar();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setCambiandoId(null);
    }
  }

  return (
    <div>
      <h1>{t.marketplace.calificaciones_titulo}</h1>
      <p className="panel-explicacion">{t.marketplace.calificaciones_explicacion}</p>

      {error && <Alert variant="error">{error}</Alert>}

      <EstadoLista estado={estado} error={null} vacio={estado === 'listo' && calificaciones.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.marketplace.col_asistente_calificado}</th>
              <th>{t.marketplace.col_estrellas}</th>
              <th>{t.marketplace.col_comentario}</th>
              <th>{t.marketplace.col_descargo}</th>
              <th>{t.marketplace.col_visible}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {calificaciones.map((c) => (
              <tr key={c.id}>
                <td>{c.asistente_nombre || '—'}</td>
                {/* Las estrellas dibujadas no se leen: un lector de pantalla las nombraría una
                    por una, o directamente las saltearía. Al lado va el mismo dato escrito,
                    que no se ve pero sí se escucha. */}
                <td>
                  <span aria-hidden="true">{'★'.repeat(c.estrellas)}{'☆'.repeat(Math.max(0, 5 - c.estrellas))}</span>
                  <span className="solo-lectores-pantalla">{con(t.comun.puntaje_estrellas, { n: c.estrellas })}</span>
                </td>
                <td>{c.comentario || '—'}</td>
                <td>{c.descargo_asistente || t.marketplace.sin_descargo}</td>
                <td>{c.visible_publica ? t.comun.si : t.comun.no}</td>
                <td>
                  <Button variant="secondary" onClick={() => alternarVisibilidad(c)} disabled={cambiandoId === c.id}>
                    {c.visible_publica ? t.marketplace.marcar_oculta : t.marketplace.marcar_visible}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>
    </div>
  );
}
