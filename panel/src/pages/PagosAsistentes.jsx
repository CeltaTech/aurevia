import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { useAuth } from '../context/AuthContext';
import { traducirValor } from '../i18n/valores';
import { supabase } from '../lib/supabaseClient';
import { finDeGuardia, horasDeGuardia } from '../lib/horarios';
import { claseBadgeTono, TONO } from '../lib/tonos';
import { useFiltros } from '../hooks/useFiltros';
import { EstadoLista } from '../components/layout/EstadoLista';
import { Alert } from '../components/ui/Alert';
import { mensajeDeError } from '../lib/errores';
import { formatearImporte } from '../lib/dinero';
import { CAMPOS_PAGO, conDatosAparte } from '../lib/fichaAsistente';

/* Lo que la Prestadora le paga al Asistente. Es la otra mitad del dinero: hasta ahora el
   Panel solo mostraba lo que se le cobra a la Familia (facturación, lista de precios,
   informes de obra social) y no había ninguna pantalla de este lado (pendiente #116).

   Tres cosas que esta pantalla NO hace, y que son decisiones, no olvidos:

   1. No guarda nada. En la base no existe ninguna tabla de pagos ni de liquidaciones, y
      `guardias` no tiene ninguna columna de importe. Así que esto es una cuenta hecha en
      el momento con lo que sí está guardado: las horas de las guardias cerradas y el valor
      hora / sueldo básico que tiene cargado cada Asistente en su ficha. Mientras no exista
      esa tabla, inventarle acá un "marcar como pagado" sería mentir: no habría dónde
      anotarlo.

   2. No calcula cargas sociales, adicionales, antigüedad, presentismo, ni descuentos.
      Ninguno de esos números está en el sistema, y la regla 10 de CLAUDE.md §7 prohíbe
      escribir a mano porcentajes o escalas legales. Un número inventado en una pantalla de
      sueldos es peor que no tener la pantalla.

   3. No suma horas × valor hora para todo el mundo. Quien está en relación de dependencia
      cobra su sueldo básico, que no depende de cuántas guardias hizo; para esa persona las
      horas son un control, no la cuenta. Confundir las dos cosas es exactamente el error
      que esta separación evita. */

// Las guardias que ya se cerraron son las únicas que se pagan: una guardia programada
// todavía no pasó, y una cancelada no se hizo.
const ESTADO_HECHA = 'completada';

// Las que ya deberían haber terminado y siguen abiertas. No se pagan —todavía no se sabe
// cuánto duraron de verdad— pero se cuentan aparte, porque si no el total del mes parece
// más chico de lo que va a ser y nadie entiende por qué.
const ESTADOS_SIN_CERRAR = ['programada', 'activa', 'pausada'];

function mesActual() {
  return new Date().toISOString().slice(0, 7);
}

function primerDia(mes) {
  return `${mes}-01`;
}

function ultimoDia(mes) {
  const [anio, m] = mes.split('-').map(Number);
  // El día 0 del mes siguiente es el último del mes pedido, sin tener que saber cuáles
  // tienen 30, 31 o 28 días.
  return new Date(Date.UTC(anio, m, 0)).toISOString().slice(0, 10);
}

function formatearHoras(valor) {
  return `${Math.round(valor * 10) / 10} h`;
}

/**
 * Si el vínculo de esa persona estaba en pie en algún momento del mes que se está mirando.
 *
 * Hace falta porque quien está en relación de dependencia cobra su sueldo aunque no haya
 * hecho ninguna guardia: sin este control, al retroceder a un mes anterior a su ingreso la
 * pantalla le mostraría un sueldo que nunca se le pagó. Las fechas son de tipo `date`, o sea
 * texto `AAAA-MM-DD`, que se compara igual que un número.
 */
function vinculoVigenteEnElMes(asistente, mes) {
  if (asistente.fecha_alta && asistente.fecha_alta > ultimoDia(mes)) return false;
  if (asistente.fecha_baja && asistente.fecha_baja < primerDia(mes)) return false;
  return true;
}

/**
 * El número de base de un Asistente, con la aclaración de qué es ese número.
 *
 * Cuando el dato no está cargado va una raya sola: "— por hora" se lee como si dijera algo
 * y no dice nada.
 */
function textoBase(asistente, t, moneda, locale) {
  const esSueldo = asistente.tipo_vinculo === 'dependencia';
  const valor = esSueldo ? asistente.sueldo_basico : asistente.valor_hora;
  if (valor === null || valor === undefined) return '—';
  const aclaracion = esSueldo ? t.pagos_asistentes.base_sueldo : t.pagos_asistentes.base_hora;
  return `${formatearImporte(valor, moneda, locale)} ${aclaracion}`;
}

