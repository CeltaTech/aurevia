import { useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useEmpresa } from '../../context/EmpresaContext';
import { usePrestadoraActual } from '../../hooks/usePrestadoraActual';
import { supabase } from '../../lib/supabaseClient';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { generarConstanciaAusencia, descargarPDF } from '../../lib/generarDocumentoCese';
import { ESTADO_ACTIVO } from '../../lib/candidatos';
import { guardiasAfectadas, guardiasSinCubrir, sumarLasYaCubiertas } from '../../lib/guardiasAfectadas';
import { diasComputados } from '../../lib/diasDeAusencia';
import { mensajeDeError, errorDeLaRespuesta } from '../../lib/errores';
import { con } from '../../lib/textos';
import { avisarCambioDeAsistente } from '../../lib/avisarCambioDeAsistente';
import { llamarApiPanel } from '../../lib/apiPanel';
import { useMotivosSustitucionGuardia } from '../../hooks/useMotivosSustitucionGuardia';
import { nombreMotivoSustitucion, valorGuardado } from '../../lib/motivoDeSustitucion';

const TIPOS = ['enfermedad_inculpable', 'accidente_inculpable', 'otra_licencia', 'ausencia_no_justificada'];

// El momento de ahora con la forma que pide una caja de fecha y hora (`2026-09-16T14:30`), en hora
// local. `toISOString()` a secas daría la hora en UTC, que en horario argentino se lee tres horas
// corrida. Es lo que viene puesto en «cuándo avisó»: el caso corriente es que la Coordinadora
// cargue la ausencia al enterarse, y el que avisó antes se corrige hacia atrás.
function ahoraLocal() {
  const momento = new Date();
  const corrida = new Date(momento.getTime() - momento.getTimezoneOffset() * 60000);
  return corrida.toISOString().slice(0, 16);
}

// De lo que escribió la Coordinadora al momento exacto que se guarda. Vacío devuelve `null`, y
// entonces la base pone el momento de la carga: una ausencia sin este dato se trata como urgente,
// que es el error barato.
function momentoGuardado(texto) {
  if (!texto) return null;
  const momento = new Date(texto);
  return Number.isNaN(momento.getTime()) ? null : momento.toISOString();
}
const API_URL = import.meta.env.VITE_API_URL;

