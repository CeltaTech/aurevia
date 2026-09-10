import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../../i18n/LocaleContext';
import { supabase } from '../../lib/supabaseClient';
import { mensajeDeError } from '../../lib/errores';
import { claseBadge, claseBadgeTono } from '../../lib/tonos';
import { hoyISO } from '../../lib/horarios';
import { con } from '../../lib/textos';
import { EstadoLista } from '../../components/layout/EstadoLista';
import { usePrestadoraActual } from '../../hooks/usePrestadoraActual';
import {
  cargarGuardiasDePacientes,
  cargarPacientesDeGuardias,
  conPacientes,
  textoDePacientes,
} from '../../lib/pacientesDeGuardia';
import { SITUACION, situacionDeGuardia, tonoDeGuardia } from '../../lib/semaforoGuardia';
import { armarBuscadorDeRangos, tieneSignoFueraDeRango } from '../../lib/signosVitales';

/* Lo que le está pasando a los Pacientes de una Familia: guardias, reportes y alertas.
   ==========================================================================

   Los tres datos ya existen y ya se muestran en otras pantallas del Panel —Guardias, Reportes
   y Alertas—. Acá no se inventa ninguna consulta nueva: se hacen las mismas preguntas,
   acotadas a los Pacientes de esta Familia, y se muestran con los mismos encabezados y los
   mismos carteles de estado. Si mañana cambia cómo se lee una alerta, cambia en un solo lugar
   y esta ficha cambia con ella.

   Las tres secciones viven en este archivo y no adentro de `FamiliaDetalle.jsx` porque cada
   una trae sus propios datos y tiene sus propios cuatro estados: metidas en la ficha serían
   nueve variables de estado más en un componente que ya es largo.

   Por qué reciben los Pacientes por parámetro y no el id de la Familia: la ficha ya los tiene
   cargados, con nombre y todo. Volver a pedirlos sería una consulta de más y, peor, abriría la
   posibilidad de que las dos listas no coincidan. */

/* Cuántas filas como mucho. Una Familia con guardias generadas por serie puede tener cientos
   programadas por delante, y un año de guardias son cientos de reportes: esto es una ficha, no
   la pantalla de Guardias ni la de Reportes. Cuando se llega al tope se avisa, que es lo que
   evita que alguien crea que está viendo todo. */
const TOPE_GUARDIAS = 50;
const TOPE_REPORTES = 30;

/* Las columnas de `guardias` que hacen falta. Las cinco últimas no se muestran: las necesita
   `situacionDeGuardia` para decidir en qué situación está la guardia ahora. Si alguna faltara,
   la situación saldría mal sin que nada avise —una guardia en curso se leería como programada—,
   así que están todas juntas acá con este comentario al lado. */
const COLUMNAS_GUARDIA =
  'id, fecha, hora_inicio, hora_fin, paciente_id, asistentes(nombre), estado, asistente_id, ofrecida_at, oferta_limite_at, checkin_at, checkout_at';

/* "Activa" es la guardia que todavía espera algo. La completada y la cancelada ya no esperan
   nada; la ausente sí, porque alguien tiene que cubrir ese turno. */
const CERRADAS = new Set([SITUACION.COMPLETADA, SITUACION.CANCELADA]);

/**
 * Los cuatro estados de una de estas secciones, en un solo lugar.
 *
 * `cargar` devuelve `{ filas, tope }` y este enganche se ocupa del resto: mientras corre el
 * estado es "cargando", si levanta un error queda "error" con el texto ya traducido, y si
 * termina bien queda "listo". Ninguna de las tres secciones vuelve a escribir esto.
 */
function useSeccion(cargar) {
  const { t } = useLocale();
  const [datos, setDatos] = useState({ filas: [], tope: false });
  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);

  const recargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);
    try {
      setDatos(await cargar());
      setEstado('listo');
    } catch (err) {
      setError(mensajeDeError(err, t));
      setEstado('error');
    }
  }, [cargar, t]);

  useEffect(() => {
    recargar();
  }, [recargar]);

  return { datos, estado, error, recargar };
}

/** Los ids de los Pacientes de la Familia, y sus nombres a mano. */
function idsDe(pacientes) {
  return (pacientes ?? []).map((p) => p.id).filter(Boolean);
}

function nombresDe(pacientes) {
  return Object.fromEntries((pacientes ?? []).map((p) => [p.id, p.nombre]));
}

/* Las guardias que le quedan por delante a la Familia.
   ==========================================================================

   Se piden desde hoy en adelante y se descartan las que ya no esperan nada. La situación de
   cada una sale del semáforo (`lib/semaforoGuardia.js`), el mismo que pinta la grilla de
   Guardias: no se vuelve a decidir acá qué significa cada estado. */
