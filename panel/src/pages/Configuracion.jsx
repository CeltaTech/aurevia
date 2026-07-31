import { Fragment, useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { useModalidades } from '../context/ModalidadesContext';
import { useConfirmarDestructivo } from '../context/TenantSessionContext';
import { supabase } from '../lib/supabaseClient';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Alert } from '../components/ui/Alert';
import { EstadoLista } from '../components/layout/EstadoLista';
import { traducirValor } from '../i18n/valores';
import { SIGNOS_VITALES } from '../lib/signosVitales';

const API_URL = import.meta.env.VITE_API_URL;

async function llamarApi(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/configuracion${path}`, {
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

async function llamarApiMarketplace(path, opciones = {}) {
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

const TABS = ['empresa', 'modalidades', 'zonas', 'servicios', 'documentos', 'vitales', 'habilitacion_medicacion', 'notificaciones', 'whatsapp', 'permisos'];
const ROLES_RELEVO = ['suplente', 'franquero', 'emergencia', 'familiar'];
const TIPOS_PERSONAL_EMERGENCIA = ['franquero', 'emergencia'];

export function Configuracion() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const { tieneModalidad } = useModalidades();
  const [tab, setTab] = useState('empresa');

  // Pestaña "seguridad" (toggle de MFA, ítem H del pendiente #30) solo para superadmin, que
  // es justamente el rol que el toggle protege.
  let tabs = tieneModalidad('marketplace') ? [...TABS, 'pasarela'] : TABS;
  if (usuario?.rol === 'superadmin') tabs = [...tabs, 'seguridad'];

  return (
    <div>
      <h1>{t.configuracion.titulo}</h1>
      <p className="panel-explicacion">{t.configuracion.explicacion}</p>

      <div className="panel-tabs">
        {tabs.map((tabId) => (
          <button
            key={tabId}
            className={`panel-tab ${tab === tabId ? 'panel-tab-activo' : ''}`}
            onClick={() => setTab(tabId)}
          >
            {t.configuracion[`tab_${tabId}`]}
          </button>
        ))}
      </div>

      <div className="panel-tab-contenido">
        {tab === 'empresa' && <TabEmpresa />}
        {tab === 'modalidades' && <TabModalidades />}
        {tab === 'zonas' && <TabZonas />}
        {tab === 'servicios' && <TabServicios />}
        {tab === 'documentos' && <TabDocumentos />}
        {tab === 'vitales' && <TabVitales />}
        {tab === 'habilitacion_medicacion' && <TabHabilitacionMedicacion />}
        {tab === 'notificaciones' && <TabNotificaciones />}
        {tab === 'whatsapp' && <TabWhatsapp />}
        {tab === 'permisos' && <TabPermisos />}
        {tab === 'pasarela' && tieneModalidad('marketplace') && <TabPasarela />}
        {tab === 'seguridad' && usuario?.rol === 'superadmin' && <TabSeguridad />}
      </div>
    </div>
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
      setError(err.message);
      setEstado('error');
    }
  }, []);

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
      setError(err.message);
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
      setError(err.message);
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
// schema_prestadora_modalidades.sql). 'cooperativa' no se ofrece todavía: no tiene menú ni
// pantallas (PRD_08 §3.8).
function TabModalidades() {
  const { t } = useLocale();
  const { recargar: recargarMenu } = useModalidades();
  const [modalidades, setModalidades] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [actualizandoModalidad, setActualizandoModalidad] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { modalidades: filas } = await llamarApi('/modalidades');
      setModalidades(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function toggleActiva(fila) {
    setActualizandoModalidad(fila.modalidad);
    setError(null);
    try {
      await llamarApi(`/modalidades/${fila.modalidad}`, {
        method: 'PATCH',
        body: JSON.stringify({ activa: !fila.activa }),
      });
      await Promise.all([recargar(), recargarMenu()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoModalidad(null);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.modalidades_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.modalidades_explicacion}</p>
      {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.modalidades_col_modalidad}</th>
              <th>{t.configuracion.modalidades_col_activa}</th>
            </tr>
          </thead>
          <tbody>
            {modalidades.map((fila) => (
              <tr key={fila.modalidad}>
                <td>{t.configuracion[`modalidades_${fila.modalidad}`]}</td>
                <td>
                  <input
                    type="checkbox"
                    checked={fila.activa}
                    onChange={() => toggleActiva(fila)}
                    disabled={actualizandoModalidad === fila.modalidad}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>
    </div>
  );
}

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
      setError(err.message);
      setEstado('error');
    }
  }, []);

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
      setError(err.message);
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

function TabEmpresa() {
  const { t } = useLocale();
  const [form, setForm] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { empresa } = await llamarApi('/empresa');
      setForm(empresa);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function set(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setGuardado(false);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/empresa', { method: 'PATCH', body: JSON.stringify(form) });
      setGuardado(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
      {form && (
        <div>
          {error && <Alert variant="error">{error}</Alert>}
          {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
          <FormField label={t.configuracion.empresa_nombre} name="nombre" value={form.nombre || ''} onChange={(e) => set('nombre', e.target.value)} />
          <FormField label={t.configuracion.empresa_telefono} name="telefono" value={form.telefono || ''} onChange={(e) => set('telefono', e.target.value)} />
          <FormField label={t.configuracion.empresa_whatsapp} name="whatsapp_numero" value={form.whatsapp_numero || ''} onChange={(e) => set('whatsapp_numero', e.target.value)} />
          <FormField label={t.configuracion.empresa_email} name="email" type="email" value={form.email || ''} onChange={(e) => set('email', e.target.value)} />
          <FormField label={t.configuracion.empresa_dominio} name="dominio" value={form.dominio || ''} onChange={(e) => set('dominio', e.target.value)} />
          <FormField label={t.configuracion.empresa_zona_texto} name="zona_cobertura_texto" value={form.zona_cobertura_texto || ''} onChange={(e) => set('zona_cobertura_texto', e.target.value)} />
          <Button onClick={guardar} disabled={guardando}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
        </div>
      )}
    </EstadoLista>
  );
}

function TabZonas() {
  const { t } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();
  const [zonas, setZonas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [creandoNueva, setCreandoNueva] = useState(false);
  const [actualizandoZona, setActualizandoZona] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { zonas: filas } = await llamarApi('/zonas');
      setZonas(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function toggleActiva(zona) {
    setActualizandoZona(zona.id);
    try {
      await llamarApi(`/zonas/${zona.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nombre: zona.nombre, categoria: zona.categoria, orden: zona.orden, activa: !zona.activa }),
      });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoZona(null);
    }
  }

  async function borrar(zona) {
    if (!(await confirmarDestructivo(t.configuracion.zonas_confirmar_borrar))) return;
    setActualizandoZona(zona.id);
    try {
      await llamarApi(`/zonas/${zona.id}`, { method: 'DELETE' });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoZona(null);
    }
  }

  return (
    <div>
      {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}
      <div className="panel-filtros">
        <Button onClick={() => setCreandoNueva(true)}>{t.configuracion.zonas_nueva}</Button>
      </div>
      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && zonas.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.zonas_col_codigo}</th>
              <th>{t.configuracion.zonas_col_nombre}</th>
              <th>{t.configuracion.zonas_col_categoria}</th>
              <th>{t.configuracion.zonas_col_activa}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {zonas.map((z) => (
              <tr key={z.id}>
                <td>{z.codigo}</td>
                <td>{z.nombre}</td>
                <td>{z.categoria}</td>
                <td>
                  <input type="checkbox" checked={z.activa} onChange={() => toggleActiva(z)} disabled={actualizandoZona === z.id} />
                </td>
                <td>
                  <button onClick={() => borrar(z)} disabled={actualizandoZona === z.id}>{t.comun.borrar}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {creandoNueva && (
        <NuevaZona onClose={() => setCreandoNueva(false)} onCreada={() => { setCreandoNueva(false); recargar(); }} />
      )}
    </div>
  );
}

function NuevaZona({ onClose, onCreada }) {
  const { t } = useLocale();
  const [codigo, setCodigo] = useState('');
  const [nombre, setNombre] = useState('');
  const [categoria, setCategoria] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function handleGuardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/zonas', { method: 'POST', body: JSON.stringify({ codigo, nombre, categoria }) });
      onCreada();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.configuracion.zonas_nueva}</h2>
        {error && <Alert variant="error">{error}</Alert>}
        <FormField label={t.configuracion.zonas_col_codigo} name="codigo" value={codigo} onChange={(e) => setCodigo(e.target.value)} required />
        <FormField label={t.configuracion.zonas_col_nombre} name="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        <FormField label={t.configuracion.zonas_col_categoria} name="categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)} required />
        <p className="panel-explicacion">{t.configuracion.zonas_categoria_explicacion}</p>
        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>{t.comun.cancelar}</Button>
          <Button onClick={handleGuardar} disabled={guardando || !codigo || !nombre}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabServicios() {
  const { t } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();
  const [niveles, setNiveles] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [creandoNuevo, setCreandoNuevo] = useState(false);
  const [actualizandoId, setActualizandoId] = useState(null);

  const [diasGeneracion, setDiasGeneracion] = useState('');
  const [guardandoHorizonte, setGuardandoHorizonte] = useState(false);
  const [horizonteGuardado, setHorizonteGuardado] = useState(false);

  const [ausenciaActiva, setAusenciaActiva] = useState(true);
  const [minutosTolerancia, setMinutosTolerancia] = useState('');
  const [metrosTolerancia, setMetrosTolerancia] = useState('');
  const [guardandoAusencia, setGuardandoAusencia] = useState(false);
  const [ausenciaGuardada, setAusenciaGuardada] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const [{ niveles: filas }, { dias_generacion_series_guardia }, { configuracion }] = await Promise.all([
        llamarApi('/escalada-relevo'),
        llamarApi('/guardias/horizonte-generacion'),
        llamarApi('/ausencia-automatica'),
      ]);
      setNiveles(filas);
      setDiasGeneracion(String(dias_generacion_series_guardia));
      setAusenciaActiva(configuracion.activo);
      setMinutosTolerancia(String(configuracion.minutos_tolerancia_checkin));
      setMetrosTolerancia(String(configuracion.metros_tolerancia_checkin));
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function guardarHorizonte() {
    setGuardandoHorizonte(true);
    setError(null);
    setHorizonteGuardado(false);
    try {
      await llamarApi('/guardias/horizonte-generacion', {
        method: 'PATCH',
        body: JSON.stringify({ dias: Number(diasGeneracion) }),
      });
      setHorizonteGuardado(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoHorizonte(false);
    }
  }

  async function guardarAusencia() {
    setGuardandoAusencia(true);
    setError(null);
    setAusenciaGuardada(false);
    try {
      await llamarApi('/ausencia-automatica', {
        method: 'PATCH',
        body: JSON.stringify({
          activo: ausenciaActiva,
          minutos_tolerancia_checkin: Number(minutosTolerancia),
          metros_tolerancia_checkin: Number(metrosTolerancia),
        }),
      });
      setAusenciaGuardada(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoAusencia(false);
    }
  }

  async function borrar(fila) {
    if (!(await confirmarDestructivo(t.configuracion.escalada_confirmar_borrar))) return;
    setActualizandoId(fila.id);
    try {
      await llamarApi(`/escalada-relevo/${fila.id}`, { method: 'DELETE' });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoId(null);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.servicios_horizonte_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.servicios_horizonte_explicacion}</p>
      {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}
      {horizonteGuardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
      <FormField
        label={t.configuracion.servicios_horizonte_dias}
        name="dias_generacion"
        type="number"
        value={diasGeneracion}
        onChange={(e) => { setDiasGeneracion(e.target.value); setHorizonteGuardado(false); }}
      />
      <Button onClick={guardarHorizonte} disabled={guardandoHorizonte || !diasGeneracion}>
        {guardandoHorizonte ? t.comun.guardando : t.comun.guardar}
      </Button>

      <h2>{t.configuracion.servicios_ausencia_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.servicios_ausencia_explicacion}</p>
      {ausenciaGuardada && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
      <FormField label={t.configuracion.servicios_ausencia_activa} name="ausencia_activa" type="checkbox" checked={ausenciaActiva} onChange={(e) => { setAusenciaActiva(e.target.checked); setAusenciaGuardada(false); }} />
      <FormField
        label={t.configuracion.servicios_ausencia_minutos}
        name="minutos_tolerancia_checkin"
        type="number"
        value={minutosTolerancia}
        onChange={(e) => { setMinutosTolerancia(e.target.value); setAusenciaGuardada(false); }}
      />
      <FormField
        label={t.configuracion.servicios_ausencia_metros}
        name="metros_tolerancia_checkin"
        type="number"
        value={metrosTolerancia}
        onChange={(e) => { setMetrosTolerancia(e.target.value); setAusenciaGuardada(false); }}
      />
      <Button onClick={guardarAusencia} disabled={guardandoAusencia || !minutosTolerancia || !metrosTolerancia}>
        {guardandoAusencia ? t.comun.guardando : t.comun.guardar}
      </Button>

      <h2>{t.configuracion.servicios_escalada_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.servicios_escalada_explicacion}</p>
      <div className="panel-filtros">
        <Button onClick={() => setCreandoNuevo(true)}>{t.configuracion.escalada_nuevo_nivel}</Button>
      </div>
      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && niveles.length === 0} recargar={recargar} mensajeVacio={t.configuracion.escalada_vacio}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.escalada_col_nivel}</th>
              <th>{t.configuracion.escalada_col_minutos}</th>
              <th>{t.configuracion.escalada_col_orden}</th>
              <th>{t.configuracion.escalada_col_mensaje}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {niveles.map((n) => (
              <tr key={n.id}>
                <td>{n.nivel}</td>
                <td>{n.minutos_demora ?? '—'}</td>
                <td>{(n.orden_prioridad || []).map((r) => t.configuracion[`escalada_rol_${r}`]).join(' → ') || '—'}</td>
                <td>{n.plantilla_mensaje}</td>
                <td>
                  <button onClick={() => borrar(n)} disabled={actualizandoId === n.id}>{t.comun.borrar}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {creandoNuevo && (
        <NuevoNivelEscalada onClose={() => setCreandoNuevo(false)} onCreado={() => { setCreandoNuevo(false); recargar(); }} />
      )}

      <TabServiciosPersonalEmergencia />
      <TabServiciosMotivosAvisoPrevio />
      <TabServiciosEtapasIncorporacion />
    </div>
  );
}

function TabServiciosMotivosAvisoPrevio() {
  const { t } = useLocale();
  const [motivos, setMotivos] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [creandoNuevo, setCreandoNuevo] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [actualizandoId, setActualizandoId] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { motivos: filas } = await llamarApi('/motivos-aviso-previo');
      setMotivos(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function toggleActivo(fila) {
    setActualizandoId(fila.id);
    try {
      await llamarApi(`/motivos-aviso-previo/${fila.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nombre: fila.nombre, activo: !fila.activo }),
      });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoId(null);
    }
  }

  async function crear() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/motivos-aviso-previo', { method: 'POST', body: JSON.stringify({ nombre: nombreNuevo }) });
      setNombreNuevo('');
      setCreandoNuevo(false);
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.motivos_aviso_previo_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.motivos_aviso_previo_explicacion}</p>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="panel-filtros">
        <Button onClick={() => setCreandoNuevo(true)}>{t.configuracion.motivos_aviso_previo_nuevo}</Button>
      </div>
      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && motivos.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.motivos_aviso_previo_col_nombre}</th>
              <th>{t.configuracion.documentos_tipos_col_activo}</th>
            </tr>
          </thead>
          <tbody>
            {motivos.map((m) => (
              <tr key={m.id}>
                <td>{m.nombre}</td>
                <td>
                  <input type="checkbox" checked={m.activo} onChange={() => toggleActivo(m)} disabled={actualizandoId === m.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {creandoNuevo && (
        <div className="panel-modal-fondo" onClick={() => setCreandoNuevo(false)}>
          <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t.configuracion.motivos_aviso_previo_nuevo}</h2>
            <FormField label={t.configuracion.motivos_aviso_previo_col_nombre} name="nombre" value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} required />
            <div className="panel-modal-acciones">
              <Button variant="secondary" onClick={() => setCreandoNuevo(false)} disabled={guardando}>{t.comun.cancelar}</Button>
              <Button onClick={crear} disabled={guardando || !nombreNuevo}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabServiciosEtapasIncorporacion() {
  const { t } = useLocale();
  const [etapas, setEtapas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [creandoNueva, setCreandoNueva] = useState(false);
  const [claveNueva, setClaveNueva] = useState('');
  const [nombreNueva, setNombreNueva] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [actualizandoId, setActualizandoId] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { etapas: filas } = await llamarApi('/etapas-incorporacion');
      setEtapas(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function toggleActiva(fila) {
    setActualizandoId(fila.id);
    try {
      await llamarApi(`/etapas-incorporacion/${fila.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nombre: fila.nombre, activa: !fila.activa }),
      });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoId(null);
    }
  }

  async function mover(fila, direccion) {
    setActualizandoId(fila.id);
    try {
      await llamarApi(`/etapas-incorporacion/${fila.id}/mover`, { method: 'PATCH', body: JSON.stringify({ direccion }) });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoId(null);
    }
  }

  async function crear() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/etapas-incorporacion', { method: 'POST', body: JSON.stringify({ clave: claveNueva, nombre: nombreNueva }) });
      setClaveNueva('');
      setNombreNueva('');
      setCreandoNueva(false);
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.etapas_incorporacion_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.etapas_incorporacion_explicacion}</p>
      {error && <Alert variant="error">{error}</Alert>}
      <div className="panel-filtros">
        <Button onClick={() => setCreandoNueva(true)}>{t.configuracion.etapas_incorporacion_nueva}</Button>
      </div>
      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && etapas.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.etapas_incorporacion_col_orden}</th>
              <th>{t.configuracion.etapas_incorporacion_col_nombre}</th>
              <th>{t.configuracion.documentos_tipos_col_activo}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {etapas.map((e, i) => (
              <tr key={e.id}>
                <td>{e.orden}</td>
                <td>{e.nombre}</td>
                <td>
                  <input type="checkbox" checked={e.activa} onChange={() => toggleActiva(e)} disabled={actualizandoId === e.id} />
                </td>
                <td>
                  <button onClick={() => mover(e, 'arriba')} disabled={actualizandoId === e.id || i === 0}>↑</button>
                  <button onClick={() => mover(e, 'abajo')} disabled={actualizandoId === e.id || i === etapas.length - 1}>↓</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {creandoNueva && (
        <div className="panel-modal-fondo" onClick={() => setCreandoNueva(false)}>
          <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
            <h2>{t.configuracion.etapas_incorporacion_nueva}</h2>
            <FormField label={t.configuracion.etapas_incorporacion_col_clave} name="clave" value={claveNueva} onChange={(e) => setClaveNueva(e.target.value)} required />
            <FormField label={t.configuracion.etapas_incorporacion_col_nombre} name="nombre" value={nombreNueva} onChange={(e) => setNombreNueva(e.target.value)} required />
            <div className="panel-modal-acciones">
              <Button variant="secondary" onClick={() => setCreandoNueva(false)} disabled={guardando}>{t.comun.cancelar}</Button>
              <Button onClick={crear} disabled={guardando || !claveNueva || !nombreNueva}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TabServiciosPersonalEmergencia() {
  const { t } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();
  const [personal, setPersonal] = useState([]);
  const [asistentes, setAsistentes] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [creandoNuevo, setCreandoNuevo] = useState(false);
  const [actualizandoId, setActualizandoId] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const [{ personal: filas }, { data: asistentesData, error: errorAsistentes }] = await Promise.all([
        llamarApi('/personal-emergencia'),
        supabase.from('asistentes').select('id, nombre').order('nombre'),
      ]);
      if (errorAsistentes) throw errorAsistentes;
      setPersonal(filas);
      setAsistentes(asistentesData ?? []);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function toggleActivo(fila) {
    setActualizandoId(fila.id);
    try {
      await llamarApi(`/personal-emergencia/${fila.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo: !fila.activo }),
      });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoId(null);
    }
  }

  async function borrar(fila) {
    if (!(await confirmarDestructivo(t.configuracion.personal_emergencia_confirmar_borrar))) return;
    setActualizandoId(fila.id);
    try {
      await llamarApi(`/personal-emergencia/${fila.id}`, { method: 'DELETE' });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoId(null);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.personal_emergencia_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.personal_emergencia_explicacion}</p>
      {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}
      <div className="panel-filtros">
        <Button onClick={() => setCreandoNuevo(true)}>{t.configuracion.personal_emergencia_nuevo}</Button>
      </div>
      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && personal.length === 0}
        recargar={recargar}
        mensajeVacio={t.configuracion.personal_emergencia_vacio}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.personal_emergencia_col_asistente}</th>
              <th>{t.configuracion.personal_emergencia_col_tipo}</th>
              <th>{t.configuracion.personal_emergencia_col_activo}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {personal.map((fila) => (
              <tr key={fila.id}>
                <td>{fila.asistentes?.nombre || '—'}</td>
                <td>{t.configuracion[`personal_emergencia_tipo_${fila.tipo}`]}</td>
                <td>
                  <input type="checkbox" checked={fila.activo} onChange={() => toggleActivo(fila)} disabled={actualizandoId === fila.id} />
                </td>
                <td>
                  <button onClick={() => borrar(fila)} disabled={actualizandoId === fila.id}>{t.comun.borrar}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {creandoNuevo && (
        <NuevoPersonalEmergencia
          asistentes={asistentes}
          onClose={() => setCreandoNuevo(false)}
          onCreado={() => { setCreandoNuevo(false); recargar(); }}
        />
      )}
    </div>
  );
}

function NuevoPersonalEmergencia({ asistentes, onClose, onCreado }) {
  const { t } = useLocale();
  const [asistenteId, setAsistenteId] = useState('');
  const [tipo, setTipo] = useState('franquero');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function handleGuardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/personal-emergencia', {
        method: 'POST',
        body: JSON.stringify({ asistente_id: asistenteId, tipo }),
      });
      onCreado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.configuracion.personal_emergencia_nuevo}</h2>
        {error && <Alert variant="error">{error}</Alert>}
        <FormField
          label={t.configuracion.personal_emergencia_col_asistente}
          name="asistente_id"
          type="select"
          value={asistenteId}
          onChange={(e) => setAsistenteId(e.target.value)}
          required
        >
          <option value="">{t.configuracion.escalada_prioridad_vacio}</option>
          {asistentes.map((a) => (
            <option key={a.id} value={a.id}>{a.nombre}</option>
          ))}
        </FormField>
        <FormField
          label={t.configuracion.personal_emergencia_col_tipo}
          name="tipo"
          type="select"
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
        >
          {TIPOS_PERSONAL_EMERGENCIA.map((tipoOpcion) => (
            <option key={tipoOpcion} value={tipoOpcion}>{t.configuracion[`personal_emergencia_tipo_${tipoOpcion}`]}</option>
          ))}
        </FormField>
        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>{t.comun.cancelar}</Button>
          <Button onClick={handleGuardar} disabled={guardando || !asistenteId}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}

function NuevoNivelEscalada({ onClose, onCreado }) {
  const { t } = useLocale();
  const [nivel, setNivel] = useState('');
  const [minutosDemora, setMinutosDemora] = useState('');
  const [ordenPrioridad, setOrdenPrioridad] = useState(['', '', '', '']);
  const [plantillaMensaje, setPlantillaMensaje] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  function setPrioridad(indice, valor) {
    setOrdenPrioridad((actual) => actual.map((v, i) => (i === indice ? valor : v)));
  }

  async function handleGuardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/escalada-relevo', {
        method: 'POST',
        body: JSON.stringify({
          nivel: Number(nivel),
          minutos_demora: minutosDemora === '' ? null : Number(minutosDemora),
          orden_prioridad: ordenPrioridad.filter(Boolean),
          plantilla_mensaje: plantillaMensaje,
        }),
      });
      onCreado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.configuracion.escalada_nuevo_nivel}</h2>
        {error && <Alert variant="error">{error}</Alert>}
        <FormField label={t.configuracion.escalada_col_nivel} name="nivel" type="number" value={nivel} onChange={(e) => setNivel(e.target.value)} required />
        <FormField label={t.configuracion.escalada_minutos_label} name="minutos_demora" type="number" value={minutosDemora} onChange={(e) => setMinutosDemora(e.target.value)} />
        {ordenPrioridad.map((valor, indice) => (
          <FormField
            key={indice}
            label={`${t.configuracion.escalada_prioridad_label} ${indice + 1}`}
            name={`prioridad_${indice}`}
            type="select"
            value={valor}
            onChange={(e) => setPrioridad(indice, e.target.value)}
          >
            <option value="">{t.configuracion.escalada_prioridad_vacio}</option>
            {ROLES_RELEVO.map((rol) => (
              <option key={rol} value={rol}>{t.configuracion[`escalada_rol_${rol}`]}</option>
            ))}
          </FormField>
        ))}
        <FormField
          label={t.configuracion.escalada_col_mensaje}
          name="plantilla_mensaje"
          type="textarea"
          value={plantillaMensaje}
          onChange={(e) => setPlantillaMensaje(e.target.value)}
          required
        />
        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>{t.comun.cancelar}</Button>
          <Button onClick={handleGuardar} disabled={guardando || !nivel || !plantillaMensaje}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabDocumentos() {
  const { t } = useLocale();
  const [tipos, setTipos] = useState([]);
  const [diasAviso, setDiasAviso] = useState('');
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [creandoNuevo, setCreandoNuevo] = useState(false);
  const [actualizandoId, setActualizandoId] = useState(null);
  const [guardandoPlazo, setGuardandoPlazo] = useState(false);
  const [plazoGuardado, setPlazoGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { tipos: filas, dias_aviso_vencimiento_documentos } = await llamarApi('/documentos-tipo');
      setTipos(filas);
      setDiasAviso(String(dias_aviso_vencimiento_documentos));
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function toggleActivo(fila) {
    setActualizandoId(fila.id);
    try {
      await llamarApi(`/documentos-tipo/${fila.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ nombre: fila.nombre, requiere_vencimiento: fila.requiere_vencimiento, activo: !fila.activo }),
      });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoId(null);
    }
  }

  async function guardarPlazo() {
    setGuardandoPlazo(true);
    setError(null);
    setPlazoGuardado(false);
    try {
      await llamarApi('/documentos-tipo/plazo-aviso', {
        method: 'PATCH',
        body: JSON.stringify({ dias: Number(diasAviso) }),
      });
      setPlazoGuardado(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoPlazo(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.documentos_plazo_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.documentos_plazo_explicacion}</p>
      {error && <Alert variant="error">{error}</Alert>}
      {plazoGuardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
      <FormField
        label={t.configuracion.documentos_plazo_dias}
        name="dias_aviso"
        type="number"
        value={diasAviso}
        onChange={(e) => { setDiasAviso(e.target.value); setPlazoGuardado(false); }}
      />
      <Button onClick={guardarPlazo} disabled={guardandoPlazo || !diasAviso}>
        {guardandoPlazo ? t.comun.guardando : t.comun.guardar}
      </Button>

      <h2>{t.configuracion.documentos_tipos_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.documentos_tipos_explicacion}</p>
      <div className="panel-filtros">
        <Button onClick={() => setCreandoNuevo(true)}>{t.configuracion.documentos_tipos_nuevo}</Button>
      </div>
      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && tipos.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.documentos_tipos_col_nombre}</th>
              <th>{t.configuracion.documentos_tipos_col_requiere_vencimiento}</th>
              <th>{t.configuracion.documentos_tipos_col_activo}</th>
            </tr>
          </thead>
          <tbody>
            {tipos.map((tipo) => (
              <tr key={tipo.id}>
                <td>{tipo.nombre}</td>
                <td>{tipo.requiere_vencimiento ? t.comun.si : t.comun.no}</td>
                <td>
                  <input type="checkbox" checked={tipo.activo} onChange={() => toggleActivo(tipo)} disabled={actualizandoId === tipo.id} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {creandoNuevo && (
        <NuevoTipoDocumento onClose={() => setCreandoNuevo(false)} onCreado={() => { setCreandoNuevo(false); recargar(); }} />
      )}
    </div>
  );
}

function NuevoTipoDocumento({ onClose, onCreado }) {
  const { t } = useLocale();
  const [nombre, setNombre] = useState('');
  const [requiereVencimiento, setRequiereVencimiento] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function handleGuardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/documentos-tipo', {
        method: 'POST',
        body: JSON.stringify({ nombre, requiere_vencimiento: requiereVencimiento }),
      });
      onCreado();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.configuracion.documentos_tipos_nuevo}</h2>
        {error && <Alert variant="error">{error}</Alert>}
        <FormField label={t.configuracion.documentos_tipos_col_nombre} name="nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} required />
        <FormField
          label={t.configuracion.documentos_tipos_col_requiere_vencimiento}
          name="requiere_vencimiento"
          type="checkbox"
          checked={requiereVencimiento}
          onChange={(e) => setRequiereVencimiento(e.target.checked)}
        />
        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>{t.comun.cancelar}</Button>
          <Button onClick={handleGuardar} disabled={guardando || !nombre}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabVitales() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const [rangos, setRangos] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardandoSigno, setGuardandoSigno] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from('rangos_referencia_vitales')
      .select('*')
      .eq('prestadora_id', usuario.prestadora_id)
      .is('paciente_id', null)
      .order('signo');
    if (errorConsulta) {
      setError(errorConsulta.message);
      setEstado('error');
      return;
    }
    setRangos(data ?? []);
    setEstado('listo');
  }, [usuario.prestadora_id]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function set(signo, campo, valor) {
    setRangos((filas) => filas.map((f) => (f.signo === signo ? { ...f, [campo]: valor } : f)));
  }

  async function guardar(fila) {
    setGuardandoSigno(fila.signo);
    setError(null);
    const { error: errorUpdate } = await supabase
      .from('rangos_referencia_vitales')
      .update({
        valor_min: Number(fila.valor_min),
        valor_max: Number(fila.valor_max),
        unidad: fila.unidad,
        fuente: fila.fuente,
        updated_at: new Date().toISOString(),
      })
      .eq('id', fila.id);
    setGuardandoSigno(null);
    if (errorUpdate) {
      setError(errorUpdate.message);
      return;
    }
    recargar();
  }

  return (
    <div>
      <h2>{t.configuracion.vitales_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.vitales_explicacion}</p>
      {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}
      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && rangos.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.vitales_col_signo}</th>
              <th>{t.configuracion.vitales_col_min}</th>
              <th>{t.configuracion.vitales_col_max}</th>
              <th>{t.configuracion.vitales_col_unidad}</th>
              <th>{t.configuracion.vitales_col_fuente}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rangos.map((fila) => (
              <tr key={fila.signo}>
                <td>{t.configuracion[`vitales_signo_${fila.signo}`]}</td>
                <td><input type="number" step="0.1" value={fila.valor_min} onChange={(e) => set(fila.signo, 'valor_min', e.target.value)} /></td>
                <td><input type="number" step="0.1" value={fila.valor_max} onChange={(e) => set(fila.signo, 'valor_max', e.target.value)} /></td>
                <td><input type="text" value={fila.unidad} onChange={(e) => set(fila.signo, 'unidad', e.target.value)} /></td>
                <td><input type="text" value={fila.fuente} onChange={(e) => set(fila.signo, 'fuente', e.target.value)} /></td>
                <td>
                  <button onClick={() => guardar(fila)} disabled={guardandoSigno === fila.signo}>
                    {guardandoSigno === fila.signo ? t.comun.guardando : t.comun.guardar}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>
    </div>
  );
}

function TabHabilitacionMedicacion() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const confirmarDestructivo = useConfirmarDestructivo();
  const [filas, setFilas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardandoId, setGuardandoId] = useState(null);
  const [nuevaVia, setNuevaVia] = useState('');
  const [nuevoTipo, setNuevoTipo] = useState('');
  const [agregando, setAgregando] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from('configuracion_habilitacion_via_medicacion')
      .select('*')
      .eq('prestadora_id', usuario.prestadora_id)
      .order('via_administracion');
    if (errorConsulta) {
      setError(errorConsulta.message);
      setEstado('error');
      return;
    }
    setFilas(data ?? []);
    setEstado('listo');
  }, [usuario.prestadora_id]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function set(id, valor) {
    setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, tipo_habilitacion_requerida: valor } : f)));
  }

  async function guardar(fila) {
    setGuardandoId(fila.id);
    setError(null);
    const { error: errorUpdate } = await supabase
      .from('configuracion_habilitacion_via_medicacion')
      .update({ tipo_habilitacion_requerida: fila.tipo_habilitacion_requerida || null, updated_at: new Date().toISOString() })
      .eq('id', fila.id);
    setGuardandoId(null);
    if (errorUpdate) {
      setError(t.comun.error_generico);
      return;
    }
    recargar();
  }

  async function agregar() {
    setAgregando(true);
    setError(null);
    const { error: errorInsert } = await supabase.from('configuracion_habilitacion_via_medicacion').insert({
      prestadora_id: usuario.prestadora_id,
      via_administracion: nuevaVia,
      tipo_habilitacion_requerida: nuevoTipo || null,
    });
    setAgregando(false);
    if (errorInsert) {
      setError(t.comun.error_generico);
      return;
    }
    setNuevaVia('');
    setNuevoTipo('');
    recargar();
  }

  async function borrar(fila) {
    if (!(await confirmarDestructivo(t.configuracion.habilitacion_medicacion_confirmar_borrar))) return;
    setGuardandoId(fila.id);
    setError(null);
    const { error: errorDelete } = await supabase.from('configuracion_habilitacion_via_medicacion').delete().eq('id', fila.id);
    setGuardandoId(null);
    if (errorDelete) {
      setError(t.comun.error_generico);
      return;
    }
    recargar();
  }

  return (
    <div>
      <h2>{t.configuracion.habilitacion_medicacion_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.habilitacion_medicacion_explicacion}</p>
      {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}
      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && filas.length === 0} recargar={recargar} mensajeVacio={t.configuracion.habilitacion_medicacion_vacio}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.habilitacion_medicacion_col_via}</th>
              <th>{t.configuracion.habilitacion_medicacion_col_tipo}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filas.map((fila) => (
              <tr key={fila.id}>
                <td>{fila.via_administracion}</td>
                <td>
                  <input
                    type="text"
                    value={fila.tipo_habilitacion_requerida || ''}
                    placeholder={t.configuracion.habilitacion_medicacion_sin_requisito}
                    onChange={(e) => set(fila.id, e.target.value)}
                  />
                </td>
                <td>
                  <button onClick={() => guardar(fila)} disabled={guardandoId === fila.id}>
                    {guardandoId === fila.id ? t.comun.guardando : t.comun.guardar}
                  </button>{' '}
                  <button onClick={() => borrar(fila)} disabled={guardandoId === fila.id}>{t.comun.borrar}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      <h2 style={{ marginTop: '1.5rem' }}>{t.configuracion.habilitacion_medicacion_nueva}</h2>
      <FormField
        label={t.configuracion.habilitacion_medicacion_col_via}
        name="nueva_via"
        value={nuevaVia}
        onChange={(e) => setNuevaVia(e.target.value)}
        placeholder={t.configuracion.habilitacion_medicacion_via_placeholder}
      />
      <FormField
        label={t.configuracion.habilitacion_medicacion_col_tipo}
        name="nuevo_tipo"
        value={nuevoTipo}
        onChange={(e) => setNuevoTipo(e.target.value)}
        placeholder={t.configuracion.habilitacion_medicacion_sin_requisito}
      />
      <Button onClick={agregar} disabled={agregando || !nuevaVia}>
        {agregando ? t.comun.guardando : t.configuracion.habilitacion_medicacion_agregar}
      </Button>
    </div>
  );
}

function TabNotificaciones() {
  const { t } = useLocale();
  const [notificaciones, setNotificaciones] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardandoEvento, setGuardandoEvento] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { notificaciones: filas } = await llamarApi('/notificaciones');
      setNotificaciones(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function set(evento, campo, valor) {
    setNotificaciones((filas) => filas.map((f) => (f.evento === evento ? { ...f, [campo]: valor } : f)));
  }

  async function guardar(fila) {
    setGuardandoEvento(fila.evento);
    setError(null);
    try {
      await llamarApi(`/notificaciones/${fila.evento}`, {
        method: 'PATCH',
        body: JSON.stringify({ emails: fila.emails, activo: fila.activo, whatsapp_activo: fila.whatsapp_activo, notificar_familia: fila.notificar_familia }),
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardandoEvento(null);
    }
  }

  return (
    <>
      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && notificaciones.length === 0} recargar={recargar}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.notificaciones_col_evento}</th>
              <th>{t.configuracion.notificaciones_col_emails}</th>
              <th>{t.configuracion.notificaciones_col_activo}</th>
              <th>{t.configuracion.notificaciones_col_whatsapp_activo}</th>
              <th>{t.configuracion.notificaciones_col_notificar_familia}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {notificaciones.map((fila) => (
              <tr key={fila.evento}>
                <td>{t.configuracion[`notificaciones_evento_${fila.evento}`] || fila.descripcion}</td>
                <td>
                  <input
                    type="text"
                    placeholder={t.configuracion.notificaciones_emails_placeholder}
                    value={(fila.emails || []).join(', ')}
                    onChange={(e) => set(fila.evento, 'emails', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
                  />
                </td>
                <td>
                  <input type="checkbox" checked={fila.activo} onChange={(e) => set(fila.evento, 'activo', e.target.checked)} />
                </td>
                <td>
                  <input type="checkbox" checked={fila.whatsapp_activo || false} onChange={(e) => set(fila.evento, 'whatsapp_activo', e.target.checked)} />
                </td>
                <td>
                  {fila.evento === 'incidente_relevo_sin_resolver' && (
                    <input
                      type="checkbox"
                      checked={fila.notificar_familia || false}
                      title={t.configuracion.notificaciones_notificar_familia_ayuda}
                      onChange={(e) => set(fila.evento, 'notificar_familia', e.target.checked)}
                    />
                  )}
                </td>
                <td>
                  <button onClick={() => guardar(fila)} disabled={guardandoEvento === fila.evento}>
                    {guardandoEvento === fila.evento ? t.comun.guardando : t.comun.guardar}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>
      <TabAvisoCese />
      <TabEmailRemitente />
    </>
  );
}

function TabEmailRemitente() {
  const { t } = useLocale();
  const [form, setForm] = useState(null);
  const [password, setPassword] = useState('');
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { emailRemitente } = await llamarApi('/email-remitente');
      setForm(emailRemitente);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function set(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setGuardado(false);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/email-remitente', {
        method: 'PATCH',
        body: JSON.stringify({
          activo: form.activo,
          direccion_remitente: form.direccion_remitente,
          usuario_smtp: form.usuario_smtp,
          host: form.host,
          puerto: form.puerto,
          password: password || undefined,
        }),
      });
      setPassword('');
      setGuardado(true);
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.email_remitente_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.email_remitente_explicacion}</p>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        {form && (
          <div>
            {error && <Alert variant="error">{error}</Alert>}
            {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
            <FormField
              label={t.configuracion.email_remitente_activo}
              name="activo"
              type="checkbox"
              checked={form.activo || false}
              onChange={(e) => set('activo', e.target.checked)}
            />
            <FormField label={t.configuracion.email_remitente_direccion} name="direccion_remitente" value={form.direccion_remitente || ''} onChange={(e) => set('direccion_remitente', e.target.value)} />
            <FormField label={t.configuracion.email_remitente_usuario_smtp} name="usuario_smtp" value={form.usuario_smtp || ''} onChange={(e) => set('usuario_smtp', e.target.value)} />
            <FormField label={t.configuracion.email_remitente_host} name="host" value={form.host || ''} onChange={(e) => set('host', e.target.value)} />
            <FormField label={t.configuracion.email_remitente_puerto} name="puerto" type="number" value={form.puerto || ''} onChange={(e) => set('puerto', Number(e.target.value))} />
            <FormField
              label={form.credencial_cargada ? t.configuracion.email_remitente_password_reemplazar : t.configuracion.email_remitente_password_cargar}
              name="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            <Button onClick={guardar} disabled={guardando}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
          </div>
        )}
      </EstadoLista>
    </div>
  );
}

function TabAvisoCese() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const [config, setConfig] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from('configuracion_aviso_cese_asistente')
      .select('*')
      .eq('prestadora_id', usuario.prestadora_id)
      .maybeSingle();
    if (errorConsulta) {
      setError(errorConsulta.message);
      setEstado('error');
      return;
    }
    setConfig(data ?? { activo: true, horas_plazo_aviso_verbal: 24 });
    setEstado('listo');
  }, [usuario.prestadora_id]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function guardar() {
    setGuardando(true);
    setError(null);
    const { error: errorUpsert } = await supabase.from('configuracion_aviso_cese_asistente').upsert({
      prestadora_id: usuario.prestadora_id,
      activo: config.activo,
      horas_plazo_aviso_verbal: Number(config.horas_plazo_aviso_verbal),
    });
    setGuardando(false);
    if (errorUpsert) {
      setError(errorUpsert.message);
      return;
    }
    recargar();
  }

  return (
    <div>
      <h2>{t.configuracion.aviso_cese_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.aviso_cese_explicacion}</p>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        {config && (
          <div>
            {error && <Alert variant="error">{error}</Alert>}
            <FormField
              label={t.configuracion.aviso_cese_activo}
              name="aviso_cese_activo"
              type="checkbox"
              checked={config.activo}
              onChange={(e) => setConfig((c) => ({ ...c, activo: e.target.checked }))}
            />
            <FormField
              label={t.configuracion.aviso_cese_horas_plazo}
              name="aviso_cese_horas_plazo"
              type="number"
              value={config.horas_plazo_aviso_verbal}
              onChange={(e) => setConfig((c) => ({ ...c, horas_plazo_aviso_verbal: e.target.value }))}
            />
            <Button onClick={guardar} disabled={guardando}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
          </div>
        )}
      </EstadoLista>
    </div>
  );
}

const CATEGORIAS_PLANTILLA = ['utility', 'marketing', 'authentication'];

function TabWhatsapp() {
  return (
    <div>
      <TabWhatsappCredenciales />
      <TabWhatsappPlantillas />
      <TabWhatsappEscaladaCoordinador />
    </div>
  );
}

function TabWhatsappCredenciales() {
  const { t } = useLocale();
  const [form, setForm] = useState(null);
  const [token, setToken] = useState('');
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { whatsapp } = await llamarApi('/whatsapp');
      setForm(whatsapp);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function set(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setGuardado(false);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/whatsapp', {
        method: 'PATCH',
        body: JSON.stringify({
          activo: form.activo,
          numero_telefono: form.numero_telefono,
          waba_id: form.waba_id,
          phone_number_id: form.phone_number_id,
          token: token || undefined,
        }),
      });
      setToken('');
      setGuardado(true);
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.whatsapp_credenciales_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.whatsapp_credenciales_explicacion}</p>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        {form && (
          <div>
            {error && <Alert variant="error">{error}</Alert>}
            {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
            <FormField
              label={t.configuracion.whatsapp_activo}
              name="activo"
              type="checkbox"
              checked={form.activo || false}
              onChange={(e) => set('activo', e.target.checked)}
            />
            <FormField label={t.configuracion.whatsapp_numero} name="numero_telefono" value={form.numero_telefono || ''} onChange={(e) => set('numero_telefono', e.target.value)} />
            <FormField label={t.configuracion.whatsapp_waba_id} name="waba_id" value={form.waba_id || ''} onChange={(e) => set('waba_id', e.target.value)} />
            <FormField label={t.configuracion.whatsapp_phone_number_id} name="phone_number_id" value={form.phone_number_id || ''} onChange={(e) => set('phone_number_id', e.target.value)} />
            <FormField
              label={form.token_cargado ? t.configuracion.whatsapp_token_reemplazar : t.configuracion.whatsapp_token_cargar}
              name="token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <Button onClick={guardar} disabled={guardando}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
          </div>
        )}
      </EstadoLista>
    </div>
  );
}