async function llamarApiAusencias(path, opciones = {}) {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/ausencias${path}`, {
    ...opciones,
    headers: {
      Authorization: `Bearer ${data.session?.access_token}`,
      ...opciones.headers,
    },
  });
  const resultado = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw errorDeLaRespuesta(respuesta, resultado);
  return resultado;
}

export function AusenciasCoberturaTab({ asistente }) {
  const { t } = useLocale();
  const prestadoraId = usePrestadoraActual();
  const { empresa } = useEmpresa();
  const [ausencias, setAusencias] = useState([]);
  const [coberturas, setCoberturas] = useState({});
  const [otrosAsistentes, setOtrosAsistentes] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardando, setGuardando] = useState(false);
  const [nueva, setNueva] = useState({ tipo: 'enfermedad_inculpable', fecha_inicio: '', fecha_fin: '', observaciones: '', avisada_en: ahoraLocal() });
  const [coberturaForm, setCoberturaForm] = useState({});
  const [cierreForm, setCierreForm] = useState({});
  const [subiendoCertificado, setSubiendoCertificado] = useState(null);
  const [errorCertificado, setErrorCertificado] = useState(null);
  const {
    filas: motivosSustitucion,
    estado: estadoMotivos,
    error: errorMotivos,
  } = useMotivosSustitucionGuardia(prestadoraId);

  // La fila del catálogo que está elegida en el formulario de una ausencia. Se busca por lo que se
  // guarda —la clave o el nombre—, que es lo mismo que viaja al motor, y sirve para saber si esa
  // causa obliga a explicar.
  function motivoElegido(ausenciaId) {
    const valor = coberturaForm[ausenciaId]?.motivo;
    if (!valor) return null;
    return motivosSustitucion.find((m) => valorGuardado(m) === valor) ?? null;
  }

  async function recargar() {
    setEstado('cargando');
    const [{ data: dataAusencias, error: errorAusencias }, { data: dataAsistentes }] = await Promise.all([
      supabase.from('ausencias').select('*').eq('asistente_id', asistente.id).order('fecha_inicio', { ascending: false }),
      // Quién puede cubrir esta ausencia. Es repartir trabajo, así que solo entra quien sigue en
      // el plantel; y se filtra en la consulta porque esta lista no muestra a nadie, solo llena
      // el desplegable del sustituto. El valor sale de `ESTADO_ACTIVO`, la misma constante que
      // contesta `estaEnElPlantel`, para que la regla quede escrita en un solo lugar
      // (regla 12 de CLAUDE.md §7).
      supabase.from('asistentes').select('id, nombre').eq('estado', ESTADO_ACTIVO).neq('id', asistente.id),
    ]);
    if (errorAusencias) {
      setError(mensajeDeError(errorAusencias, t));
      setEstado('error');
      return;
    }
    // Qué turnos de esas ausencias ya tienen sustituto. Se trae junto con las ausencias y no al
    // apretar el botón: la tarjeta tiene que poder decir cuántas faltan antes de que nadie toque
    // nada. Si esta consulta falla, la pestaña entra en error en vez de dibujar cero cubiertas,
    // que invitaría a asignar de nuevo lo que ya está asignado.
    const lista = dataAusencias ?? [];
    const porAusencia = {};
    if (lista.length > 0) {
      const { data: dataCobertura, error: errorCobertura } = await supabase
        .from('guardias_cobertura')
        .select('id, ausencia_id, guardia_original_id')
        .in('ausencia_id', lista.map((a) => a.id));
      if (errorCobertura) {
        setError(mensajeDeError(errorCobertura, t));
        setEstado('error');
        return;
      }
      for (const cobertura of dataCobertura ?? []) {
        (porAusencia[cobertura.ausencia_id] ??= []).push(cobertura);
      }
    }

    setAusencias(lista);
    setCoberturas(porAusencia);
    setOtrosAsistentes(dataAsistentes ?? []);
    setEstado('listo');
  }

  useEffect(() => { recargar(); }, [asistente.id]);

  // Qué guardias deja sin Asistente esta ausencia. Se pregunta al guardarla y queda escrito en la
  // ausencia: lo que hay que cubrir son turnos, no un rango de fechas, y sin esta lista la
  // cobertura quedaba colgada de la ausencia sin decir de qué día. Cuál cuenta lo decide
  // `guardiasAfectadas`, y acá sólo se traen las de esta persona desde el primer día.
  //
  // Las guardias de la ausencia abierta se piden igual: sin fecha de fin la lista alcanza todo lo
  // que ya esté armado hacia adelante, y se vuelve a calcular el día que se le cargue el cierre.
  //
  // Y lo ya cubierto se suma aparte, porque la consulta no lo encuentra: un turno cubierto pasó a
  // nombre de quien lo hace, así que dejó de ser de esta persona. Por qué eso importa lo explica
  // `sumarLasYaCubiertas`, que es donde vive la regla.
  async function guardiasDeLaAusencia(ausencia) {
    const consulta = supabase
      .from('guardias')
      .select('id, fecha, estado')
      .eq('asistente_id', asistente.id)
      .gte('fecha', ausencia.fecha_inicio);
    const { data, error: errorGuardias } = ausencia.fecha_fin
      ? await consulta.lte('fecha', ausencia.fecha_fin)
      : await consulta;
    if (errorGuardias) throw errorGuardias;

    return sumarLasYaCubiertas(guardiasAfectadas(data ?? [], ausencia), coberturas[ausencia.id]);
  }

  // Las guardias que esta ausencia dejó descubiertas. Las cargadas antes de que esto se escribiera
  // tienen la columna vacía, y ahí se averigua ahora y se guarda: son ausencias reales, con turnos
  // reales sin cubrir, y dejarlas sin poder asignar un sustituto sería castigarlas por haber sido
  // cargadas primero.
  async function afectadasDe(ausencia) {
    if (Array.isArray(ausencia.guardias_afectadas)) return ausencia.guardias_afectadas;
    const afectadas = await guardiasDeLaAusencia(ausencia);
    const { error: errorUpdate } = await supabase
      .from('ausencias')
      .update({ guardias_afectadas: afectadas })
      .eq('id', ausencia.id);
    if (errorUpdate) throw errorUpdate;
    return afectadas;
  }

  async function registrarAusencia() {
    if (!nueva.fecha_inicio) return;
    setGuardando(true);
    setError(null);

    let afectadas;
    try {
      afectadas = await guardiasDeLaAusencia(nueva);
    } catch {
      // Sin saber qué turnos quedan descubiertos la ausencia no se guarda. Guardarla igual la
      // dejaría con la lista vacía, que se lee como «no afectó a ninguno» y no como «no se pudo
      // averiguar»: nadie iría a buscar una cobertura que la pantalla dice que no hace falta.
      setGuardando(false);
      setError(t.comun.error_generico);
      return;
    }

    const { error: errorInsert } = await supabase.from('ausencias').insert({
      prestadora_id: prestadoraId,
      asistente_id: asistente.id,
      tipo: nueva.tipo,
      fecha_inicio: nueva.fecha_inicio,
      fecha_fin: nueva.fecha_fin || null,
      observaciones: nueva.observaciones || null,
      avisada_en: momentoGuardado(nueva.avisada_en),
      guardias_afectadas: afectadas,
      dias_computados: diasComputados(nueva),
    });
    setGuardando(false);
    if (errorInsert) {
      setError(t.comun.error_generico);
      return;
    }
    setNueva({ tipo: 'enfermedad_inculpable', fecha_inicio: '', fecha_fin: '', observaciones: '', avisada_en: ahoraLocal() });
    recargar();
  }

  // Cerrar una ausencia que estaba en curso: se le pone el día en que terminó y, con eso, los dos
  // números que hasta que ese día se sabe no se podían calcular. Los días computados son los que
  // imprime la constancia que se le entrega a la persona, y la lista de guardias se rehace porque
  // mientras la ausencia estaba abierta alcanzaba todo lo que hubiera hacia adelante.
  //
  // Los tres valores se guardan de una sola vez: una ausencia cerrada sin su cuenta, o con una
  // cuenta de cuando todavía estaba abierta, es peor que una sin cerrar.
  async function cerrarAusencia(ausencia) {
    const fechaFin = cierreForm[ausencia.id];
    if (!fechaFin) return;
    setGuardando(true);
    setError(null);

    const cerrada = { ...ausencia, fecha_fin: fechaFin };
    let afectadas;
    try {
      afectadas = await guardiasDeLaAusencia(cerrada);
    } catch {
      setGuardando(false);
      setError(t.comun.error_generico);
      return;
    }

    const { error: errorUpdate } = await supabase
      .from('ausencias')
      .update({ fecha_fin: fechaFin, guardias_afectadas: afectadas, dias_computados: diasComputados(cerrada) })
      .eq('id', ausencia.id);
    setGuardando(false);
    if (errorUpdate) {
      setError(t.comun.error_generico);
      return;
    }
    setCierreForm((prev) => ({ ...prev, [ausencia.id]: '' }));
    recargar();
  }

  function descargarConstancia(ausencia) {
    const doc = generarConstanciaAusencia({
      asistente, ausencia, tipoLabel: t.asistentes.ausencias[`tipo_${ausencia.tipo}`], nombreEmpresa: empresa?.nombre ?? '',
    });
    descargarPDF(doc, `constancia-ausencia-${asistente.nombre}-${ausencia.fecha_inicio}.pdf`);
  }

  async function subirCertificado(ausenciaId, archivo) {
    if (!archivo) return;
    setSubiendoCertificado(ausenciaId);
    setErrorCertificado(null);
    try {
      const formData = new FormData();
      formData.append('archivo', archivo);
      await llamarApiAusencias(`/${ausenciaId}/certificado`, { method: 'POST', body: formData });
      await recargar();
    } catch {
      setErrorCertificado(t.asistentes.ausencias.certificado_invalido);
    } finally {
      setSubiendoCertificado(null);
    }
  }

  async function verCertificado(ausenciaId) {
    try {
      const { url } = await llamarApiAusencias(`/${ausenciaId}/certificado-url`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setErrorCertificado(mensajeDeError(err, t));
    }
  }

  // Un turno cubierto por vez, y cada uno se lo pide al motor.
  //
  // Hasta hoy se guardaba una sola fila, con `guardia_original_id` vacía: decía que alguien iba a
  // cubrir la ausencia, y no qué turno iba a tomar. Con eso ninguna pantalla podía contestar quién
  // va mañana a lo de un Paciente, ni si quedaron turnos sin nadie. El costo adicional es el de
  // cada guardia cubierta, y por eso va igual en todos los turnos.
  //
  // Y tampoco se escribe más contra la base desde acá. Cubrir un turno es dejar escrito a quién le
  // tocaba y por qué lo hace otro, y pasar la guardia a nombre de quien la hace, para que pueda
  // verla y ficharla. Son dos escrituras que valen juntas, y viven una sola vez en el motor
  // (`backend/src/utils/cubrirGuardia.js`).
  //
  // Se cubren solamente los turnos que todavía no tienen sustituto: apretar dos veces no duplica
  // la cobertura de un mismo turno.
  async function asignarCobertura(ausencia) {
    const formulario = coberturaForm[ausencia.id] ?? {};
    const sustitutoId = formulario.asistente_sustituto_id;
    if (!sustitutoId) return;
    setGuardando(true);
    setError(null);

    let sinCubrir;
    try {
      const afectadas = await afectadasDe(ausencia);
      sinCubrir = guardiasSinCubrir(afectadas, coberturas[ausencia.id]);
    } catch {
      setGuardando(false);
      setError(t.comun.error_generico);
      return;
    }

    // Sin turnos descubiertos no hay cobertura que cargar. Guardar una fila suelta volvería a
    // dejar una cobertura que no cubre nada en particular, que es justo lo que esto viene a
    // terminar.
    if (sinCubrir.length === 0) {
      setGuardando(false);
      return;
    }

    try {
      for (const guardiaId of sinCubrir) {
        await llamarApiPanel(`/guardias/${guardiaId}/cubrir`, {
          method: 'POST',
          body: JSON.stringify({
            asistente_sustituto_id: sustitutoId,
            ausencia_id: ausencia.id,
            motivo: formulario.motivo || null,
            motivo_detalle: formulario.motivo_detalle || null,
            costo_adicional: formulario.costo_adicional || null,
          }),
        });
      }
    } catch (err) {
      setGuardando(false);
      setError(mensajeDeError(err, t));
      return;
    }
    setGuardando(false);

    // Quien va a la casa del Paciente ya no es el de siempre, así que se avisa. Quién es viaja
    // explícito, porque el aviso nunca lo deduce de la guardia. Un aviso para todos los turnos y no
    // uno por turno.
    await avisarCambioDeAsistente({
      guardiaIds: sinCubrir,
      asistenteNuevoId: sustitutoId,
      asistenteAnteriorId: asistente?.id ?? null,
    });

    setCoberturaForm((prev) => ({ ...prev, [ausencia.id]: {} }));
    recargar();
  }

  return (
    <div>
      <h2>{t.asistentes.ausencias.titulo}</h2>
      {error && <Alert variant="error">{error}</Alert>}
      {errorCertificado && <Alert variant="error">{errorCertificado}</Alert>}

      <EstadoLista estado={estado} error={error} vacio={estado === 'listo' && ausencias.length === 0} recargar={recargar}>
        {ausencias.map((a) => {
          // Cuántos turnos faltan cubrir. Con la lista todavía sin calcular —las ausencias
          // cargadas antes de que esto existiera— no se sabe, y entonces el sustituto se ofrece
          // igual: la cuenta se hace al asignarlo.
          const afectadas = Array.isArray(a.guardias_afectadas) ? a.guardias_afectadas : null;
          const sinCubrir = afectadas === null ? null : guardiasSinCubrir(afectadas, coberturas[a.id]);
          return (
          <div key={a.id} className="panel-card-ausencia">
            <p>
              <strong>{t.asistentes.ausencias[`tipo_${a.tipo}`]}</strong> — {new Date(a.fecha_inicio).toLocaleDateString()}
              {a.fecha_fin ? ` → ${new Date(a.fecha_fin).toLocaleDateString()}` : ` (${t.asistentes.ausencias.en_curso})`}
            </p>
            {a.dias_computados !== null && a.dias_computados !== undefined && (
              <p>{con(t.asistentes.ausencias.dias_computados, { n: a.dias_computados })}</p>
            )}
            {a.observaciones && <p>{a.observaciones}</p>}

            {/* Una ausencia en curso se cierra acá, y hasta que se cierre no hay cuánto duró ni
                lista firme de turnos descubiertos: mientras no se sabe cuándo termina, alcanza
                todo lo que haya hacia adelante. */}
            {!a.fecha_fin && (
              <div className="panel-cierre-ausencia">
                <FormField
                  label={t.asistentes.ausencias.fecha_fin}
                  name={`cierre-${a.id}`}
                  type="date"
                  value={cierreForm[a.id] || ''}
                  onChange={(e) => setCierreForm((prev) => ({ ...prev, [a.id]: e.target.value }))}
                />
                <Button variant="secondary" onClick={() => cerrarAusencia(a)} disabled={guardando || !cierreForm[a.id]}>
                  {t.asistentes.ausencias.cerrar_ausencia}
                </Button>
              </div>
            )}

            {/* Cuántos turnos dejó descubiertos. Las ausencias cargadas antes de que esto se
                escribiera tienen la columna vacía, y ahí no se dice nada: cero y «no se sabe» no
                son lo mismo, y escribir cero haría creer que no hay nada que cubrir. */}
            {afectadas !== null && (
              <p>
                {afectadas.length === 0
                  ? t.asistentes.ausencias.sin_guardias_afectadas
                  : con(t.asistentes.ausencias.guardias_afectadas, { n: afectadas.length })}
                {afectadas.length > 0 && (
                  <>
                    {' — '}
                    {sinCubrir.length === 0
                      ? t.asistentes.ausencias.todas_cubiertas
                      : con(t.asistentes.ausencias.guardias_sin_cubrir, { n: sinCubrir.length })}
                  </>
                )}
              </p>
            )}

            <Button variant="secondary" onClick={() => descargarConstancia(a)}>
              {t.asistentes.ausencias.descargar_constancia}
            </Button>

            <div className="panel-certificado-medico">
              <p><strong>{t.asistentes.ausencias.certificado_medico}</strong></p>
              {a.certificado_url ? (
                <>
                  <p>{t.asistentes.ausencias.certificado_cargado}</p>
                  <Button variant="secondary" onClick={() => verCertificado(a.id)}>
                    {t.asistentes.ausencias.ver_certificado}
                  </Button>
                </>
              ) : (
                <p>{t.asistentes.ausencias.sin_certificado}</p>
              )}
              <label>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png"
                  disabled={subiendoCertificado === a.id}
                  onChange={(e) => subirCertificado(a.id, e.target.files?.[0])}
                />
              </label>
              {subiendoCertificado === a.id && <p>{t.asistentes.ausencias.subiendo_certificado}</p>}
            </div>

            {/* Sin turnos que cubrir no se pide ningún sustituto: no habría dónde ponerlo. */}
            {(sinCubrir === null || sinCubrir.length > 0) && (
              <>
                <FormField
                  label={t.asistentes.ausencias.asignar_sustituto}
                  name={`sustituto-${a.id}`}
                  type="select"
                  value={coberturaForm[a.id]?.asistente_sustituto_id || ''}
                  onChange={(e) => setCoberturaForm((prev) => ({ ...prev, [a.id]: { ...prev[a.id], asistente_sustituto_id: e.target.value } }))}
                >
                  <option value="">{t.comun.todos}</option>
                  {otrosAsistentes.map((o) => (
                    <option key={o.id} value={o.id}>{o.nombre}</option>
                  ))}
                </FormField>
                {/* Por qué la hace otro. La lista sale del catálogo de la Prestadora: si se quedó
                    sin ninguna encendida no hay nada que elegir, y se lo dice, porque un
                    desplegable vacío no explica nada. */}
                {estadoMotivos === 'listo' && motivosSustitucion.length === 0 && (
                  <Alert variant="info">{t.asistentes.ausencias.sustitucion_sin_motivos}</Alert>
                )}
                {errorMotivos && <Alert variant="error">{errorMotivos}</Alert>}
                <FormField
                  label={t.asistentes.ausencias.sustitucion_motivo}
                  name={`motivo-sustitucion-${a.id}`}
                  type="select"
                  value={coberturaForm[a.id]?.motivo || ''}
                  onChange={(e) => setCoberturaForm((prev) => ({ ...prev, [a.id]: { ...prev[a.id], motivo: e.target.value } }))}
                  disabled={estadoMotivos !== 'listo' || motivosSustitucion.length === 0}
                >
                  <option value="">{t.guardias.nueva_guardia.elegir}</option>
                  {motivosSustitucion.map((m) => (
                    <option key={m.id} value={valorGuardado(m)}>
                      {nombreMotivoSustitucion(m, t)}
                    </option>
                  ))}
                </FormField>
                {motivoElegido(a.id)?.pide_detalle && (
                  <FormField
                    label={t.asistentes.ausencias.sustitucion_motivo_detalle}
                    name={`motivo-detalle-${a.id}`}
                    type="textarea"
                    value={coberturaForm[a.id]?.motivo_detalle || ''}
                    onChange={(e) => setCoberturaForm((prev) => ({ ...prev, [a.id]: { ...prev[a.id], motivo_detalle: e.target.value } }))}
                  />
                )}
                <FormField
                  label={t.asistentes.ausencias.costo_adicional}
                  name={`costo-${a.id}`}
                  type="number"
                  value={coberturaForm[a.id]?.costo_adicional || ''}
                  onChange={(e) => setCoberturaForm((prev) => ({ ...prev, [a.id]: { ...prev[a.id], costo_adicional: e.target.value } }))}
                />
                <Button variant="secondary" onClick={() => asignarCobertura(a)} disabled={guardando}>
                  {t.asistentes.ausencias.guardar_cobertura}
                </Button>
              </>
            )}
          </div>
          );
        })}
      </EstadoLista>

      <h2>{t.asistentes.ausencias.registrar_nueva}</h2>
      <FormField label={t.asistentes.ausencias.tipo} name="tipo" type="select" value={nueva.tipo} onChange={(e) => setNueva((f) => ({ ...f, tipo: e.target.value }))}>
        {TIPOS.map((tipo) => <option key={tipo} value={tipo}>{t.asistentes.ausencias[`tipo_${tipo}`]}</option>)}
      </FormField>
      <FormField label={t.asistentes.ausencias.fecha_inicio} name="fecha_inicio" type="date" value={nueva.fecha_inicio} onChange={(e) => setNueva((f) => ({ ...f, fecha_inicio: e.target.value }))} required />
      <FormField label={t.asistentes.ausencias.fecha_fin} name="fecha_fin" type="date" value={nueva.fecha_fin} onChange={(e) => setNueva((f) => ({ ...f, fecha_fin: e.target.value }))} />
      <FormField
        label={t.asistentes.ausencias.avisada_en}
        name="avisada_en"
        type="datetime-local"
        value={nueva.avisada_en}
        ayuda={t.asistentes.ausencias.ayuda_avisada_en}
        onChange={(e) => setNueva((f) => ({ ...f, avisada_en: e.target.value }))}
      />
      <FormField label={t.comun.nota_interna} name="observaciones" type="textarea" value={nueva.observaciones} onChange={(e) => setNueva((f) => ({ ...f, observaciones: e.target.value }))} />
      <Button onClick={registrarAusencia} disabled={guardando || !nueva.fecha_inicio}>
        {guardando ? t.comun.guardando : t.asistentes.ausencias.registrar_nueva}
      </Button>
    </div>
  );
}