/**
 * Lo que le corresponde a un Asistente en el mes, según su tipo de vínculo.
 *
 * Devuelve `null` cuando falta el dato de base en su ficha: no se estima, no se completa
 * con el de otro, no se pone cero. Un cero acá se lee como "no se le paga nada", que es
 * una afirmación distinta de "no sabemos cuánto".
 */
function calcularDelMes(asistente, horas) {
  if (asistente.tipo_vinculo === 'dependencia') {
    return asistente.sueldo_basico === null ? null : Number(asistente.sueldo_basico);
  }
  return asistente.valor_hora === null ? null : horas * Number(asistente.valor_hora);
}

export function PagosAsistentes() {
  const { t, locale } = useLocale();
  const { usuario } = useAuth();
  // Esta pantalla calcula en el momento y no guarda nada, así que el importe no trae
  // moneda propia: va la de la Prestadora (regla 14, §7).
  const moneda = usuario?.moneda ?? null;
  const [mes, setMes] = useState(mesActual());
  const [asistentes, setAsistentes] = useState([]);
  const [guardias, setGuardias] = useState([]);
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const { f, set, limpiar, hayFiltros } = useFiltros({ busqueda: '', vinculo: 'todos' });

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);

    const [{ data: gu, error: fallaGuardias }, { data: asis, error: fallaAsistentes }] = await Promise.all([
      supabase
        .from('guardias')
        .select('id, fecha, hora_inicio, hora_fin, estado, asistente_id')
        .gte('fecha', primerDia(mes))
        .lte('fecha', ultimoDia(mes))
        .not('asistente_id', 'is', null),
      supabase
        .from('asistentes')
        .select(`id, nombre, estado, tipo_vinculo, horas_semanales, fecha_alta, fecha_baja, ${CAMPOS_PAGO}`)
        .is('deleted_at', null)
        .order('nombre'),
    ]);

    if (fallaGuardias || fallaAsistentes) {
      setError(mensajeDeError(fallaGuardias ?? fallaAsistentes, t));
      setEstado('error');
      return;
    }

    setGuardias(gu ?? []);
    setAsistentes((asis ?? []).map(conDatosAparte));
    setEstado('listo');
  }, [mes, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  const filas = useMemo(() => {
    const ahora = new Date();
    const porAsistente = {};

    // ATENCIÓN antes de tocar este bucle: acá se cuenta UNA FILA POR GUARDIA, a propósito, y
    // no se cruza con la lista de Pacientes de cada guardia. Desde que una misma guardia puede
    // cubrir a varias personas (una sola guardia en una casa donde viven dos), la tentación es
    // "completar" esto uniéndolo con `guardia_pacientes`. No se hace: si se hiciera, una guardia
    // de ocho horas para dos Pacientes aparecería dos veces y el Asistente cobraría dieciséis
    // horas por ocho trabajadas.
    //
    // Al Asistente se le pagan las horas enteras, una sola vez, atienda a uno o a cinco. El
    // reparto entre Pacientes es otra cuenta distinta, la que va a los informes de la obra
    // social, y vive en `backend/src/utils/horasDeGuardia.js`.
    for (const g of guardias) {
      const acumulado = (porAsistente[g.asistente_id] ??= { guardias: 0, horas: 0, sinCerrar: 0 });
      if (g.estado === ESTADO_HECHA) {
        acumulado.guardias += 1;
        // Las horas salen de `horasDeGuardia`, que es el punto único de verdad para esto
        // (regla 12): una guardia de 22:00 a 06:00 cruza la medianoche, y restar las dos
        // horas de reloj da ocho horas negativas. Justo la guardia más común del rubro.
        acumulado.horas += horasDeGuardia(g);
      } else if (ESTADOS_SIN_CERRAR.includes(g.estado) && finDeGuardia(g) < ahora) {
        acumulado.sinCerrar += 1;
      }
    }

    // Aparece quien tuvo guardias en el mes —aunque después se haya dado de baja, porque
    // el trabajo que hizo se le paga igual— y también quien está activo sin haber tenido
    // ninguna, siempre que su vínculo estuviera en pie ese mes: el de dependencia cobra su
    // sueldo lo mismo y tiene que verse, pero no en los meses de antes de su ingreso.
    return asistentes
      .filter((a) => porAsistente[a.id] || (a.estado === 'activo' && vinculoVigenteEnElMes(a, mes)))
      .map((a) => {
        const acumulado = porAsistente[a.id] ?? { guardias: 0, horas: 0, sinCerrar: 0 };
        return { ...a, ...acumulado, delMes: calcularDelMes(a, acumulado.horas) };
      });
  }, [asistentes, guardias, mes]);

  const filasFiltradas = useMemo(() => {
    return filas.filter((a) => {
      if (f.vinculo !== 'todos' && a.tipo_vinculo !== f.vinculo) return false;
      if (!f.busqueda) return true;
      return a.nombre?.toLowerCase().includes(f.busqueda.toLowerCase());
    });
  }, [filas, f]);

  const resumen = useMemo(() => {
    return filasFiltradas.reduce(
      (acc, a) => ({
        horas: acc.horas + a.horas,
        guardias: acc.guardias + a.guardias,
        sinCerrar: acc.sinCerrar + a.sinCerrar,
        total: acc.total + (a.delMes ?? 0),
        sinDatoBase: acc.sinDatoBase + (a.delMes === null ? 1 : 0),
      }),
      { horas: 0, guardias: 0, sinCerrar: 0, total: 0, sinDatoBase: 0 },
    );
  }, [filasFiltradas]);

  return (
    <div>
      <h1>{t.pagos_asistentes.titulo}</h1>
      <p className="panel-explicacion">{t.pagos_asistentes.explicacion}</p>

      <Alert variant="info">
        <strong>{t.pagos_asistentes.aviso_titulo}.</strong> {t.pagos_asistentes.aviso_texto}
      </Alert>

      <div className="panel-filtros">
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          {t.pagos_asistentes.col_mes}
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value || mesActual())} />
        </label>
        <input
          type="text"
          placeholder={t.pagos_asistentes.buscar}
          value={f.busqueda}
          onChange={(e) => set('busqueda', e.target.value)}
        />
        <select value={f.vinculo} onChange={(e) => set('vinculo', e.target.value)}>
          <option value="todos">{t.pagos_asistentes.filtro_todos}</option>
          <option value="monotributo">{t.asistentes.vinculo_monotributo}</option>
          <option value="dependencia">{t.asistentes.vinculo_dependencia}</option>
        </select>
      </div>

      <EstadoLista
        estado={estado}
        error={error}
        vacio={estado === 'listo' && filasFiltradas.length === 0}
        recargar={recargar}
        filtrado={hayFiltros}
        onLimpiarFiltros={limpiar}
        mensajeVacio={filas.length === 0 ? t.pagos_asistentes.vacio_texto : undefined}
      >
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.pagos_asistentes.col_asistente}</th>
              <th>{t.pagos_asistentes.col_vinculo}</th>
              <th>{t.pagos_asistentes.col_guardias}</th>
              <th>{t.pagos_asistentes.col_horas}</th>
              <th>{t.pagos_asistentes.col_base}</th>
              <th>{t.pagos_asistentes.col_del_mes}</th>
              <th>{t.pagos_asistentes.col_sin_cerrar}</th>
            </tr>
          </thead>
          <tbody>
            {filasFiltradas.map((a) => (
              <tr key={a.id}>
                <td>{a.nombre}</td>
                <td>{traducirValor(t.asistentes, `vinculo_${a.tipo_vinculo}`)}</td>
                <td>{a.guardias}</td>
                <td>{formatearHoras(a.horas)}</td>
                {/* La base es distinta según el vínculo, y por eso se dice cuál es en cada
                    fila: quien está por monotributo cobra por hora, quien está en
                    dependencia cobra un sueldo que no se mueve con las horas. Si el dato
                    falta va una raya sola, sin la aclaración: "— por hora" no es media
                    respuesta, es una respuesta rara. */}
                <td>{textoBase(a, t, moneda, locale)}</td>
                <td>
                  {a.delMes === null ? (
                    <span className={claseBadgeTono(TONO.ATENCION)}>{t.pagos_asistentes.falta_dato_base}</span>
                  ) : (
                    formatearImporte(a.delMes, moneda, locale)
                  )}
                </td>
                <td>{a.sinCerrar > 0 ? a.sinCerrar : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}><strong>{t.pagos_asistentes.total}</strong></td>
              <td><strong>{resumen.guardias}</strong></td>
              <td><strong>{formatearHoras(resumen.horas)}</strong></td>
              <td></td>
              <td><strong>{formatearImporte(resumen.total, moneda, locale)}</strong></td>
              <td><strong>{resumen.sinCerrar > 0 ? resumen.sinCerrar : '—'}</strong></td>
            </tr>
          </tfoot>
        </table>

        {resumen.sinDatoBase > 0 && (
          <Alert variant="warning">
            {t.pagos_asistentes.aviso_falta_dato.replace('{n}', String(resumen.sinDatoBase))}
          </Alert>
        )}
        {resumen.sinCerrar > 0 && (
          <Alert variant="warning">
            {t.pagos_asistentes.aviso_sin_cerrar.replace('{n}', String(resumen.sinCerrar))}
          </Alert>
        )}
      </EstadoLista>
    </div>
  );
}