function TabWhatsappPlantillas() {
  const { t } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();
  const [plantillas, setPlantillas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [creandoNueva, setCreandoNueva] = useState(false);
  const [actualizandoId, setActualizandoId] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { plantillas: filas } = await llamarApi('/whatsapp/plantillas');
      setPlantillas(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function marcarEnviadaMeta(fila) {
    setActualizandoId(fila.id);
    try {
      await llamarApi(`/whatsapp/plantillas/${fila.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ estado: 'enviada_meta' }),
      });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoId(null);
    }
  }

  async function borrar(fila) {
    if (!(await confirmarDestructivo(t.configuracion.whatsapp_plantillas_confirmar_borrar))) return;
    setActualizandoId(fila.id);
    try {
      await llamarApi(`/whatsapp/plantillas/${fila.id}`, { method: 'DELETE' });
      recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setActualizandoId(null);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.whatsapp_plantillas_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.whatsapp_plantillas_explicacion}</p>
      {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}
      <div className="panel-filtros">
        <Button onClick={() => setCreandoNueva(true)}>{t.configuracion.whatsapp_plantillas_nueva}</Button>
      </div>
      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && plantillas.length === 0}
        recargar={recargar}
        mensajeVacio={t.configuracion.whatsapp_plantillas_vacio}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.whatsapp_plantillas_col_nombre}</th>
              <th>{t.configuracion.whatsapp_plantillas_col_categoria}</th>
              <th>{t.configuracion.whatsapp_plantillas_col_estado}</th>
              <th>{t.configuracion.whatsapp_plantillas_col_cuerpo}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {plantillas.map((p) => (
              <tr key={p.id}>
                <td>{p.nombre_interno}</td>
                <td>{traducirValor(t.configuracion, `whatsapp_plantillas_categoria_${p.categoria}`)}</td>
                <td>{traducirValor(t.configuracion, `whatsapp_plantillas_estado_${p.estado}`)}</td>
                <td>{p.cuerpo_texto}</td>
                <td>
                  {p.estado === 'borrador' && (
                    <button onClick={() => marcarEnviadaMeta(p)} disabled={actualizandoId === p.id}>
                      {t.configuracion.whatsapp_plantillas_enviar_meta}
                    </button>
                  )}
                  <button onClick={() => borrar(p)} disabled={actualizandoId === p.id}>{t.comun.borrar}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {creandoNueva && (
        <NuevaPlantillaWhatsapp onClose={() => setCreandoNueva(false)} onCreada={() => { setCreandoNueva(false); recargar(); }} />
      )}
    </div>
  );
}

function NuevaPlantillaWhatsapp({ onClose, onCreada }) {
  const { t } = useLocale();
  const [nombreInterno, setNombreInterno] = useState('');
  const [categoria, setCategoria] = useState('utility');
  const [cuerpoTexto, setCuerpoTexto] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  async function handleGuardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/whatsapp/plantillas', {
        method: 'POST',
        body: JSON.stringify({ nombre_interno: nombreInterno, categoria, cuerpo_texto: cuerpoTexto }),
      });
      onCreada();
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.configuracion.whatsapp_plantillas_nueva}</h2>
        {error && <Alert variant="error">{error}</Alert>}
        <FormField label={t.configuracion.whatsapp_plantillas_col_nombre} name="nombre_interno" value={nombreInterno} onChange={(e) => setNombreInterno(e.target.value)} required />
        <FormField label={t.configuracion.whatsapp_plantillas_col_categoria} name="categoria" type="select" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          {CATEGORIAS_PLANTILLA.map((c) => (
            <option key={c} value={c}>{traducirValor(t.configuracion, `whatsapp_plantillas_categoria_${c}`)}</option>
          ))}
        </FormField>
        <FormField label={t.configuracion.whatsapp_plantillas_col_cuerpo} name="cuerpo_texto" type="textarea" value={cuerpoTexto} onChange={(e) => setCuerpoTexto(e.target.value)} required />
        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>{t.comun.cancelar}</Button>
          <Button onClick={handleGuardar} disabled={guardando || !nombreInterno || !cuerpoTexto}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}

function TabWhatsappEscaladaCoordinador() {
  const { t } = useLocale();
  const [form, setForm] = useState(null);
  const [coordinadores, setCoordinadores] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [guardado, setGuardado] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const [{ escalada }, { data: usuariosData, error: errorUsuarios }] = await Promise.all([
        llamarApi('/escalada-coordinador'),
        supabase.from('usuarios').select('id, nombre').eq('rol', 'coordinador').order('nombre'),
      ]);
      if (errorUsuarios) throw errorUsuarios;
      setForm(escalada);
      setCoordinadores(usuariosData ?? []);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function set(campo, valor) {
    setForm((f) => ({ ...f, [campo]: valor }));
    setGuardado(false);
  }

  async function guardar() {
    setGuardando(true);
    setError(null);
    try {
      await llamarApi('/escalada-coordinador', {
        method: 'PATCH',
        body: JSON.stringify({
          coordinador_backup_id: form.coordinador_backup_id || null,
          minutos_antes_backup: Number(form.minutos_antes_backup),
          umbrales_premura: form.umbrales_premura,
          fase_automatica_activa: form.fase_automatica_activa,
          minutos_antes_fase_automatica: Number(form.minutos_antes_fase_automatica),
        }),
      });
      setGuardado(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.whatsapp_escalada_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.whatsapp_escalada_explicacion}</p>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        {form && (
          <div>
            {error && <Alert variant="error">{error}</Alert>}
            {guardado && <Alert variant="info">{t.comun.guardar} <span aria-hidden="true">✓</span></Alert>}
            <FormField
              label={t.configuracion.whatsapp_escalada_backup}
              name="coordinador_backup_id"
              type="select"
              value={form.coordinador_backup_id || ''}
              onChange={(e) => set('coordinador_backup_id', e.target.value)}
            >
              <option value="">{t.configuracion.escalada_prioridad_vacio}</option>
              {coordinadores.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </FormField>
            <FormField
              label={t.configuracion.whatsapp_escalada_minutos_backup}
              name="minutos_antes_backup"
              type="number"
              value={form.minutos_antes_backup ?? ''}
              onChange={(e) => set('minutos_antes_backup', e.target.value)}
            />
            <FormField
              label={t.configuracion.whatsapp_escalada_fase_automatica}
              name="fase_automatica_activa"
              type="checkbox"
              checked={form.fase_automatica_activa || false}
              onChange={(e) => set('fase_automatica_activa', e.target.checked)}
            />
            <FormField
              label={t.configuracion.whatsapp_escalada_minutos_fase_automatica}
              name="minutos_antes_fase_automatica"
              type="number"
              value={form.minutos_antes_fase_automatica ?? ''}
              onChange={(e) => set('minutos_antes_fase_automatica', e.target.value)}
            />
            <Button onClick={guardar} disabled={guardando}>{guardando ? t.comun.guardando : t.comun.guardar}</Button>
          </div>
        )}
      </EstadoLista>
    </div>
  );
}

const PROVEEDORES_SIN_CREDENCIAL = ['efectivo_manual'];

function TabPasarela() {
  const { t } = useLocale();
  const [pasarelas, setPasarelas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [proveedorAbierto, setProveedorAbierto] = useState(null);
  const [credencial, setCredencial] = useState('');
  const [accionEnCurso, setAccionEnCurso] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      const { pasarelas: filas } = await llamarApiMarketplace('/pasarela');
      setPasarelas(filas);
      setEstado('listo');
    } catch (err) {
      setError(err.message);
      setEstado('error');
    }
  }, []);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function activar(proveedor) {
    setAccionEnCurso(proveedor);
    setError(null);
    try {
      const requiereCredencial = !PROVEEDORES_SIN_CREDENCIAL.includes(proveedor);
      await llamarApiMarketplace(`/pasarela/${proveedor}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo: true, credencial: requiereCredencial ? credencial || undefined : undefined }),
      });
      setCredencial('');
      setProveedorAbierto(null);
      await recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setAccionEnCurso(null);
    }
  }

  async function desactivar(proveedor) {
    setAccionEnCurso(proveedor);
    setError(null);
    try {
      await llamarApiMarketplace(`/pasarela/${proveedor}`, {
        method: 'PATCH',
        body: JSON.stringify({ activo: false }),
      });
      await recargar();
    } catch (err) {
      setError(err.message);
    } finally {
      setAccionEnCurso(null);
    }
  }

  return (
    <div>
      <h2>{t.configuracion.pasarela_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.pasarela_explicacion}</p>
      <EstadoLista estado={estado} error={error} vacio={pasarelas.length === 0} recargar={recargar}>
        {error && <Alert variant="error">{error}</Alert>}
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.pasarela_col_proveedor}</th>
              <th>{t.configuracion.pasarela_col_estado}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {pasarelas.map((fila) => {
              const requiereCredencial = !PROVEEDORES_SIN_CREDENCIAL.includes(fila.proveedor);
              const abierta = proveedorAbierto === fila.proveedor;
              return (
                <Fragment key={fila.proveedor}>
                  <tr>
                    <td>{t.configuracion[`pasarela_${fila.proveedor}`]}</td>
                    <td>{fila.activo ? t.configuracion.pasarela_activa : t.configuracion.pasarela_inactiva}</td>
                    <td>
                      {fila.activo ? (
                        <Button
                          variant="secondary"
                          onClick={() => desactivar(fila.proveedor)}
                          disabled={accionEnCurso === fila.proveedor}
                        >
                          {accionEnCurso === fila.proveedor ? t.configuracion.pasarela_desactivando : t.configuracion.pasarela_desactivar}
                        </Button>
                      ) : (
                        <Button
                          onClick={() => {
                            if (!requiereCredencial) {
                              activar(fila.proveedor);
                            } else {
                              setProveedorAbierto(abierta ? null : fila.proveedor);
                              setCredencial('');
                            }
                          }}
                          disabled={accionEnCurso === fila.proveedor}
                        >
                          {t.configuracion.pasarela_activar}
                        </Button>
                      )}
                    </td>
                  </tr>
                  {abierta && requiereCredencial && !fila.activo && (
                    <tr>
                      <td colSpan={3}>
                        <FormField
                          label={t.configuracion.pasarela_credencial_cargar}
                          name={`credencial-${fila.proveedor}`}
                          type="password"
                          value={credencial}
                          onChange={(e) => setCredencial(e.target.value)}
                        />
                        <Button onClick={() => activar(fila.proveedor)} disabled={accionEnCurso === fila.proveedor}>
                          {accionEnCurso === fila.proveedor ? t.comun.guardando : t.comun.guardar}
                        </Button>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </EstadoLista>
    </div>
  );
}
