import { Fragment, useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { supabase } from '../../lib/supabaseClient';
import { hoyISO } from '../../lib/horarios';
import { conMotivoDeDomicilioTemporal } from '../../lib/domiciliosTemporales';
import { TONO, claseBadgeTono } from '../../lib/tonos';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { mensajeDeError } from '../../lib/errores';
import { useModalAccesible } from '../../hooks/useModalAccesible';

// Dónde se atiende al Paciente cuando no está en el domicilio de su ficha.
//
// Cuál domicilio rige hoy NO se calcula acá: se le pregunta a la base con
// `domicilio_del_paciente_en`, que es el único lugar donde vive ese criterio y el mismo que
// usan el check-in y la aplicación del Asistente (regla 12 de CLAUDE.md §7). Si se resolviera
// otra vez en el navegador, el día que cambie la regla esta pantalla contestaría distinto que
// el resto del sistema.
export function DomiciliosTemporalesPaciente({ paciente, puedeEditar, onClose }) {
  const modal = useModalAccesible(onClose);
  const { t } = useLocale();
  const confirmarDestructivo = useConfirmarDestructivo();

  const [periodos, setPeriodos] = useState([]);
  const [dondeHoy, setDondeHoy] = useState(null);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const [mostrandoForm, setMostrandoForm] = useState(false);
  const [domicilio, setDomicilio] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [motivo, setMotivo] = useState('');
  const [fechaInicio, setFechaInicio] = useState(hoyISO);
  const [fechaFin, setFechaFin] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [errorForm, setErrorForm] = useState(null);

  const [terminandoId, setTerminandoId] = useState(null);
  const [fechaTermino, setFechaTermino] = useState(hoyISO);
  const [filaEnCurso, setFilaEnCurso] = useState(null);
  const [errorFila, setErrorFila] = useState(null);

  // Ningún error de la base llega crudo a la pantalla: primero se lo reconoce (¿un período
  // pisado?, ¿las fechas al revés?) y después se busca la frase en las traducciones.
  const explicar = useCallback(
    (e) => mensajeDeError(conMotivoDeDomicilioTemporal(e), t, 'domicilios_temporales'),
    [t]
  );

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    setErrorFila(null);

    const [listaResp, hoyResp] = await Promise.all([
      supabase
        .from('domicilios_temporales_paciente')
        .select('*')
        .eq('paciente_id', paciente.id)
        .order('fecha_inicio', { ascending: false }),
      supabase.rpc('domicilio_del_paciente_en', { p_paciente_id: paciente.id, p_fecha: hoyISO() }),
    ]);

    if (listaResp.error || hoyResp.error) {
      setError(explicar(listaResp.error || hoyResp.error));
      setEstado('error');
      return;
    }

    setPeriodos(listaResp.data ?? []);
    setDondeHoy(hoyResp.data?.[0] ?? null);
    setEstado(listaResp.data?.length ? 'listo' : 'vacio');
  }, [paciente.id, explicar]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  function limpiarForm() {
    setDomicilio('');
    setLat('');
    setLng('');
    setMotivo('');
    setFechaInicio(hoyISO());
    setFechaFin('');
    setErrorForm(null);
  }

  async function handleGuardar() {
    if (!domicilio.trim() || !motivo.trim() || !fechaInicio || lat === '' || lng === '') {
      setErrorForm(t.domicilios_temporales.form_incompleto);
      return;
    }

    setGuardando(true);
    setErrorForm(null);

    const { error: errorInsert } = await supabase.from('domicilios_temporales_paciente').insert({
      // De la misma Prestadora que el Paciente, siempre: la base lo exige con una clave
      // foránea sobre las dos columnas juntas.
      prestadora_id: paciente.prestadora_id,
      paciente_id: paciente.id,
      domicilio: domicilio.trim(),
      lat: Number(lat),
      lng: Number(lng),
      motivo: motivo.trim(),
      fecha_inicio: fechaInicio,
      fecha_fin: fechaFin || null,
    });

    setGuardando(false);
    if (errorInsert) {
      setErrorForm(explicar(errorInsert));
      return;
    }

    setMostrandoForm(false);
    limpiarForm();
    recargar();
  }

  function abrirTerminar(periodo) {
    setErrorFila(null);
    setTerminandoId(periodo.id);
    // Un período no puede terminar antes de empezar: si todavía no arrancó, el primer día
    // posible es el de inicio.
    setFechaTermino(hoyISO() > periodo.fecha_inicio ? hoyISO() : periodo.fecha_inicio);
  }

  async function terminarPeriodo(periodo) {
    setFilaEnCurso(periodo.id);
    setErrorFila(null);

    const { error: errorUpdate } = await supabase
      .from('domicilios_temporales_paciente')
      .update({ fecha_fin: fechaTermino })
      .eq('id', periodo.id);

    setFilaEnCurso(null);
    if (errorUpdate) {
      setErrorFila(explicar(errorUpdate));
      return;
    }

    setTerminandoId(null);
    recargar();
  }

  async function borrarPeriodo(periodo) {
    if (!(await confirmarDestructivo(t.domicilios_temporales.confirmar_borrado))) return;

    setFilaEnCurso(periodo.id);
    setErrorFila(null);

    const { error: errorDelete } = await supabase
      .from('domicilios_temporales_paciente')
      .delete()
      .eq('id', periodo.id);

    setFilaEnCurso(null);
    if (errorDelete) {
      setErrorFila(explicar(errorDelete));
      return;
    }

    recargar();
  }

  const hayDatos = estado === 'listo' || estado === 'vacio';

  return (
    <div className="panel-modal-fondo" onClick={onClose}>
      <div className="panel-modal" onClick={(e) => e.stopPropagation()} {...modal.props}>
        <h2 id={modal.idTitulo}>{t.domicilios_temporales.titulo} — {paciente.nombre}</h2>
        <p className="panel-explicacion">{t.domicilios_temporales.explicacion}</p>

        {estado === 'cargando' && <p className="estado-cargando">{t.comun.cargando}</p>}
        {estado === 'error' && <Alert variant="error">{error || t.comun.error_generico}</Alert>}

        {hayDatos && (
          <>
            <h3>{t.domicilios_temporales.donde_hoy}</h3>
            {dondeHoy && (
              <div className="panel-resultado-calculo">
                <Alert variant="info">
                  {dondeHoy.es_temporal ? t.domicilios_temporales.hoy_temporal : t.domicilios_temporales.hoy_ficha}
                </Alert>
                <dl className="panel-detalle-lista">
                  <dt>{t.domicilios_temporales.col_domicilio}</dt>
                  <dd>{dondeHoy.domicilio || '—'}</dd>
                  <dt>{t.domicilios_temporales.col_coordenadas}</dt>
                  <dd>{dondeHoy.lat ?? '—'}, {dondeHoy.lng ?? '—'}</dd>
                  {dondeHoy.es_temporal && (
                    <>
                      <dt>{t.domicilios_temporales.col_motivo}</dt>
                      <dd>{dondeHoy.motivo || '—'}</dd>
                      <dt>{t.domicilios_temporales.col_desde}</dt>
                      <dd>{dondeHoy.desde || '—'}</dd>
                      <dt>{t.domicilios_temporales.col_hasta}</dt>
                      <dd>{dondeHoy.hasta || t.domicilios_temporales.sin_fecha_fin}</dd>
                    </>
                  )}
                </dl>
              </div>
            )}

            {errorFila && <Alert variant="error">{errorFila}</Alert>}

            {estado === 'vacio' && <p className="estado-vacio">{t.domicilios_temporales.sin_domicilios}</p>}

            {estado === 'listo' && (
              <table className="panel-tabla">
                <thead>
                  <tr>
                    <th>{t.domicilios_temporales.col_desde}</th>
                    <th>{t.domicilios_temporales.col_hasta}</th>
                    <th>{t.domicilios_temporales.col_domicilio}</th>
                    <th>{t.domicilios_temporales.col_motivo}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {periodos.map((p) => (
                    <Fragment key={p.id}>
                      <tr>
                        <td>{p.fecha_inicio}</td>
                        <td>{p.fecha_fin || t.domicilios_temporales.sin_fecha_fin}</td>
                        <td>
                          {p.domicilio}
                          {p.id === dondeHoy?.domicilio_temporal_id && (
                            <>
                              {' '}
                              <span className={claseBadgeTono(TONO.EXITO)}>{t.domicilios_temporales.rige_hoy}</span>
                            </>
                          )}
                        </td>
                        <td>{p.motivo}</td>
                        <td>
                          {puedeEditar && (
                            <>
                              <Button
                                variant="secondary"
                                onClick={() => abrirTerminar(p)}
                                disabled={filaEnCurso === p.id || terminandoId === p.id}
                              >
                                {t.domicilios_temporales.terminar}
                              </Button>{' '}
                              <Button variant="secondary" onClick={() => borrarPeriodo(p)} disabled={filaEnCurso === p.id}>
                                {t.comun.borrar}
                              </Button>
                            </>
                          )}
                        </td>
                      </tr>
                      {terminandoId === p.id && (
                        <tr>
                          <td colSpan={5}>
                            <div className="panel-resultado-calculo">
                              <p className="panel-explicacion">{t.domicilios_temporales.terminar_explicacion}</p>
                              <FormField
                                label={t.domicilios_temporales.terminar_fecha}
                                name={`fecha_termino_${p.id}`}
                                type="date"
                                value={fechaTermino}
                                min={p.fecha_inicio}
                                onChange={(e) => setFechaTermino(e.target.value)}
                                required
                              />
                              <div className="panel-modal-acciones">
                                <Button
                                  variant="secondary"
                                  onClick={() => setTerminandoId(null)}
                                  disabled={filaEnCurso === p.id}
                                >
                                  {t.comun.cancelar}
                                </Button>
                                <Button onClick={() => terminarPeriodo(p)} disabled={filaEnCurso === p.id || !fechaTermino}>
                                  {filaEnCurso === p.id ? t.comun.guardando : t.comun.guardar}
                                </Button>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}

            {puedeEditar && !mostrandoForm && (
              <div className="panel-modal-acciones">
                <Button onClick={() => setMostrandoForm(true)}>{t.domicilios_temporales.agregar}</Button>
              </div>
            )}

            {puedeEditar && mostrandoForm && (
              <div className="panel-resultado-calculo">
                <h3>{t.domicilios_temporales.nuevo_titulo}</h3>
                {errorForm && <Alert variant="error">{errorForm}</Alert>}
                <FormField
                  label={t.domicilios_temporales.col_domicilio}
                  name="domicilio_temporal"
                  value={domicilio}
                  onChange={(e) => setDomicilio(e.target.value)}
                  required
                />
                <FormField
                  label={t.domicilios_temporales.lat}
                  name="lat_temporal"
                  type="number"
                  step="any"
                  value={lat}
                  onChange={(e) => setLat(e.target.value)}
                  required
                />
                <FormField
                  label={t.domicilios_temporales.lng}
                  name="lng_temporal"
                  type="number"
                  step="any"
                  value={lng}
                  onChange={(e) => setLng(e.target.value)}
                  ayuda={t.domicilios_temporales.ayuda_coordenadas}
                  required
                />
                <FormField
                  label={t.domicilios_temporales.col_motivo}
                  name="motivo_temporal"
                  value={motivo}
                  onChange={(e) => setMotivo(e.target.value)}
                  required
                />
                <FormField
                  label={t.domicilios_temporales.col_desde}
                  name="fecha_inicio_temporal"
                  type="date"
                  value={fechaInicio}
                  onChange={(e) => setFechaInicio(e.target.value)}
                  required
                />
                <FormField
                  label={t.domicilios_temporales.col_hasta}
                  name="fecha_fin_temporal"
                  type="date"
                  value={fechaFin}
                  min={fechaInicio}
                  onChange={(e) => setFechaFin(e.target.value)}
                  ayuda={t.domicilios_temporales.ayuda_fecha_fin}
                />
                <div className="panel-modal-acciones">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setMostrandoForm(false);
                      limpiarForm();
                    }}
                    disabled={guardando}
                  >
                    {t.comun.cancelar}
                  </Button>
                  <Button onClick={handleGuardar} disabled={guardando}>
                    {guardando ? t.comun.guardando : t.comun.guardar}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}

        <div className="panel-modal-acciones">
          <Button variant="secondary" onClick={onClose}>
            {t.comun.cerrar}
          </Button>
        </div>
      </div>
    </div>
  );
}
