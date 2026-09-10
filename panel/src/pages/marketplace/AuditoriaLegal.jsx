import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { useAdvertenciaLegal } from '../../context/AdvertenciaLegalContext';
import { usePrestadoraActual } from '../../hooks/usePrestadoraActual';
import { esAdminOSuperior } from '../../lib/roles';
import { supabase } from '../../lib/supabaseClient';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { errorDeLaRespuesta, mensajeDeError } from '../../lib/errores';

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
  const resultado = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw errorDeLaRespuesta(respuesta, resultado);
  return resultado;
}

// Pendiente #85, Grupo 3 Marketplace — las cinco funciones de riesgo legal conocido de la
// modalidad marketplace (backend/src/routes/panelMarketplace.js), en la misma pantalla que la
// auditoría de lo que se avisó. Están juntas a propósito: quien enciende una de estas ve, ahí
// mismo y sin cambiar de pantalla, qué se avisó, cuándo y a quién.
//
// AVISA, NO BLOQUEA (CLAUDE.md §7). Las cinco se pueden encender siempre. Lo único que hace la
// pantalla al encender una es mostrar antes la advertencia escrita para el país de esa
// Prestadora; si ese país no tiene documento, no se muestra nada y se enciende igual. Apagar
// no muestra ninguna: lo que el documento legal advierte es de usar la función.
export function MarketplaceAuditoriaLegal() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const prestadoraId = usePrestadoraActual();
  const { verificarAntesDeActivar } = useAdvertenciaLegal();
  const esAdmin = esAdminOSuperior(usuario?.rol);

  const [funciones, setFunciones] = useState([]);
  const [estadoFunciones, setEstadoFunciones] = useState('cargando');
  const [errorFunciones, setErrorFunciones] = useState(null);
  const [cambiando, setCambiando] = useState(null);

  const [eventos, setEventos] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const recargarFunciones = useCallback(async () => {
    setEstadoFunciones('cargando');
    setErrorFunciones(null);
    try {
      const { funciones: filas } = await llamarApi('/funciones-riesgo');
      setFunciones(filas);
      setEstadoFunciones('listo');
    } catch (err) {
      setErrorFunciones(mensajeDeError(err, t));
      setEstadoFunciones('error');
    }
  }, [t]);

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
    recargarFunciones();
    recargar();
  }, [recargarFunciones, recargar]);

  async function cambiar(funcion, activa) {
    // El aviso va antes de pedir el cambio: sirve para decidir, y después de encendida ya no
    // hay nada que decidir. Si la persona lo cancela, no se enciende nada.
    if (activa) {
      const confirmado = await verificarAntesDeActivar(prestadoraId, funcion.clave);
      if (!confirmado) return;
    }
    setCambiando(funcion.clave);
    setErrorFunciones(null);
    try {
      await llamarApi(`/funciones-riesgo/${funcion.clave}`, {
        method: 'PUT',
        body: JSON.stringify({ activa }),
      });
      // Quien anota que se avisó es el motor, así que la auditoría se vuelve a leer de la base
      // en vez de darla por escrita acá.
      await Promise.all([recargarFunciones(), recargar()]);
    } catch (err) {
      setErrorFunciones(mensajeDeError(err, t));
    } finally {
      setCambiando(null);
    }
  }

  return (
    <div>
      <h1>{t.marketplace.auditoria_legal_titulo}</h1>

      <h2>{t.marketplace.funciones_riesgo_titulo}</h2>
      <p className="panel-explicacion">{t.marketplace.funciones_riesgo_explicacion}</p>
      {!esAdmin && <p className="panel-explicacion">{t.marketplace.funciones_riesgo_solo_lectura}</p>}

      <EstadoLista
        estado={estadoFunciones}
        error={errorFunciones}
        vacio={estadoFunciones === 'listo' && funciones.length === 0}
        recargar={recargarFunciones}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.marketplace.funciones_riesgo_col_activa}</th>
              <th>{t.marketplace.funciones_riesgo_col_funcion}</th>
              <th>{t.marketplace.funciones_riesgo_col_aviso}</th>
            </tr>
          </thead>
          <tbody>
            {funciones.map((f) => (
              <tr key={f.clave}>
                <td>
                  <input
                    id={`funcion-${f.clave}`}
                    type="checkbox"
                    checked={f.activa}
                    // Se apaga mientras el cambio está en curso, para que no salgan dos
                    // pedidos por un doble clic; y para el Coordinador queda de sólo lectura,
                    // igual que el candado del motor y el de la base.
                    disabled={!esAdmin || cambiando === f.clave}
                    onChange={(e) => cambiar(f, e.target.checked)}
                  />
                </td>
                <td>
                  <label htmlFor={`funcion-${f.clave}`}>
                    {t.marketplace[`funcion_${f.clave}`] || f.clave}
                  </label>
                </td>
                <td>
                  {f.advertida_en ? (
                    new Date(f.advertida_en).toLocaleString()
                  ) : (
                    <span className="panel-dato-vacio">
                      {f.texto_advertencia ? '—' : t.marketplace.funciones_riesgo_sin_documento}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      <h2>{t.marketplace.auditoria_legal_registro_titulo}</h2>
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
