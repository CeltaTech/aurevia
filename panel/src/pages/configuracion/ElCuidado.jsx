import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { supabase } from '../../lib/supabaseClient';
import { llamarApiConfiguracion as llamarApi } from '../../lib/apiConfiguracion';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import { con } from '../../lib/textos';
import { useModalAccesible } from '../../hooks/useModalAccesible';
import { usePrestadoraActual } from '../../hooks/usePrestadoraActual';

/* Las reglas del cuidado en sí: cómo se arman los Servicios y sus guardias, qué
   signos vitales se toman, y qué matrícula hace falta para cada vía de medicación. */
export function ConfiguracionCuidado() {
  return (
    <>
      <TabServicios />
      <TabVitales />
      <TabMatriculaMedicacion />
    </>
  );
}

const ROLES_RELEVO = ['suplente', 'franquero', 'emergencia', 'familiar'];

const TIPOS_PERSONAL_EMERGENCIA = ['franquero', 'emergencia'];

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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

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
      setError(mensajeDeError(err, t));
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
      setError(mensajeDeError(err, t));
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
      setError(mensajeDeError(err, t));
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
  const modal = useModalAccesible(() => setCreandoNuevo(false));
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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

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
      setError(mensajeDeError(err, t));
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
      setError(mensajeDeError(err, t));
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
                  <input
                    type="checkbox"
                    checked={m.activo}
                    onChange={() => toggleActivo(m)}
                    disabled={actualizandoId === m.id}
                    aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.documentos_tipos_col_activo, nombre: m.nombre })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {creandoNuevo && (
        <div className="panel-modal-fondo" onClick={() => setCreandoNuevo(false)}>
          <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
            <h2 id={modal.idTitulo}>{t.configuracion.motivos_aviso_previo_nuevo}</h2>
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
  const modal = useModalAccesible(() => setCreandoNueva(false));
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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

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
      setError(mensajeDeError(err, t));
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
      setError(mensajeDeError(err, t));
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
      setError(mensajeDeError(err, t));
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
                  {/* Las tres cosas de esta fila —la casilla y las dos flechas— dicen a qué
                      etapa se refieren: una fila de una tabla se lee sola, fuera del renglón,
                      y "activar" o "subir" sin el nombre al lado no dice nada. */}
                  <input
                    type="checkbox"
                    checked={e.activa}
                    onChange={() => toggleActiva(e)}
                    disabled={actualizandoId === e.id}
                    aria-label={con(t.comun.activo_de, { nombre: e.nombre })}
                  />
                </td>
                <td>
                  <button
                    onClick={() => mover(e, 'arriba')}
                    disabled={actualizandoId === e.id || i === 0}
                    aria-label={con(t.comun.subir, { nombre: e.nombre })}
                  >
                    <span aria-hidden="true">↑</span>
                  </button>
                  <button
                    onClick={() => mover(e, 'abajo')}
                    disabled={actualizandoId === e.id || i === etapas.length - 1}
                    aria-label={con(t.comun.bajar, { nombre: e.nombre })}
                  >
                    <span aria-hidden="true">↓</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {creandoNueva && (
        <div className="panel-modal-fondo" onClick={() => setCreandoNueva(false)}>
          <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
            <h2 id={modal.idTitulo}>{t.configuracion.etapas_incorporacion_nueva}</h2>
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
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [t]);

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
      setError(mensajeDeError(err, t));
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
      setError(mensajeDeError(err, t));
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
                  <input
                    type="checkbox"
                    checked={fila.activo}
                    onChange={() => toggleActivo(fila)}
                    disabled={actualizandoId === fila.id}
                    aria-label={con(t.comun.campo_de_fila, {
                      campo: t.configuracion.documentos_tipos_col_activo,
                      nombre: fila.asistentes?.nombre || t.configuracion[`personal_emergencia_tipo_${fila.tipo}`],
                    })}
                  />
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
  const modal = useModalAccesible(onClose);
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
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.configuracion.personal_emergencia_nuevo}</h2>
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
  const modal = useModalAccesible(onClose);
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
      setError(mensajeDeError(err, t));
    } finally {
      setGuardando(false);
    }
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.configuracion.escalada_nuevo_nivel}</h2>
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

