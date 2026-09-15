import { useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useEmpresa } from '../../context/EmpresaContext';
import { useConfirmarDestructivo } from '../../context/TenantSessionContext';
import { useEscalasLegales } from '../../hooks/useEscalasLegales';
import { useFormulasCese } from '../../hooks/useFormulasCese';
import { usePrestadoraActual } from '../../hooks/usePrestadoraActual';
import { useMonedaActual } from '../../hooks/useMonedaActual';
import { resolverEscalasVigentes, resolverFormulasVigentes } from '../../lib/escalasLegales';
import { formatearImporte } from '../../lib/dinero';
import { calcularCese } from '../../lib/calcularCese';
import { supabase } from '../../lib/supabaseClient';
import { TONO, claseBadgeTono } from '../../lib/tonos';
import { Button } from '../../components/ui/Button';
import { FormField } from '../../components/ui/FormField';
import { Alert } from '../../components/ui/Alert';
import { AvisoEscalasProvisorias } from '../../components/AvisoEscalasProvisorias';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { mensajeDeError } from '../../lib/errores';
import {
  generarLiquidacionFinal, generarTelegramaCese, generarNotificacionFinPeriodoPrueba,
} from '../../lib/generarDocumentoCese';
import { bajarYGuardarDocumentoDeCese, verDocumentoGuardado } from '../../lib/documentosGuardados';
import { TIPO_LIQUIDACION, TIPO_TELEGRAMA, TIPO_NOTIFICACION_PRUEBA } from '../../lib/documentosDeCese';

const CAUSALES_CON_TELEGRAMA = new Set(['despido_con_justa_causa', 'despido_sin_causa', 'abandono_de_trabajo']);

