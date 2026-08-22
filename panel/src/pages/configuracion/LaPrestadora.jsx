import { Fragment, useCallback, useEffect, useState } from 'react';
import { con } from '../../lib/textos';
import { useLocale } from '../../i18n/LocaleContext';
import { useModalidades } from '../../context/ModalidadesContext';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { supabase } from '../../lib/supabaseClient';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { useModalAccesible } from '../../hooks/useModalAccesible';

const API_URL = import.meta.env.VITE_API_URL;

/* Quién es la Prestadora y cómo trabaja: su nombre y sus datos, las modalidades
   que tiene contratadas, las zonas donde presta y —si vende por marketplace— por
   dónde cobra. */
export function ConfiguracionPrestadora() {
  const { t } = useLocale();
  const { tieneModalidad } = useModalidades();

  return (
    <>
      <h2>{t.configuracion.tab_empresa}</h2>
      <TabEmpresa />
      <TabModalidades />
      <h2>{t.configuracion.tab_zonas}</h2>
      <TabZonas />
      {tieneModalidad('marketplace') && <TabPasarela />}
    </>
  );
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

const PROVEEDORES_SIN_CREDENCIAL = ['efectivo_manual'];

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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

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
      setError(mensajeDeError(err, t));
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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

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
      setError(mensajeDeError(err, t));
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
                    aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.modalidades_col_activa, nombre: t.configuracion[`modalidades_${fila.modalidad}`] })}
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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

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
      setError(mensajeDeError(err, t));
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
      setError(mensajeDeError(err, t));
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
                  <input
                    type="checkbox"
                    checked={z.activa}
                    onChange={() => toggleActiva(z)}
                    disabled={actualizandoZona === z.id}
                    aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.zonas_col_activa, nombre: z.nombre })}
                  />
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
  const modal = useModalAccesible(onClose);
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
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.configuracion.zonas_nueva}</h2>
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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

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
      setError(mensajeDeError(err, t));
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
      setError(mensajeDeError(err, t));
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
