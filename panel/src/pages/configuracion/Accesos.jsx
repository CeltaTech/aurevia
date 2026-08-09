import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabaseClient';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';

/* Quién puede hacer qué: los permisos de cada rol y, para el rol técnico de
   CeltaTech, el segundo factor de ingreso. */
export function ConfiguracionAccesos() {
  const { usuario } = useAuth();

  return (
    <>
      <TabPermisos />
      {usuario?.rol === 'superadmin' && <TabSeguridad />}
    </>
  );
}

function TabPermisos() {
  const { t } = useLocale();
  const [permisos, setPermisos] = useState([]);
  const [coordinadores, setCoordinadores] = useState([]);
  const [politica, setPolitica] = useState('omitir');
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardandoAccion, setGuardandoAccion] = useState(null);
  const [guardandoPolitica, setGuardandoPolitica] = useState(false);
  const [politicaGuardada, setPoliticaGuardada] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const [{ permisos: filas, coordinadores: coords }, { politica_verificacion_alta_manual }] = await Promise.all([
        llamarApi('/permisos'),
        llamarApi('/politica-verificacion'),
      ]);
      setPermisos(filas);
      setCoordinadores(coords);
      setPolitica(politica_verificacion_alta_manual);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function actualizarLocal(accion, cambios) {
    setPermisos((filas) => filas.map((f) => (f.accion === accion ? { ...f, ...cambios } : f)));
  }

  function excepcionDe(fila, coordId) {
    if ((fila.excepciones_permitir || []).includes(coordId)) return 'permitir';
    if ((fila.excepciones_denegar || []).includes(coordId)) return 'denegar';
    return 'general';
  }

  function setExcepcion(accion, coordId, valor) {
    setPermisos((filas) => filas.map((f) => {
      if (f.accion !== accion) return f;
      const permitir = (f.excepciones_permitir || []).filter((id) => id !== coordId);
      const denegar = (f.excepciones_denegar || []).filter((id) => id !== coordId);
      if (valor === 'permitir') permitir.push(coordId);
      if (valor === 'denegar') denegar.push(coordId);
      return { ...f, excepciones_permitir: permitir, excepciones_denegar: denegar };
    }));
  }

  async function guardar(fila) {
    setGuardandoAccion(fila.accion);
    setError(null);
    try {
      await llamarApi(`/permisos/${fila.accion}`, {
        method: 'PATCH',
        body: JSON.stringify({
          alcance: fila.alcance,
          excepciones_permitir: fila.excepciones_permitir,
          excepciones_denegar: fila.excepciones_denegar,
        }),
      });
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardandoAccion(null);
    }
  }

  async function guardarPolitica() {
    setGuardandoPolitica(true);
    setError(null);
    setPoliticaGuardada(false);
    try {
      await llamarApi('/politica-verificacion', { method: 'PATCH', body: JSON.stringify({ politica }) });
      setPoliticaGuardada(true);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardandoPolitica(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.permisos_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.permisos_explicacion}</p>
      {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.permisos_col_accion}</th>
              <th>{t.configuracion.permisos_col_alcance}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {permisos.map((fila) => (
              <tr key={fila.accion}>
                <td>{t.configuracion[`permisos_accion_${fila.accion}`]}</td>
                <td>
                  <select
                    value={fila.alcance}
                    onChange={(e) => actualizarLocal(fila.accion, { alcance: e.target.value })}
                  >
                    <option value="solo_admin">{t.configuracion.permisos_alcance_solo_admin}</option>
                    <option value="admin_y_coordinador">{t.configuracion.permisos_alcance_admin_y_coordinador}</option>
                  </select>
                  {coordinadores.length > 0 && (
                    <div className="panel-permisos-excepciones">
                      <span>{t.configuracion.permisos_excepciones_titulo}</span>
                      {coordinadores.map((c) => (
                        <label key={c.id} className="panel-permisos-excepcion-fila">
                          {c.nombre}
                          <select
                            value={excepcionDe(fila, c.id)}
                            onChange={(e) => setExcepcion(fila.accion, c.id, e.target.value)}
                          >
                            <option value="general">{t.configuracion.permisos_excepcion_general}</option>
                            <option value="permitir">{t.configuracion.permisos_excepcion_permitir}</option>
                            <option value="denegar">{t.configuracion.permisos_excepcion_denegar}</option>
                          </select>
                        </label>
                      ))}
                    </div>
                  )}
                </td>
                <td>
                  <button onClick={() => guardar(fila)} disabled={guardandoAccion === fila.accion}>
                    {guardandoAccion === fila.accion ? t.comun.guardando : t.comun.guardar}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      <h2>{t.configuracion.permisos_verificacion_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.permisos_verificacion_explicacion}</p>
      {politicaGuardada && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
      <FormField
        label={t.configuracion.permisos_verificacion_label}
        name="politica_verificacion"
        type="select"
        value={politica}
        onChange={(e) => { setPolitica(e.target.value); setPoliticaGuardada(false); }}
      >
        <option value="omitir">{t.configuracion.permisos_verificacion_omitir}</option>
        <option value="pendiente">{t.configuracion.permisos_verificacion_pendiente}</option>
        <option value="aprobado">{t.configuracion.permisos_verificacion_aprobado}</option>
      </FormField>
      <Button onClick={guardarPolitica} disabled={guardandoPolitica}>
        {guardandoPolitica ? t.comun.guardando : t.comun.guardar}
      </Button>
    </div>
  );
}

// Modalidades de negocio activas (PRD_08_Dashboard_Modalidades.md, aprobado 2026-07-24,
// primer corte "Base: tabla + menú + onboarding"). Punto único de verdad: tabla dedicada
// prestadora_modalidades, no el motor de permisos ni catalogo_modulos (ver
// schema_prestadora_modalidades.sql). 'subcontratacion' no se ofrece todavía: no tiene menú
// ni pantallas (PRD_08 §3.8). Hasta el 2026-08-07 ese valor se llamaba 'cooperativa', que
// nombraba otra cosa (pendiente #115).

function TabSeguridad() {
  const { t } = useLocale();
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [mfaObligatorio, setMfaObligatorio] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [confirmandoActivacion, setConfirmandoActivacion] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const respuesta = await fetch(`${API_URL}/api/panel/configuracion-plataforma/mfa`, {
        headers: { Authorization: `Bearer ${data.session?.access_token}` },
      });
      const resultado = await respuesta.json();
      if (!respuesta.ok) throw new Error(resultado.error);
      setMfaObligatorio(resultado.configuracion.mfa_admin_obligatorio);
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function aplicarCambio(nuevoValor) {
    setGuardando(true);
    try {
      const { data } = await supabase.auth.getSession();
      const respuesta = await fetch(`${API_URL}/api/panel/configuracion-plataforma/mfa`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${data.session?.access_token}`,
        },
        body: JSON.stringify({ mfa_admin_obligatorio: nuevoValor }),
      });
      const resultado = await respuesta.json();
      if (!respuesta.ok) throw new Error(resultado.error);
      setMfaObligatorio(nuevoValor);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  function handleToggle() {
    // Apagar no deja a nadie afuera, así que no necesita advertencia previa — solo activar,
    // que es la operación con riesgo de bloqueo si alguien pierde el celular sin recuperación.
    if (!mfaObligatorio) {
      setConfirmandoActivacion(true);
      return;
    }
    aplicarCambio(false);
  }

  async function confirmarActivacion() {
    setConfirmandoActivacion(false);
    await aplicarCambio(true);
  }

  return (
    <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
      <h2>{t.configuracion.seguridad_mfa_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.seguridad_mfa_explicacion}</p>
      <label className="panel-checkbox">
        <input type="checkbox" checked={mfaObligatorio} onChange={handleToggle} disabled={guardando} />
        {mfaObligatorio ? t.configuracion.seguridad_mfa_activo : t.configuracion.seguridad_mfa_inactivo}
      </label>

      {confirmandoActivacion && (
        <div className="panel-modal-fondo" onClick={() => setConfirmandoActivacion(false)}>
          <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t.configuracion.seguridad_mfa_confirmar_titulo}</h2>
            <ul>
              <li>{t.configuracion.seguridad_mfa_confirmar_item_alcance}</li>
              <li>{t.configuracion.seguridad_mfa_confirmar_item_preparacion}</li>
              <li>{t.configuracion.seguridad_mfa_confirmar_item_sin_recuperacion}</li>
            </ul>
            <div className="panel-modal-acciones">
              <Button variant="secondary" onClick={() => setConfirmandoActivacion(false)} disabled={guardando}>
                {t.comun.cancelar}
              </Button>
              <Button onClick={confirmarActivacion} disabled={guardando}>
                {guardando ? t.comun.guardando : t.configuracion.seguridad_mfa_confirmar_boton}
              </Button>
            </div>
          </div>
        </div>
      )}
    </EstadoLista>
  );
}
