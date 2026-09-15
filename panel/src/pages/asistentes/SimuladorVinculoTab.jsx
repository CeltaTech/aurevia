import { useEffect, useMemo, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { useMonedaActual } from '../../hooks/useMonedaActual';
import { useEscalasLegales } from '../../hooks/useEscalasLegales';
import { useFormulasCese } from '../../hooks/useFormulasCese';
import { resolverEscalasVigentes, resolverFormulasVigentes } from '../../lib/escalasLegales';
import { formatearImporte } from '../../lib/dinero';
import { calcularCese } from '../../lib/calcularCese';
import { llamarApiLiquidaciones } from '../../lib/apiLiquidaciones';
import { mensajeDeError } from '../../lib/errores';
import {
  asistenteBajoVinculo, costoMensualDelVinculo, escalasPorTipoALaFecha,
} from '../../lib/costoDelVinculo';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { Alert } from '../../components/ui/Alert';
import { AvisoEscalasProvisorias } from '../../components/AvisoEscalasProvisorias';

const ANTIGUEDADES_MESES = [3, 6, 12, 24];
const VINCULOS = ['monotributo', 'dependencia'];

function fechaAltaHace(meses, hoy) {
  const d = new Date(hoy);
  d.setMonth(d.getMonth() - meses);
  return d.toISOString().slice(0, 10);
}

// Nunca se inventa un valor_hora/sueldo_basico de referencia acá (CLAUDE.md: nunca hardcodear
// valores legales ni monetarios) — si el Asistente no tiene el dato de base cargado en su
// Perfil, la proyección para ese vínculo directamente no se puede calcular. Cómo queda esa
// persona bajo el otro vínculo lo decide `asistenteBajoVinculo`, que es el mismo punto único
// que usa la comparación mensual.
function proyectarCosto(asistenteBase, tipoVinculo, escalasResueltas, formulasResueltas, jurisdiccion, hoy) {
  const asistenteHipotetico = asistenteBajoVinculo(asistenteBase, tipoVinculo);
  const faltaDato = tipoVinculo === 'monotributo'
    ? asistenteHipotetico.valor_hora === null
    : asistenteHipotetico.sueldo_basico === null;

  return ANTIGUEDADES_MESES.map((meses) => {
    if (faltaDato) return { meses, montoDespidoSinCausa: null, faltaDato: true };
    const asistenteProyectado = { ...asistenteHipotetico, fecha_alta: fechaAltaHace(meses, hoy) };
    const r = calcularCese({
      asistente: asistenteProyectado, fechaCese: hoy, causal: 'despido_sin_causa',
      escalasLegales: escalasResueltas, jurisdiccion, formulasLegales: formulasResueltas,
    });
    return { meses, montoDespidoSinCausa: r.montoTotal, faltaDato: false };
  });
}

export function SimuladorVinculoTab({ asistente }) {
  const { t, locale } = useLocale();
  // Son proyecciones: no están guardadas y no traen moneda propia (regla 14, §7).
  const moneda = useMonedaActual();
  const { filas: escalasCrudas, estado: estadoEscalas, error: errorEscalas, recargar: recargarEscalas, jurisdiccion } = useEscalasLegales(asistente.prestadora_id);
  const { filas: formulasCrudas, estado: estadoFormulas, error: errorFormulas, recargar: recargarFormulas } = useFormulasCese(asistente.prestadora_id);
  const hoy = new Date().toISOString().slice(0, 10);

  // El catálogo de conceptos lo sirve el motor, porque lo que cobra una persona está detrás del
  // permiso de ver sus pagos. Quien no lo tenga ve el resto del Simulador igual: la proyección
  // del cese no depende de esto.
  const [conceptos, setConceptos] = useState([]);
  const [estadoConceptos, setEstadoConceptos] = useState('cargando');
  const [errorConceptos, setErrorConceptos] = useState(null);

  function cargarConceptos() {
    setEstadoConceptos('cargando');
    setErrorConceptos(null);
    llamarApiLiquidaciones('/conceptos')
      .then((datos) => {
        setConceptos((datos ?? []).filter((c) => c.activo));
        setEstadoConceptos('listo');
      })
      .catch((err) => {
        setErrorConceptos(mensajeDeError(err, t));
        setEstadoConceptos('error');
      });
  }

  useEffect(() => {
    cargarConceptos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const estado = estadoEscalas === 'error' || estadoFormulas === 'error'
    ? 'error'
    : (estadoEscalas === 'listo' && estadoFormulas === 'listo' ? 'listo' : 'cargando');
  const error = errorEscalas ?? errorFormulas;
  const recargar = () => { recargarEscalas(); recargarFormulas(); };

  const escalasResueltas = useMemo(
    () => (estado === 'listo' ? resolverEscalasVigentes(escalasCrudas, hoy, jurisdiccion) : null),
    [escalasCrudas, estado, jurisdiccion, hoy],
  );

  const proyecciones = useMemo(() => {
    if (!escalasResueltas) return null;
    const formulasResueltas = resolverFormulasVigentes(formulasCrudas, hoy, jurisdiccion);
    return {
      monotributo: proyectarCosto(asistente, 'monotributo', escalasResueltas, formulasResueltas, jurisdiccion, hoy),
      dependencia: proyectarCosto(asistente, 'dependencia', escalasResueltas, formulasResueltas, jurisdiccion, hoy),
    };
  }, [escalasResueltas, formulasCrudas, jurisdiccion, asistente, hoy]);

  // Lo que cuesta cada mes bajo cada vínculo, con el catálogo de conceptos de la Prestadora y
  // las escalas vigentes hoy. El período es el mes en curso: una proyección se hace con lo que
  // rige ahora, no con lo que regía en un mes cerrado.
  const mensual = useMemo(() => {
    if (!escalasResueltas || estadoConceptos !== 'listo') return null;
    const escalasPorTipo = escalasPorTipoALaFecha(escalasResueltas);
    const comun = { conceptos, escalasPorTipo, moneda, jurisdiccion, periodo: hoy.slice(0, 7) };
    return Object.fromEntries(
      VINCULOS.map((v) => [v, costoMensualDelVinculo({ asistenteBase: asistente, tipoVinculo: v, ...comun })]),
    );
  }, [escalasResueltas, estadoConceptos, conceptos, moneda, jurisdiccion, asistente, hoy]);

  // El mismo concepto se saltea en los dos vínculos, así que el aviso es del catálogo y se dice
  // una vez: repetirlo por columna haría parecer que son problemas distintos.
  const sinEscala = [...new Set(VINCULOS.flatMap((v) => mensual?.[v]?.sinEscala ?? []))];

  function celdaMensual(vinculo) {
    const r = mensual?.[vinculo];
    if (!r) return '—';
    if (r.faltaDato) return t.asistentes.simulador.falta_dato_base;
    return formatearImporte(r.costo, moneda, locale);
  }

  return (
    <div>
      <h2>{t.asistentes.simulador.titulo}</h2>
      <Alert variant="info">{t.asistentes.simulador.explicacion}</Alert>
      {/* Las proyecciones se calculan con estas escalas: el aviso va arriba de la tabla, no
          después, para que no se lea un número antes de saber de dónde sale. */}
      <AvisoEscalasProvisorias escalas={escalasCrudas} />

      <h3>{t.asistentes.simulador.costo_mensual}</h3>
      <Alert variant="info">{t.asistentes.simulador.costo_mensual_explicacion}</Alert>
      <EstadoLista
        estado={estado === 'listo' ? estadoConceptos : estado}
        error={error ?? errorConceptos}
        vacio={false}
        recargar={() => { recargar(); cargarConceptos(); }}
      >
        {mensual && (
          <>
            <table className="panel-tabla">
              <thead>
                <tr>
                  <th>{t.asistentes.simulador.concepto}</th>
                  <th>{t.asistentes.vinculo_monotributo}</th>
                  <th>{t.asistentes.vinculo_dependencia}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{t.asistentes.simulador.costo_mensual_total}</td>
                  <td>{celdaMensual('monotributo')}</td>
                  <td>{celdaMensual('dependencia')}</td>
                </tr>
              </tbody>
            </table>
            {conceptos.length === 0 && (
              <Alert variant="info">{t.asistentes.simulador.sin_conceptos}</Alert>
            )}
            {sinEscala.map((aviso) => (
              <Alert key={aviso} variant="info">{t.asistentes.simulador.concepto_sin_escala.replace('{detalle}', aviso)}</Alert>
            ))}
          </>
        )}
      </EstadoLista>

      <h3>{t.asistentes.simulador.costo_del_cese}</h3>
      <EstadoLista estado={estado} error={error} vacio={false} recargar={recargar}>
        {proyecciones && (
          <table className="panel-tabla">
            <thead>
              <tr>
                <th>{t.asistentes.simulador.antiguedad_hipotetica}</th>
                <th>{t.asistentes.vinculo_monotributo}</th>
                <th>{t.asistentes.vinculo_dependencia}</th>
              </tr>
            </thead>
            <tbody>
              {ANTIGUEDADES_MESES.map((meses, i) => (
                <tr key={meses}>
                  <td>{t.asistentes.simulador.meses.replace('{n}', meses)}</td>
                  <td>{proyecciones.monotributo[i].faltaDato ? t.asistentes.simulador.falta_dato_base : formatearImporte(proyecciones.monotributo[i].montoDespidoSinCausa, moneda, locale)}</td>
                  <td>{proyecciones.dependencia[i].faltaDato ? t.asistentes.simulador.falta_dato_base : formatearImporte(proyecciones.dependencia[i].montoDespidoSinCausa, moneda, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </EstadoLista>
    </div>
  );
}