function TabVitales() {
  const { t } = useLocale();
  const prestadoraId = usePrestadoraActual();
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
      .eq('prestadora_id', prestadoraId)
      .is('paciente_id', null)
      .order('signo');
    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }
    setRangos(data ?? []);
    setEstado('listo');
  }, [prestadoraId, t]);

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
      setError(mensajeDeError(errorUpdate, t));
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
            {rangos.map((fila) => {
              /* El nombre del signo se resuelve una sola vez porque lo usan la celda visible y
                 los cuatro campos, que fuera del renglón se leerían como "Mínimo" a secas. */
              const nombreSigno = t.configuracion[`vitales_signo_${fila.signo}`];
              return (
                <tr key={fila.signo}>
                  <td>{nombreSigno}</td>
                  <td><input type="number" step="0.1" value={fila.valor_min} onChange={(e) => set(fila.signo, 'valor_min', e.target.value)} aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.vitales_col_min, nombre: nombreSigno })} /></td>
                  <td><input type="number" step="0.1" value={fila.valor_max} onChange={(e) => set(fila.signo, 'valor_max', e.target.value)} aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.vitales_col_max, nombre: nombreSigno })} /></td>
                  <td><input type="text" value={fila.unidad} onChange={(e) => set(fila.signo, 'unidad', e.target.value)} aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.vitales_col_unidad, nombre: nombreSigno })} /></td>
                  <td><input type="text" value={fila.fuente} onChange={(e) => set(fila.signo, 'fuente', e.target.value)} aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.vitales_col_fuente, nombre: nombreSigno })} /></td>
                  <td>
                    <button onClick={() => guardar(fila)} disabled={guardandoSigno === fila.signo}>
                      {guardandoSigno === fila.signo ? t.comun.guardando : t.comun.guardar}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </EstadoLista>
    </div>
  );
}

function TabMatriculaMedicacion() {
  const { t } = useLocale();
  const prestadoraId = usePrestadoraActual();
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
      .from('configuracion_matricula_via_medicacion')
      .select('*')
      .eq('prestadora_id', prestadoraId)
      .order('via_administracion');
    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }
    setFilas(data ?? []);
    setEstado('listo');
  }, [prestadoraId, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function set(id, valor) {
    setFilas((fs) => fs.map((f) => (f.id === id ? { ...f, tipo_matricula_requerida: valor } : f)));
  }

  async function guardar(fila) {
    setGuardandoId(fila.id);
    setError(null);
    const { error: errorUpdate } = await supabase
      .from('configuracion_matricula_via_medicacion')
      .update({ tipo_matricula_requerida: fila.tipo_matricula_requerida || null, updated_at: new Date().toISOString() })
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
    const { error: errorInsert } = await supabase.from('configuracion_matricula_via_medicacion').insert({
      prestadora_id: prestadoraId,
      via_administracion: nuevaVia,
      tipo_matricula_requerida: nuevoTipo || null,
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
    if (!(await confirmarDestructivo(t.configuracion.matricula_medicacion_confirmar_borrar))) return;
    setGuardandoId(fila.id);
    setError(null);
    const { error: errorDelete } = await supabase.from('configuracion_matricula_via_medicacion').delete().eq('id', fila.id);
    setGuardandoId(null);
    if (errorDelete) {
      setError(t.comun.error_generico);
      return;
    }
    recargar();
  }

  return (
    <div>
      <h2>{t.configuracion.matricula_medicacion_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.matricula_medicacion_explicacion}</p>
      {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}
      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && filas.length === 0} recargar={recargar} mensajeVacio={t.configuracion.matricula_medicacion_vacio}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.matricula_medicacion_col_via}</th>
              <th>{t.configuracion.matricula_medicacion_col_tipo}</th>
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
                    value={fila.tipo_matricula_requerida || ''}
                    placeholder={t.configuracion.matricula_medicacion_sin_requisito}
                    onChange={(e) => set(fila.id, e.target.value)}
                    aria-label={con(t.comun.campo_de_fila, { campo: t.configuracion.matricula_medicacion_col_tipo, nombre: fila.via_administracion })}
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

      <h2 style={{ marginTop: '1.5rem' }}>{t.configuracion.matricula_medicacion_nueva}</h2>
      <FormField
        label={t.configuracion.matricula_medicacion_col_via}
        name="nueva_via"
        value={nuevaVia}
        onChange={(e) => setNuevaVia(e.target.value)}
        placeholder={t.configuracion.matricula_medicacion_via_placeholder}
      />
      <FormField
        label={t.configuracion.matricula_medicacion_col_tipo}
        name="nuevo_tipo"
        value={nuevoTipo}
        onChange={(e) => setNuevoTipo(e.target.value)}
        placeholder={t.configuracion.matricula_medicacion_sin_requisito}
      />
      <Button onClick={agregar} disabled={agregando || !nuevaVia}>
        {agregando ? t.comun.guardando : t.configuracion.matricula_medicacion_agregar}
      </Button>
    </div>
  );
}
