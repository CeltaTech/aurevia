import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useAuth } from '../../context/AuthContext';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { supabase } from '../../lib/supabaseClient';
import { llamarApiConfiguracion } from '../../lib/apiConfiguracion';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { esTipoGeneral, nombreTipo, nombreMatricula, viasVedadasPorMatricula } from '../../lib/tiposAsistente';
import { mensajeDeError } from '../../lib/errores';

/* Los tipos de Asistente y sus tareas.
   Tres cosas conviven en esta pantalla y conviene no confundirlas:

     Tipo      → qué ES el Asistente (cuidador/a, enfermero/a…)
     Tareas    → qué HACE y qué NO HACE
     Matrícula → qué lo AUTORIZA a ejercer

   Los cuatro tipos de fábrica los trae CeltaTech: la Prestadora no los puede
   renombrar ni cambiarles la exigencia de matrícula, pero sí puede agregarles
   tareas propias. Los tipos que crea ella son suyos por completo. */
export function TiposAsistenteTab() {
  const { t } = useLocale();
  const { usuario } = useAuth();
  const confirmarDestructivo = useConfirmarDestructivo();
  const [tipos, setTipos] = useState([]);
  const [vias, setVias] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [creando, setCreando] = useState(false);
  const [ocupadoId, setOcupadoId] = useState(null);
  const [tipoAbierto, setTipoAbierto] = useState(null);
  const [modoControl, setModoControl] = useState('flexible');
  const [guardandoModo, setGuardandoModo] = useState(false);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    const [resTipos, resVias, resModo] = await Promise.all([
      supabase.from('tipos_asistente').select('*').order('orden'),
      supabase
        .from('configuracion_matricula_via_medicacion')
        .select('via_administracion, tipo_matricula_requerida')
        .eq('prestadora_id', usuario.prestadora_id),
      llamarApiConfiguracion('/modo-control-matricula').catch(() => null),
    ]);
    if (resTipos.error || resVias.error) {
      setError(mensajeDeError(resTipos.error || resVias.error, t));
      setEstado('error');
      return;
    }
    setTipos(resTipos.data ?? []);
    setVias(resVias.data ?? []);
    setModoControl(resModo?.modo ?? 'flexible');
    setEstado('listo');
  }, [usuario.prestadora_id, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  /* El interruptor vive acá y no en otra solapa porque la exigencia de matrícula la declara cada
     tipo de Asistente, y esto es lo que decide qué tan estricta es esa exigencia. Separarlas
     obligaría a ir y volver entre dos pantallas para entender una sola regla. */
  async function cambiarModo(nuevo) {
    setGuardandoModo(true);
    setError(null);
    try {
      await llamarApiConfiguracion('/modo-control-matricula', {
        method: 'PATCH',
        body: JSON.stringify({ modo: nuevo }),
      });
      setModoControl(nuevo);
    } catch {
      setError(t.comun.error_generico);
    } finally {
      setGuardandoModo(false);
    }
  }

  async function alternarActivo(tipo) {
    setOcupadoId(tipo.id);
    setError(null);
    const { error: errorUpdate } = await supabase
      .from('tipos_asistente')
      .update({ activo: !tipo.activo, updated_at: new Date().toISOString() })
      .eq('id', tipo.id);
    setOcupadoId(null);
    if (errorUpdate) {
      setError(t.comun.error_generico);
      return;
    }
    recargar();
  }

  async function borrar(tipo) {
    if (!(await confirmarDestructivo(t.configuracion.tipos_confirmar_borrar))) return;
    setOcupadoId(tipo.id);
    setError(null);
    const { error: errorDelete } = await supabase.from('tipos_asistente').delete().eq('id', tipo.id);
    setOcupadoId(null);
    if (errorDelete) {
      setError(t.comun.error_generico);
      return;
    }
    if (tipoAbierto === tipo.id) setTipoAbierto(null);
    recargar();
  }

  return (
    <div>
      <h2>{t.configuracion.tipos_titulo}</h2>
      <p className="panel-explicacion">{t.configuracion.tipos_explicacion}</p>
      {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}

      {estado === 'listo' && (
        <div className="panel-detalle">
          <h3>{t.matricula.modo_titulo}</h3>
          <p className="panel-explicacion">{t.matricula.modo_explicacion}</p>
          <select
            id="modo_control_matricula"
            aria-label={t.matricula.modo_titulo}
            value={modoControl}
            disabled={guardandoModo}
            onChange={(e) => cambiarModo(e.target.value)}
          >
            {['flexible', 'estricto'].map((opcion) => (
              <option key={opcion} value={opcion}>
                {t.matricula[`modo_${opcion}`]}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="panel-filtros">
        <Button onClick={() => setCreando(true)}>{t.configuracion.tipos_nuevo}</Button>
      </div>

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && tipos.length === 0}
        recargar={recargar}
        mensajeVacio={t.configuracion.tipos_vacio}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.configuracion.tipos_col_nombre}</th>
              <th>{t.configuracion.tipos_col_origen}</th>
              <th>{t.configuracion.tipos_col_matricula}</th>
              <th>{t.configuracion.tipos_col_activo}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tipos.map((tipo) => (
              <tr key={tipo.id}>
                <td>
                  {nombreTipo(tipo, t)}
                  {tipo.descripcion && <div className="panel-explicacion">{tipo.descripcion}</div>}
                </td>
                <td>
                  {esTipoGeneral(tipo)
                    ? t.configuracion.tipos_origen_celtatech
                    : t.configuracion.tipos_origen_propia}
                </td>
                <td>
                  {tipo.requiere_matricula
                    ? nombreMatricula(tipo.tipo_matricula, t)
                    : t.configuracion.tipos_sin_matricula}
                </td>
                <td>
                  {esTipoGeneral(tipo) ? (
                    '—'
                  ) : (
                    <input
                      type="checkbox"
                      checked={tipo.activo}
                      onChange={() => alternarActivo(tipo)}
                      disabled={ocupadoId === tipo.id}
                    />
                  )}
                </td>
                <td>
                  <button onClick={() => setTipoAbierto(tipoAbierto === tipo.id ? null : tipo.id)}>
                    {tipoAbierto === tipo.id
                      ? t.configuracion.tipos_ocultar_tareas
                      : t.configuracion.tipos_ver_tareas}
                  </button>{' '}
                  {!esTipoGeneral(tipo) && (
                    <button onClick={() => borrar(tipo)} disabled={ocupadoId === tipo.id}>
                      {t.comun.borrar}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {tipoAbierto && (
        <TareasDelTipo
          tipo={tipos.find((x) => x.id === tipoAbierto)}
          vias={vias}
          prestadoraId={usuario.prestadora_id}
        />
      )}

      {creando && (
        <NuevoTipoModal
          prestadoraId={usuario.prestadora_id}
          onClose={() => setCreando(false)}
          onCreado={() => {
            setCreando(false);
            recargar();
          }}
        />
      )}
    </div>
  );
}

/* Las dos listas de tareas de un tipo. Son dos y no una a propósito: la de "no
   corresponde" es la que evita que la Familia le pida al Asistente cosas que no
   son suyas, y si va mezclada con la otra se lee y no se entiende cuál era cuál. */
function TareasDelTipo({ tipo, vias, prestadoraId }) {
  const { t } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();
  const [tareas, setTareas] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [ocupadoId, setOcupadoId] = useState(null);

  const recargar = useCallback(async () => {
    if (!tipo) return;
    setEstado('cargando');
    setError(null);
    const { data, error: errorConsulta } = await supabase
      .from('tareas_tipo_asistente')
      .select('*')
      .eq('tipo_asistente_id', tipo.id)
      .order('orden');
    if (errorConsulta) {
      setError(mensajeDeError(errorConsulta, t));
      setEstado('error');
      return;
    }
    setTareas(data ?? []);
    setEstado('listo');
  }, [tipo, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  async function borrar(tarea) {
    if (!(await confirmarDestructivo(t.configuracion.tareas_confirmar_borrar))) return;
    setOcupadoId(tarea.id);
    setError(null);
    const { error: errorDelete } = await supabase.from('tareas_tipo_asistente').delete().eq('id', tarea.id);
    setOcupadoId(null);
    if (errorDelete) {
      setError(t.comun.error_generico);
      return;
    }
    recargar();
  }

  if (!tipo) return null;

  const vedadas = viasVedadasPorMatricula(tipo, vias);

  return (
    <div className="panel-tab-contenido" style={{ marginTop: '1.5rem' }}>
      <h2>{t.configuracion.tareas_titulo} · {nombreTipo(tipo, t)}</h2>
      <p className="panel-explicacion">{t.configuracion.tareas_explicacion}</p>
      {estado === 'listo' && error && <Alert variant="error">{error}</Alert>}

      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        <ListaDeClase
          clase="corresponde"
          titulo={t.configuracion.tareas_corresponde}
          vacio={t.configuracion.tareas_vacio_corresponde}
          tareas={tareas.filter((x) => x.clase === 'corresponde')}
          tipo={tipo}
          prestadoraId={prestadoraId}
          ocupadoId={ocupadoId}
          onBorrar={borrar}
          onCambio={recargar}
        />
        <ListaDeClase
          clase="no_corresponde"
          titulo={t.configuracion.tareas_no_corresponde}
          vacio={t.configuracion.tareas_vacio_no_corresponde}
          tareas={tareas.filter((x) => x.clase === 'no_corresponde')}
          tipo={tipo}
          prestadoraId={prestadoraId}
          ocupadoId={ocupadoId}
          onBorrar={borrar}
          onCambio={recargar}
        />
      </EstadoLista>

      <h3 style={{ marginTop: '1.5rem' }}>{t.configuracion.tareas_vedadas_titulo}</h3>
      <p className="panel-explicacion">{t.configuracion.tareas_vedadas_explicacion}</p>
      {vedadas.length === 0 ? (
        <p className="panel-explicacion">{t.configuracion.tareas_vedadas_ninguna}</p>
      ) : (
        <ul>
          {vedadas.map((via) => (
            <li key={via}>{via}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ListaDeClase({ clase, titulo, vacio, tareas, tipo, prestadoraId, ocupadoId, onBorrar, onCambio }) {
  const { t } = useLocale();
  const [texto, setTexto] = useState('');
  const [agregando, setAgregando] = useState(false);
  const [error, setError] = useState(null);

  async function agregar() {
    setAgregando(true);
    setError(null);
    const { error: errorInsert } = await supabase.from('tareas_tipo_asistente').insert({
      tipo_asistente_id: tipo.id,
      prestadora_id: prestadoraId,
      clase,
      texto: texto.trim(),
      orden: (tareas.length + 1) * 10,
    });
    setAgregando(false);
    if (errorInsert) {
      setError(t.comun.error_generico);
      return;
    }
    setTexto('');
    onCambio();
  }

  return (
    <div style={{ marginTop: '1rem' }}>
      <h3>{titulo}</h3>
      {error && <Alert variant="error">{error}</Alert>}
      {tareas.length === 0 ? (
        <p className="panel-explicacion">{vacio}</p>
      ) : (
        <ul>
          {tareas.map((tarea) => (
            <li key={tarea.id}>
              {tarea.texto || tarea.clave}
              {!tarea.prestadora_id ? (
                <> · {t.configuracion.tipos_origen_celtatech}</>
              ) : (
                <>
                  {' '}
                  <button onClick={() => onBorrar(tarea)} disabled={ocupadoId === tarea.id}>
                    {t.comun.borrar}
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <FormField
        label={t.configuracion.tareas_agregar}
        name={`nueva_tarea_${clase}`}
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder={t.configuracion.tareas_nueva_placeholder}
      />
      <Button onClick={agregar} disabled={agregando || !texto.trim()}>
        {agregando ? t.comun.guardando : t.configuracion.tareas_agregar}
      </Button>
    </div>
  );
}

function NuevoTipoModal({ prestadoraId, onClose, onCreado }) {
  const { t } = useLocale();
  const [nombre, setNombre] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [requiereMatricula, setRequiereMatricula] = useState(false);
  const [tipoMatricula, setTipoMatricula] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);

  // La base no acepta "pide matrícula pero no sabemos de cuál": sin ese dato no
  // hay contra qué comparar y el Asistente quedaría bloqueado sin salida.
  const faltaAlgo = !nombre.trim() || (requiereMatricula && !tipoMatricula.trim());

  async function guardar() {
    setGuardando(true);
    setError(null);
    const { error: errorInsert } = await supabase.from('tipos_asistente').insert({
      prestadora_id: prestadoraId,
      nombre: nombre.trim(),
      descripcion: descripcion.trim() || null,
      requiere_matricula: requiereMatricula,
      tipo_matricula: requiereMatricula ? tipoMatricula.trim() : null,
    });
    setGuardando(false);
    if (errorInsert) {
      setError(t.comun.error_generico);
      return;
    }
    onCreado();
  }

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()}>
        <h2>{t.configuracion.tipos_nuevo}</h2>
        {error && <Alert variant="error">{error}</Alert>}
        <FormField
          label={t.configuracion.tipos_nombre_label}
          name="tipo_nombre"
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
          required
        />
        <FormField
          label={t.configuracion.tipos_descripcion_label}
          name="tipo_descripcion"
          type="textarea"
          value={descripcion}
          onChange={(e) => setDescripcion(e.target.value)}
        />
        <FormField
          label={t.configuracion.tipos_requiere_matricula_label}
          name="tipo_requiere_matricula"
          type="checkbox"
          checked={requiereMatricula}
          onChange={(e) => setRequiereMatricula(e.target.checked)}
        />
        {requiereMatricula && (
          <>
            <FormField
              label={t.configuracion.tipos_tipo_matricula_label}
              name="tipo_tipo_matricula"
              value={tipoMatricula}
              onChange={(e) => setTipoMatricula(e.target.value)}
              required
            />
            <p className="panel-explicacion">{t.configuracion.tipos_tipo_matricula_ayuda}</p>
          </>
        )}
        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose} disabled={guardando}>
            {t.comun.cancelar}
          </Button>
          <Button onClick={guardar} disabled={guardando || faltaAlgo}>
            {guardando ? t.comun.guardando : t.comun.guardar}
          </Button>
        </div>
      </div>
    </div>
  );
}
