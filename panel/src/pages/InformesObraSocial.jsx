import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { usePermisos } from '../context/PermisosContext';
import { useConfirmarDestructivo } from '../context/TenantSessionContext';
import { supabase } from '../lib/supabaseClient';
import { Button } from '../components/ui/Button';
import { FormField } from '../components/ui/FormField';
import { Alert } from '../components/ui/Alert';
import { EstadoLista } from '../components/layout/EstadoLista';
import { traducirValor } from '../i18n/valores';
import { claseBadge } from '../lib/tonos';
import { con } from '../lib/textos';
import { mensajeDeError } from '../lib/errores';
import { useModalAccesible } from '../hooks/useModalAccesible';

const API_URL = import.meta.env.VITE_API_URL;

async function llamarApi(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/informes-obra-social${path}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${data.session?.access_token}`,
      'Content-Type': 'application/json',
      ...opciones.headers,
    },
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.error);
  return resultado;
}

function primerDiaDelMes(fechaISO) {
  return `${fechaISO.slice(0, 7)}-01`;
}

function ultimoDiaDelMes(fechaISO) {
  const [anio, mes] = fechaISO.slice(0, 7).split('-').map(Number);
  return new Date(anio, mes, 0).toISOString().slice(0, 10);
}

function mesActualISO() {
  return new Date().toISOString().slice(0, 10);
}

function ContenidoInforme({ contenido, t }) {
  const modalidades = Object.entries(contenido.totales_por_modalidad || {});
  // Los informes ya validados guardan una foto del contenido de ese momento. Las fotos
  // anteriores al reparto de horas no traen estos dos datos, y se siguen mostrando igual:
  // en aquel entonces una guardia cubría a un solo Paciente, así que no era compartida y las
  // horas imputadas eran las de la guardia entera.
  const hayGuardiaCompartida = (contenido.guardias || []).some((g) => (g.pacientes_en_el_turno || 1) > 1);
  return (
    <div className="informe-obra-social-contenido">
      <h3>{contenido.paciente.nombre}</h3>
      <p>
        {t.informesObraSocial.paciente_obra_social}: {contenido.paciente.obra_social || '—'}
        {' — '}
        {t.informesObraSocial.paciente_numero_afiliado}: {contenido.paciente.numero_afiliado || '—'}
      </p>
      <p>
        {t.informesObraSocial.col_periodo}: {contenido.periodo_desde} — {contenido.periodo_hasta}
      </p>

      <h4>{t.informesObraSocial.totales_titulo}</h4>
      {modalidades.length === 0 ? (
        <p className="estado-vacio">{t.informesObraSocial.sin_guardias}</p>
      ) : (
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.informesObraSocial.col_modalidad_total}</th>
              <th>{t.informesObraSocial.col_cantidad_guardias}</th>
              <th>{t.informesObraSocial.col_horas_totales}</th>
            </tr>
          </thead>
          <tbody>
            {modalidades.map(([modalidad, totales]) => (
              <tr key={modalidad}>
                <td>{modalidad}</td>
                <td>{totales.cantidad_guardias}</td>
                <td>{totales.horas_totales.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>{t.informesObraSocial.detalle_titulo}</h4>
      <div style={{ overflowX: 'auto' }}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.informesObraSocial.col_fecha}</th>
              <th>{t.informesObraSocial.col_hora_inicio}</th>
              <th>{t.informesObraSocial.col_hora_fin}</th>
              <th>{t.informesObraSocial.col_modalidad}</th>
              <th>{t.informesObraSocial.col_asistente}</th>
              <th>{t.informesObraSocial.col_estado}</th>
              {hayGuardiaCompartida && <th>{t.informesObraSocial.col_horas_imputadas}</th>}
            </tr>
          </thead>
          <tbody>
            {contenido.guardias.map((g, i) => {
              const enElTurno = g.pacientes_en_el_turno || 1;
              return (
                <tr key={i}>
                  <td>{g.fecha}</td>
                  <td>{g.hora_inicio}</td>
                  <td>{g.hora_fin}</td>
                  <td>{g.modalidad}</td>
                  <td>{g.asistente_nombre || '—'}</td>
                  <td>{traducirValor(t.guardias, `estado_${g.estado}`)}</td>
                  {hayGuardiaCompartida && (
                    <td>
                      {(g.horas_imputadas ?? 0).toFixed(1)}
                      {enElTurno > 1 && (
                        <span className="informe-obra-social-compartida">
                          {con(t.informesObraSocial.guardia_compartida, { n: enElTurno })}
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hayGuardiaCompartida && (
        <p className="informe-obra-social-nota">{t.informesObraSocial.nota_guardia_compartida}</p>
      )}

      <div className="informe-obra-social-firma">
        <div className="informe-obra-social-firma-linea" />
        <span>{t.informesObraSocial.firma_asistente_o_familia}</span>
      </div>
    </div>
  );
}

function AnularInformeModal({ onCerrar, onConfirmar, guardando, t }) {
  const modal = useModalAccesible(onCerrar);
  const [motivo, setMotivo] = useState('');
  const motivoValido = motivo.trim() !== '';

  function handleSubmit(e) {
    e.preventDefault();
    if (!motivoValido) return;
    onConfirmar(motivo.trim());
  }

  return (
    <div className="panel-modal-fondo" onClick={onCerrar}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.informesObraSocial.anular}</h2>
        <form onSubmit={handleSubmit}>
          <FormField
            label={t.informesObraSocial.motivo_anulacion}
            name="motivo_anulacion"
            type="textarea"
            required
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <div className="panel-modal-acciones">
            <Button type="button" variant="secondary" onClick={onCerrar} disabled={guardando}>{t.comun.cancelar}</Button>
            <Button type="submit" disabled={!motivoValido || guardando}>
              {guardando ? t.comun.guardando : t.informesObraSocial.anular}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function VistaImpresion({ informe, onCerrar, t }) {
  const modal = useModalAccesible(onCerrar, t.informesObraSocial.vista_impresion_titulo);
  return (
    <div className="panel-modal-fondo" onClick={onCerrar}>
      <div className="panel-modal informe-obra-social-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <div className="informe-obra-social-acciones-no-imprimir">
          <Button variant="secondary" onClick={onCerrar}>{t.comun.cerrar}</Button>
          <Button onClick={() => window.print()}>{t.informesObraSocial.imprimir}</Button>
        </div>
        <div id="area-imprimible">
          <ContenidoInforme contenido={informe.contenido} t={t} />
        </div>
      </div>
    </div>
  );
}

export function InformesObraSocial() {
  const { t } = useLocale();
  const { puede, cargado } = usePermisos();
  const confirmarDestructivo = useConfirmarDestructivo();

  const [pacientes, setPacientes] = useState([]);
  const [estadoPacientes, setEstadoPacientes] = useState('cargando');

  const [pacienteId, setPacienteId] = useState('');
  const [tipo, setTipo] = useState('resumen_mensual');
  const [periodoDesde, setPeriodoDesde] = useState(primerDiaDelMes(mesActualISO()));
  const [periodoHasta, setPeriodoHasta] = useState(ultimoDiaDelMes(mesActualISO()));

  const [preview, setPreview] = useState(null);
  const [cargandoPreview, setCargandoPreview] = useState(false);
  const [validando, setValidando] = useState(false);
  const [error, setError] = useState(null);
  const [avisoValidacion, setAvisoValidacion] = useState(null);

  const [historial, setHistorial] = useState([]);
  const [estadoHistorial, setEstadoHistorial] = useState('cargando');
  const [informeAbierto, setInformeAbierto] = useState(null);
  const [anulandoId, setAnulandoId] = useState(null);
  const [informeAAnular, setInformeAAnular] = useState(null);

  useEffect(() => {
    async function cargarPacientes() {
      setEstadoPacientes('cargando');
      const { data, error: errorConsulta } = await supabase
        .from('pacientes')
        .select('id, nombre, familia_id')
        .is('deleted_at', null)
        .order('nombre');
      if (errorConsulta) {
        setEstadoPacientes('error');
        return;
      }
      setPacientes(data ?? []);
      setEstadoPacientes('listo');
    }
    cargarPacientes();
  }, []);

  const recargarHistorial = useCallback(async () => {
    setEstadoHistorial('cargando');
    try {
      const params = new URLSearchParams();
      if (pacienteId) params.set('paciente_id', pacienteId);
      const data = await llamarApi(`/?${params.toString()}`);
      setHistorial(data);
      setEstadoHistorial('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstadoHistorial('error');
    }
  }, [pacienteId, t]);

  useEffect(() => {
    recargarHistorial();
  }, [recargarHistorial]);

  async function handlePreview(e) {
    e.preventDefault();
    setError(null);
    setAvisoValidacion(null);
    setCargandoPreview(true);
    setPreview(null);
    try {
      const params = new URLSearchParams({ paciente_id: pacienteId, tipo, periodo_desde: periodoDesde, periodo_hasta: periodoHasta });
      const data = await llamarApi(`/preview?${params.toString()}`);
      setPreview(data.contenido);
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setCargandoPreview(false);
    }
  }

  async function handleValidar() {
    const confirmado = await confirmarDestructivo(t.informesObraSocial.confirmar_validar);
    if (!confirmado) return;

    setValidando(true);
    setError(null);
    try {
      await llamarApi('/', {
        method: 'POST',
        body: JSON.stringify({ paciente_id: pacienteId, tipo, periodo_desde: periodoDesde, periodo_hasta: periodoHasta }),
      });
      setAvisoValidacion(t.informesObraSocial.informe_validado_exito);
      setPreview(null);
      recargarHistorial();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setValidando(false);
    }
  }

  async function handleAbrirInforme(id) {
    setError(null);
    try {
      const data = await llamarApi(`/${id}`);
      setInformeAbierto(data);
    } catch (err) {
      setError(mensajeDeError(err, t));
    }
  }

  async function handleConfirmarAnulacion(motivo) {
    const informe = informeAAnular;
    const confirmado = await confirmarDestructivo(t.informesObraSocial.confirmar_anular);
    if (!confirmado) return;

    setAnulandoId(informe.id);
    setError(null);
    try {
      await llamarApi(`/${informe.id}/anular`, { method: 'POST', body: JSON.stringify({ motivo }) });
      setInformeAAnular(null);
      recargarHistorial();
    } catch (err) {
      setError(mensajeDeError(err, t));
    } finally {
      setAnulandoId(null);
    }
  }

  const pacienteSeleccionable = pacienteId !== '';

  return (
    <div>
      <h1>{t.informesObraSocial.titulo}</h1>
      <p className="panel-explicacion">{t.informesObraSocial.explicacion}</p>

      {error && <Alert variant="error">{error}</Alert>}
      {avisoValidacion && <Alert variant="success">{avisoValidacion}</Alert>}

      <form onSubmit={handlePreview} className="panel-filtros">
        <FormField label={t.informesObraSocial.seleccionar_paciente} name="paciente_id" type="select" required value={pacienteId} onChange={(e) => setPacienteId(e.target.value)}>
          <option value="">{t.comun.seleccionar}</option>
          {pacientes.map((p) => (
            <option key={p.id} value={p.id}>{p.nombre}</option>
          ))}
        </FormField>
        <FormField label={t.informesObraSocial.tipo_informe} name="tipo" type="select" value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="resumen_mensual">{t.informesObraSocial.tipo_resumen_mensual}</option>
          <option value="planilla_asistencia">{t.informesObraSocial.tipo_planilla_asistencia}</option>
        </FormField>
        <FormField label={t.informesObraSocial.periodo_desde} name="periodo_desde" type="date" required value={periodoDesde} onChange={(e) => setPeriodoDesde(e.target.value)} />
        <FormField label={t.informesObraSocial.periodo_hasta} name="periodo_hasta" type="date" required value={periodoHasta} onChange={(e) => setPeriodoHasta(e.target.value)} />
        <Button type="submit" disabled={cargandoPreview || !pacienteSeleccionable}>
          {cargandoPreview ? t.informesObraSocial.generando_preview : t.informesObraSocial.generar_preview}
        </Button>
      </form>

      {estadoPacientes === 'error' && <Alert variant="error">{t.comun.error_generico}</Alert>}

      {preview && (
        <div className="informe-obra-social-preview">
          <ContenidoInforme contenido={preview} t={t} />
          {cargado && puede('validar_informe_obra_social') ? (
            <Button onClick={handleValidar} disabled={validando}>
              {validando ? t.informesObraSocial.validando : t.informesObraSocial.validar_y_guardar}
            </Button>
          ) : (
            cargado && <Alert variant="info">{t.informesObraSocial.sin_permiso_validar}</Alert>
          )}
        </div>
      )}

      <h2>{t.informesObraSocial.historial_titulo}</h2>
      <EstadoLista estado={estadoHistorial} error={error} vacio={estadoHistorial === 'listo' && historial.length === 0} recargar={recargarHistorial}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.informesObraSocial.col_tipo}</th>
              <th>{t.informesObraSocial.col_periodo}</th>
              <th>{t.informesObraSocial.col_estado_informe}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {historial.map((informe) => (
              <tr key={informe.id}>
                <td>{t.informesObraSocial[`tipo_${informe.tipo}`]}</td>
                <td>{informe.periodo_desde} — {informe.periodo_hasta}</td>
                <td>
                  <span className={claseBadge(informe.estado)}>
                    {t.informesObraSocial[`estado_${informe.estado}`]}
                  </span>
                </td>
                <td>
                  <Button variant="secondary" onClick={() => handleAbrirInforme(informe.id)}>{t.informesObraSocial.imprimir}</Button>
                  {informe.estado === 'validado' && cargado && puede('validar_informe_obra_social') && (
                    <Button variant="secondary" onClick={() => setInformeAAnular(informe)} disabled={anulandoId === informe.id}>
                      {anulandoId === informe.id ? t.comun.guardando : t.informesObraSocial.anular}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {informeAbierto && <VistaImpresion informe={informeAbierto} onCerrar={() => setInformeAbierto(null)} t={t} />}

      {informeAAnular && (
        <AnularInformeModal
          onCerrar={() => setInformeAAnular(null)}
          onConfirmar={handleConfirmarAnulacion}
          guardando={anulandoId === informeAAnular.id}
          t={t}
        />
      )}
    </div>
  );
}