export function GuardiasActivasDeLaFamilia({ pacientes }) {
  const { t } = useLocale();

  const cargar = useCallback(async () => {
    const ids = idsDe(pacientes);
    if (ids.length === 0) return { filas: [], tope: false };

    const desde = hoyISO();
    const guardias = await cargarGuardiasDePacientes(ids, COLUMNAS_GUARDIA, (consulta) =>
      consulta
        .gte('fecha', desde)
        .order('fecha', { ascending: true })
        .order('hora_inicio', { ascending: true })
        .limit(TOPE_GUARDIAS),
    );

    const activas = guardias
      .filter((g) => !CERRADAS.has(situacionDeGuardia(g)))
      // Los dos caminos de `cargarGuardiasDePacientes` llegan mezclados, así que el orden se
      // rehace acá: primero la más próxima, que es lo que se quiere ver de un vistazo.
      .sort((a, b) => `${a.fecha} ${a.hora_inicio}`.localeCompare(`${b.fecha} ${b.hora_inicio}`))
      .slice(0, TOPE_GUARDIAS);

    // A quiénes atiende cada guardia. Sólo se ponen los nombres de esta Familia: si un turno
    // cubre además a alguien de otra casa, esa persona no es asunto de esta ficha.
    const porGuardia = await cargarPacientesDeGuardias(activas.map((g) => g.id));
    const filas = conPacientes(activas, porGuardia, nombresDe(pacientes)).map((g) => ({
      ...g,
      asistente_nombre: g.asistentes?.nombre || '—',
      situacion: situacionDeGuardia(g),
      tono: tonoDeGuardia(g),
    }));

    return { filas, tope: filas.length === TOPE_GUARDIAS };
  }, [pacientes]);

  const { datos, estado, error, recargar } = useSeccion(cargar);

  return (
    <EstadoLista
      estado={estado}
      error={error}
      vacio={estado === 'listo' && datos.filas.length === 0}
      recargar={recargar}
      mensajeVacio={t.familias.guardias_vacio}
      ayudaVacio={t.familias.guardias_vacio_ayuda}
    >
      <>
        {datos.tope && (
          <p className="panel-explicacion">{con(t.familias.guardias_tope, { n: TOPE_GUARDIAS })}</p>
        )}
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.familias.guardias_col_fecha}</th>
              <th>{t.familias.guardias_col_horario}</th>
              <th>{t.familias.guardias_col_paciente}</th>
              <th>{t.familias.guardias_col_asistente}</th>
              <th>{t.familias.guardias_col_situacion}</th>
            </tr>
          </thead>
          <tbody>
            {datos.filas.map((g) => (
              <tr key={g.id}>
                <td>{g.fecha}</td>
                <td>
                  {g.hora_inicio} – {g.hora_fin}
                </td>
                <td>{textoDePacientes(g.pacientes_nombres, t.guardias.pacientes_y_mas)}</td>
                <td>{g.asistente_nombre}</td>
                <td>
                  <span className={claseBadgeTono(g.tono)}>{t.guardias.situacion[g.situacion]}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    </EstadoLista>
  );
}

/* Los reportes de los Pacientes de la Familia.
   ==========================================================================

   Es la consulta de la pantalla de Reportes acotada a estos Pacientes y sin rango de fechas:
   acá lo que se busca es el historial, no un período. Los rangos de referencia de signos
   vitales se piden igual que allá, porque "fuera de rango" depende de cuál es el rango normal
   de esa persona y no de un número general. */
export function ReportesDeLaFamilia({ pacientes }) {
  const { t } = useLocale();
  const prestadoraId = usePrestadoraActual();

  const cargar = useCallback(async () => {
    const ids = idsDe(pacientes);
    if (ids.length === 0) return { filas: [], tope: false };

    const [{ data, error: errorReportes }, { data: rangosData }] = await Promise.all([
      supabase
        .from('reportes')
        .select(
          'id, created_at, paciente_id, estado_animo, signos_vitales, incidentes, confirmado_asistente, guardias(fecha, asistentes(nombre))',
        )
        .in('paciente_id', ids)
        .order('created_at', { ascending: false })
        .limit(TOPE_REPORTES),
      supabase
        .from('rangos_referencia_vitales')
        .select('signo, paciente_id, valor_min, valor_max, unidad')
        .eq('prestadora_id', prestadoraId),
    ]);

    if (errorReportes) throw errorReportes;

    const buscador = armarBuscadorDeRangos(rangosData);
    const nombres = nombresDe(pacientes);
    const filas = (data ?? []).map((r) => ({
      ...r,
      paciente_nombre: nombres[r.paciente_id] || '—',
      asistente_nombre: r.guardias?.asistentes?.nombre || '—',
      // La fecha del reporte es la de su guardia. Si el reporte no cuelga de ninguna, se cae al
      // día en que se escribió, que es lo único que se sabe.
      fecha: r.guardias?.fecha ?? r.created_at?.slice(0, 10),
      fuera_de_rango: tieneSignoFueraDeRango(r.signos_vitales, r.paciente_id, buscador),
    }));

    return { filas, tope: filas.length === TOPE_REPORTES };
  }, [pacientes, prestadoraId]);

  const { datos, estado, error, recargar } = useSeccion(cargar);

  return (
    <EstadoLista
      estado={estado}
      error={error}
      vacio={estado === 'listo' && datos.filas.length === 0}
      recargar={recargar}
      mensajeVacio={t.familias.reportes_vacio}
      ayudaVacio={t.familias.reportes_vacio_ayuda}
    >
      <>
        {datos.tope && (
          <p className="panel-explicacion">{con(t.familias.reportes_tope, { n: TOPE_REPORTES })}</p>
        )}
        <table className="panel-tabla">
          <thead>
            <tr>
              <th>{t.reportes.col_fecha}</th>
              <th>{t.reportes.col_paciente}</th>
              <th>{t.reportes.col_asistente}</th>
              <th>{t.reportes.col_animo}</th>
              <th>{t.reportes.col_senales}</th>
            </tr>
          </thead>
          <tbody>
            {datos.filas.map((r) => (
              <tr key={r.id}>
                <td>{r.fecha}</td>
                <td>{r.paciente_nombre}</td>
                <td>{r.asistente_nombre}</td>
                <td>{r.estado_animo ? t.reportes[`animo_${r.estado_animo}`] : '—'}</td>
                <td>
                  {r.incidentes && <span className="badge badge-critico">{t.reportes.senal_incidente}</span>}
                  {r.fuera_de_rango && <span className="badge badge-atencion">{t.reportes.senal_fuera_rango}</span>}
                  {!r.confirmado_asistente && <span className="badge">{t.reportes.senal_sin_confirmar}</span>}
                  {!r.incidentes && !r.fuera_de_rango && r.confirmado_asistente && t.reportes.sin_novedades}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </>
    </EstadoLista>
  );
}

/* Las alertas todavía abiertas de los Pacientes de la Familia.
   ==========================================================================

   Es la consulta de la pantalla de Alertas con el filtro de "pendientes" puesto y acotada a
   estos Pacientes. Acá no hay tope: esconder una alerta sin resolver es justamente lo que no
   puede pasar. Y se ordenan por fecha y no por gravedad, para no escribir por segunda vez el
   orden de gravedad que ya vive en la pantalla de Alertas; el color de cada nivel sale del
   mismo lugar de siempre. */
export function AlertasDeLaFamilia({ pacientes }) {
  const { t } = useLocale();

  const cargar = useCallback(async () => {
    const ids = idsDe(pacientes);
    if (ids.length === 0) return { filas: [], tope: false };

    const { data, error: errorAlertas } = await supabase
      .from('alertas')
      .select('id, created_at, nivel, descripcion, paciente_id')
      .in('paciente_id', ids)
      .eq('resuelta', false)
      .order('created_at', { ascending: false });

    if (errorAlertas) throw errorAlertas;

    const nombres = nombresDe(pacientes);
    return {
      filas: (data ?? []).map((a) => ({ ...a, paciente_nombre: nombres[a.paciente_id] || '—' })),
      tope: false,
    };
  }, [pacientes]);

  const { datos, estado, error, recargar } = useSeccion(cargar);

  return (
    <EstadoLista
      estado={estado}
      error={error}
      vacio={estado === 'listo' && datos.filas.length === 0}
      recargar={recargar}
      mensajeVacio={t.familias.alertas_vacio}
      ayudaVacio={t.familias.alertas_vacio_ayuda}
    >
      <table className="panel-tabla">
        <thead>
          <tr>
            <th>{t.alertas.col_fecha}</th>
            <th>{t.alertas.col_paciente}</th>
            <th>{t.alertas.col_nivel}</th>
            <th>{t.alertas.col_descripcion}</th>
          </tr>
        </thead>
        <tbody>
          {datos.filas.map((a) => (
            <tr key={a.id}>
              <td>{a.created_at?.slice(0, 10)}</td>
              <td>{a.paciente_nombre}</td>
              <td>
                <span className={claseBadge(a.nivel)}>{t.alertas[`nivel_${a.nivel}`] ?? a.nivel}</span>
              </td>
              <td>{a.descripcion || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </EstadoLista>
  );
}