function humanizarClave(clave) {
  return clave.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

function formatearValorCalculo(valor, t) {
  if (typeof valor === 'boolean') return valor ? t.comun.si : t.comun.no;
  if (typeof valor === 'number') return valor.toLocaleString('es-AR');
  if (valor === null || valor === undefined || valor === '') return '—';
  return String(valor);
}

const CAUSALES = [
  'renuncia', 'mutuo_acuerdo', 'despido_con_justa_causa', 'despido_sin_causa',
  'abandono_de_trabajo', 'muerte_del_trabajador', 'muerte_del_empleador',
  'muerte_persona_cuidada', 'periodo_de_prueba', 'incapacidad_absoluta',
  'jubilacion', 'despido_por_embarazo_o_matrimonio', 'fin_contrato_comercial',
];

export function VinculoCeseTab({ asistente, onActualizado }) {
  const { t, locale } = useLocale();
  const { empresa } = useEmpresa();
  const confirmarDestructivo = useConfirmarDestructivo();
  const prestadoraId = usePrestadoraActual();
  const moneda = useMonedaActual();
  const { filas: escalasCrudas, estado: estadoEscalas, jurisdiccion } = useEscalasLegales(prestadoraId);
  const { filas: formulasCrudas, estado: estadoFormulas } = useFormulasCese(prestadoraId);
  const [ceses, setCeses] = useState([]);
  const [estadoCeses, setEstadoCeses] = useState('cargando');
  const [errorCeses, setErrorCeses] = useState(null);
  const [fechaCese, setFechaCese] = useState(new Date().toISOString().slice(0, 10));
  const [causal, setCausal] = useState('despido_sin_causa');
  const [resultado, setResultado] = useState(null);
  const [revisadoAbogado, setRevisadoAbogado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState(null);
  // Cuál botón está trabajando, no si hay alguno trabajando: en la tabla hay un botón por cese y
  // por documento, y apagarlos todos mientras se baja uno haría creer que falló algo. Guarda
  // `<cese>-<tipo>`, que es lo que distingue a uno de otro.
  const [trabajando, setTrabajando] = useState(null);
  const [errorDocumento, setErrorDocumento] = useState(null);

  function cargarCeses() {
    setEstadoCeses('cargando');
    setErrorCeses(null);
    supabase.from('ceses').select('*').eq('asistente_id', asistente.id).order('created_at', { ascending: false })
      .then(({ data, error: errorConsulta }) => {
        if (errorConsulta) {
          setErrorCeses(mensajeDeError(errorConsulta, t));
          setEstadoCeses('error');
          return;
        }
        setCeses(data ?? []);
        setEstadoCeses('listo');
      });
  }

  useEffect(() => {
    cargarCeses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asistente.id]);

  function calcular() {
    const escalasResueltas = resolverEscalasVigentes(escalasCrudas, fechaCese, jurisdiccion);
    const formulasResueltas = resolverFormulasVigentes(formulasCrudas, fechaCese, jurisdiccion);
    const r = calcularCese({
      asistente, fechaCese, causal, escalasLegales: escalasResueltas, jurisdiccion, formulasLegales: formulasResueltas,
    });
    setResultado(r);
    setRevisadoAbogado(false);
  }

  async function confirmarCese() {
    if (resultado.requiereRevisionAbogado && !revisadoAbogado) return;
    const confirmado = await confirmarDestructivo(t.asistentes.cese.confirmar);
    if (!confirmado) return;

    setGuardando(true);
    setError(null);

    const { error: errorCese } = await supabase.from('ceses').insert({
      prestadora_id: prestadoraId,
      asistente_id: asistente.id,
      fecha_cese: fechaCese,
      causal,
      detalle_calculo: resultado.detalleCalculo,
      monto_total: resultado.montoTotal,
      revisado_por_abogado: revisadoAbogado,
    });

    if (!errorCese) {
      await supabase.from('asistentes').update({
        estado: 'cesado', fecha_baja: fechaCese,
      }).eq('id', asistente.id);
      // Por qué se lo dio de baja se guarda aparte, en `datos_reservados_asistente`, donde la
      // base exige el permiso `ver_datos_reservados_asistente` para leerlo. Puede no existir
      // todavía la fila, así que se usa `upsert`.
      await supabase.from('datos_reservados_asistente').upsert(
        {
          asistente_id: asistente.id,
          prestadora_id: prestadoraId,
          causal_baja: causal,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'asistente_id' },
      );
    }

    setGuardando(false);
    if (errorCese) {
      setError(t.comun.error_generico);
      return;
    }
    setResultado(null);
    onActualizado();
  }

  // Qué documento le corresponde a cada botón. El telegrama y la notificación de fin de período
  // de prueba comparten botón porque son el mismo aviso para dos causales distintas, y nunca
  // aparecen los dos: lo decide la causal del cese.
  function documentoDelCese(cese, tipo) {
    if (tipo === TIPO_LIQUIDACION) {
      return generarLiquidacionFinal({ asistente, cese, causalLabel: t.asistentes.causales[cese.causal], nombreEmpresa: empresa?.nombre ?? '' });
    }
    if (tipo === TIPO_NOTIFICACION_PRUEBA) {
      return generarNotificacionFinPeriodoPrueba({ asistente, cese, nombreEmpresa: empresa?.nombre ?? '' });
    }
    return generarTelegramaCese({ asistente, cese, causalLabel: t.asistentes.causales[cese.causal], nombreEmpresa: empresa?.nombre ?? '' });
  }

  // Bajar el documento es también guardarlo: lo que se le entregó a esa persona queda, en vez de
  // vivir sólo en la carpeta de descargas de quien apretó el botón.
  //
  // Si la copia falla, se dice. El archivo ya está bajado —eso pasó antes y no depende de la
  // red—, así que lo único que se perdió es la copia guardada, y taparlo dejaría creer que hay
  // una constancia que no existe.
  async function bajarDocumento(cese, tipo) {
    setTrabajando(`${cese.id}-${tipo}`);
    setErrorDocumento(null);
    try {
      await bajarYGuardarDocumentoDeCese(documentoDelCese(cese, tipo), {
        ceseId: cese.id, tipo, persona: asistente.nombre, fecha: cese.fecha_cese,
      });
      cargarCeses();
    } catch (err) {
      setErrorDocumento(mensajeDeError(err, t));
    } finally {
      setTrabajando(null);
    }
  }

  async function verGuardado(cese, tipo) {
    setErrorDocumento(null);
    try {
      const url = await verDocumentoGuardado(cese.id, tipo);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setErrorDocumento(mensajeDeError(err, t));
    }
  }

  // El par de botones de un documento: bajarlo —que es también guardarlo— y, cuando ya quedó
  // guardado, volver a verlo tal como se entregó. El segundo aparece recién cuando hay algo que
  // ver, así que la tabla dice sola de qué ceses hay constancia y de cuáles no.
  function BotonesDeDocumento({ cese, tipo, etiqueta }) {
    const corriendo = trabajando === `${cese.id}-${tipo}`;
    const guardado = Boolean(cese.documentos_generados?.[tipo]);
    return (
      <>
        <Button variant="secondary" onClick={() => bajarDocumento(cese, tipo)} disabled={corriendo}>
          {corriendo ? t.comun.guardando : etiqueta}
        </Button>
        {guardado && (
          <Button variant="secondary" onClick={() => verGuardado(cese, tipo)} title={t.asistentes.cese.documento_guardado}>
            {t.asistentes.cese.ver_documento_guardado}
          </Button>
        )}
      </>
    );
  }

  return (
    <div>
      <h2>{t.asistentes.tabs.historial_ceses}</h2>
      {errorDocumento && <Alert variant="error">{errorDocumento}</Alert>}
      <EstadoLista estado={estadoCeses} error={errorCeses} vacio={estadoCeses === 'listo' && ceses.length === 0} recargar={cargarCeses}>
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.asistentes.cese.fecha}</th>
              <th>{t.asistentes.cese.causal}</th>
              <th>{t.asistentes.cese.monto}</th>
              <th>{t.asistentes.cese.revisado_abogado}</th>
              <th>{t.asistentes.cese.documentos}</th>
            </tr>
          </thead>
          <tbody>
            {ceses.map((c) => (
              <tr key={c.id}>
                <td>{new Date(c.fecha_cese).toLocaleDateString()}</td>
                <td>{t.asistentes.causales[c.causal]}</td>
                <td>{formatearImporte(c.monto_total, c.moneda, locale)}</td>
                <td>
                  {c.revisado_por_abogado ? (
                    <span className={claseBadgeTono(TONO.EXITO)}>{t.comun.si}</span>
                  ) : (
                    <span className={claseBadgeTono(TONO.ATENCION)}>{t.comun.no}</span>
                  )}
                </td>
                <td>
                  <BotonesDeDocumento cese={c} tipo={TIPO_LIQUIDACION} etiqueta={t.asistentes.cese.descargar_liquidacion} />
                  {(CAUSALES_CON_TELEGRAMA.has(c.causal) || c.causal === 'periodo_de_prueba') && (
                    c.causal === 'periodo_de_prueba' ? (
                      <BotonesDeDocumento cese={c} tipo={TIPO_NOTIFICACION_PRUEBA} etiqueta={t.asistentes.cese.descargar_notificacion_prueba} />
                    ) : (
                      <BotonesDeDocumento cese={c} tipo={TIPO_TELEGRAMA} etiqueta={t.asistentes.cese.descargar_telegrama} />
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </EstadoLista>

      {asistente.estado === 'cesado' ? (
        <Alert variant="info">{t.asistentes.cese.ya_cesado}</Alert>
      ) : (
        <>
          <h2>{t.asistentes.tabs.registrar_cese}</h2>
          {/* El aviso va acá y no arriba de todo: en el historial los montos ya se liquidaron
              y no hay nada que confirmar; lo que todavía se puede confirmar es este cálculo. */}
          <AvisoEscalasProvisorias escalas={escalasCrudas} />
          {error && <Alert variant="error">{error}</Alert>}

          <FormField label={t.asistentes.cese.fecha} name="fecha_cese" type="date" value={fechaCese} onChange={(e) => { setFechaCese(e.target.value); setResultado(null); }} />
          <FormField label={t.asistentes.cese.causal} name="causal" type="select" value={causal} onChange={(e) => { setCausal(e.target.value); setResultado(null); }}>
            {CAUSALES.map((c) => (
              <option key={c} value={c}>{t.asistentes.causales[c]}</option>
            ))}
          </FormField>

          <Button variant="secondary" onClick={calcular} disabled={estadoEscalas !== 'listo' || estadoFormulas !== 'listo'}>
            {t.asistentes.cese.calcular}
          </Button>

          {resultado && (
            <div className="panel-resultado-calculo">
              <p><strong>{t.asistentes.cese.monto}:</strong> {resultado.montoTotal !== null ? formatearImporte(resultado.montoTotal, moneda, locale) : t.asistentes.cese.requiere_calculo_manual}</p>

              <details>
                <summary>{t.asistentes.cese.ver_detalle_calculo}</summary>
                <dl className="panel-detalle-lista">
                  {Object.entries(resultado.detalleCalculo).map(([clave, valor]) => (
                    <div key={clave} style={{ display: 'contents' }}>
                      <dt>{humanizarClave(clave)}</dt>
                      <dd>{formatearValorCalculo(valor, t)}</dd>
                    </div>
                  ))}
                </dl>
              </details>

              {resultado.advertencias.map((a, i) => (
                <Alert key={i} variant="info">{a}</Alert>
              ))}

              {resultado.requiereRevisionAbogado && (
                <FormField
                  label={t.asistentes.cese.revisado_abogado}
                  name="revisado_abogado"
                  type="checkbox"
                  checked={revisadoAbogado}
                  onChange={(e) => setRevisadoAbogado(e.target.checked)}
                />
              )}
              {resultado.requiereRevisionAbogado && !revisadoAbogado && (
                <Alert variant="error">{t.asistentes.cese.advertencia_requiere_abogado}</Alert>
              )}

              <Button
                onClick={confirmarCese}
                disabled={guardando || (resultado.requiereRevisionAbogado && !revisadoAbogado)}
              >
                {guardando ? t.comun.guardando : t.asistentes.cese.confirmar_boton}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
