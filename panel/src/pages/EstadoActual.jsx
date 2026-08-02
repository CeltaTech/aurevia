import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale } from '../i18n/LocaleContext';
import { supabase } from '../lib/supabaseClient';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { FranjaExcepciones } from '../components/estado-actual/FranjaExcepciones';
import { GrillaGuardias } from './guardias/GrillaGuardias';
import { BarraAccionesMasivas } from './guardias/BarraAccionesMasivas';
import { PanelCobertura } from './guardias/PanelCobertura';
import { GuardiaAcciones } from './guardias/GuardiaAcciones';
import { filtrarPorExcepcion } from '../lib/excepciones';
import { estaSinCubrir } from '../lib/cobertura';
import { reasignarGuardia } from '../lib/reasignarGuardia';
import { correrHora, hoyISO, sumarDias } from '../lib/horarios';
import { COLUMNAS_ESTADO_MATRICULA, URGENCIA, urgenciaDeVencimiento } from '../lib/matricula';

/* El Estado actual.
   ==========================================================================

   POR QUÉ EXISTE. La pantalla de entrada del Panel era un tablero: seis números que
   contaban cosas y no llevaban a ninguna parte. Contar no es el trabajo de una Prestadora;
   el trabajo es que no quede ningún Paciente sin nadie. Así que la pantalla de entrada
   ahora muestra el estado actual: arriba lo que está roto, abajo la semana entera, y todo lo de
   arriba lleva a lo de abajo con un solo clic.

   LA REGLA QUE ORDENA TODO. Cada contador de arriba usa exactamente la misma función para
   contar y para filtrar (`lib/excepciones.js`). Por eso el número del cartel y las guardias
   que aparecen abajo no pueden discrepar: es la misma pregunta hecha una sola vez.

   QUÉ CARGA ESTA PANTALLA Y QUÉ NO. Trae las guardias del rango, los nombres, los papeles
   por vencer y los reportes que faltan — lo que necesitan los siete contadores. Todo lo que
   hace falta solo para cubrir un hueco (matriculas, invitaciones ya hechas) lo carga el
   panel lateral cuando se abre, no antes: nadie tiene que pagar esa consulta por entrar. */

const API_URL = import.meta.env.VITE_API_URL;

/** Con cuántos días de anticipación avisa esta Prestadora si no se pudo averiguar. */
const DIAS_AVISO_POR_DEFECTO = 30;

/** Cuántos días muestra la pantalla de entrada: la semana que viene. */
const DIAS_A_LA_VISTA = 7;

/* Cuántos días para atrás también se traen.
   Tres de las siete excepciones miran al pasado, no al futuro: quien no llegó, quien no marcó
   la salida y la guardia terminada sin reporte. Si la ventana arrancara hoy, esas guardias se
   contarían en la franja de arriba —porque la excepción las encuentra— pero al tocar el
   contador la grilla quedaría vacía, y el número de arriba parecería mentira. Dos días cubren
   el fin de semana largo sin traer media base. */
const DIAS_HACIA_ATRAS = 2;

// Reutiliza el mismo endpoint que ya usa el tablero anterior — es la única fuente de verdad
// de "con cuánta anticipación avisa esta Prestadora" (regla 12).
async function obtenerDiasAvisoDocumentos() {
  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/configuracion/documentos-tipo`, {
    headers: { Authorization: `Bearer ${data.session?.access_token}` },
  });
  const resultado = await respuesta.json();
  if (!respuesta.ok) throw new Error(resultado.error);
  return resultado.dias_aviso_vencimiento_documentos;
}

export function EstadoActual() {
  const { t } = useLocale();

  const [estado, setEstado] = useState('cargando');
  const [error, setError] = useState(null);
  const [guardias, setGuardias] = useState([]);
  const [asistentes, setAsistentes] = useState([]);
  const [ctxExtra, setCtxExtra] = useState({
    asistentesConPapelPorVencer: new Set(),
    asistentesConPapelVencido: new Set(),
    guardiasSinReporte: new Set(),
    diasAviso: DIAS_AVISO_POR_DEFECTO,
    asistentesConMatriculaTrabada: new Set(),
    asistentesConMatriculaPorVencer: new Set(),
  });

  const [excepcionActiva, setExcepcionActiva] = useState(null);
  const [vista, setVista] = useState('asistente');
  const [zoom, setZoom] = useState('semana');
  const [diaElegido, setDiaElegido] = useState(() => hoyISO());
  const [seleccionadas, setSeleccionadas] = useState(() => new Set());
  const [huecoAbierto, setHuecoAbierto] = useState(null);
  const [detalleAbierto, setDetalleAbierto] = useState(null);

  const desde = useMemo(() => sumarDias(hoyISO(), -DIAS_HACIA_ATRAS), []);
  const hasta = useMemo(() => sumarDias(hoyISO(), DIAS_A_LA_VISTA - 1), []);

  const cargar = useCallback(async () => {
    setEstado('cargando');
    setError(null);

    // Los días de aviso vienen del backend y el backend puede no estar levantado. Que eso
    // pase no puede voltear la pantalla entera: se usa el valor por defecto y se sigue.
    let diasAviso = DIAS_AVISO_POR_DEFECTO;
    try {
      diasAviso = (await obtenerDiasAvisoDocumentos()) ?? DIAS_AVISO_POR_DEFECTO;
    } catch {
      diasAviso = DIAS_AVISO_POR_DEFECTO;
    }

    const limitePapeles = sumarDias(hoyISO(), diasAviso);

    const [gs, as, ps, ds, em] = await Promise.all([
      supabase
        .from('guardias')
        .select('*')
        .gte('fecha', desde)
        .lte('fecha', hasta)
        .order('fecha', { ascending: true })
        .order('hora_inicio', { ascending: true }),
      // Se piden más columnas que el nombre porque el panel de cobertura las necesita para
      // ordenar candidatos: `horas_semanales` es el tope propio de cada Asistente (el general
      // solo se usa si esa columna está vacía) y `estado` es lo que decide quién puede tomar
      // una guardia. Traerlas acá evita una segunda consulta al abrir cada hueco.
      supabase.from('asistentes').select('id, nombre, estado, horas_semanales'),
      supabase.from('pacientes').select('id, nombre'),
      supabase
        .from('documentos_asistente')
        .select('asistente_id, fecha_vencimiento')
        .not('fecha_vencimiento', 'is', null)
        .lte('fecha_vencimiento', limitePapeles),
      // La vista contesta de una sola vez si cada Asistente está trabado y cuánto le falta a su
      // matrícula. El motivo lo decide la base, no esta pantalla: acá solo se lee.
      supabase.from('estado_matricula_asistente').select(COLUMNAS_ESTADO_MATRICULA),
    ]);

    if (gs.error) {
      setError(gs.error.message);
      setEstado('error');
      return;
    }

    const nombresAsistente = Object.fromEntries((as.data ?? []).map((a) => [a.id, a.nombre]));
    const nombresPaciente = Object.fromEntries((ps.data ?? []).map((p) => [p.id, p.nombre]));

    const filas = (gs.data ?? []).map((g) => ({
      ...g,
      asistente_nombre: nombresAsistente[g.asistente_id] ?? null,
      paciente_nombre: nombresPaciente[g.paciente_id] ?? null,
    }));

    // Dos conjuntos, no uno: un papel que ya venció es rojo y uno que está por vencer es
    // naranja. Meterlos en la misma bolsa haría que el contador no pudiera distinguirlos.
    const hoy = hoyISO();
    const porVencer = new Set();
    const vencidos = new Set();
    for (const d of ds.data ?? []) {
      if (d.fecha_vencimiento < hoy) vencidos.add(d.asistente_id);
      else porVencer.add(d.asistente_id);
    }

    // Los reportes que faltan solo tienen sentido sobre guardias ya terminadas: se pregunta
    // por esas y nada más, en vez de traer todos los reportes de la Prestadora.
    const completadas = filas.filter((g) => g.estado === 'completada').map((g) => g.id);
    let sinReporte = new Set();
    if (completadas.length > 0) {
      const { data: reportes } = await supabase
        .from('reportes')
        .select('guardia_id')
        .in('guardia_id', completadas);
      const conReporte = new Set((reportes ?? []).map((r) => r.guardia_id));
      sinReporte = new Set(completadas.filter((id) => !conReporte.has(id)));
    }

    // Dos conjuntos otra vez, por el mismo motivo que los papeles: trabado es rojo y por vencer
    // es naranja. La ventana de aviso es la misma que la de los documentos — una sola perilla
    // para los dos vencimientos, no dos que se separen con el tiempo.
    const matriculaTrabada = new Set();
    const matriculaPorVencer = new Set();
    for (const fila of em.data ?? []) {
      if (fila.motivo_bloqueo) {
        matriculaTrabada.add(fila.asistente_id);
        continue;
      }
      if (fila.requiere_matricula !== true) continue;
      const urgencia = urgenciaDeVencimiento(fila.dias_para_vencer, diasAviso);
      if (urgencia !== URGENCIA.NINGUNA) matriculaPorVencer.add(fila.asistente_id);
    }

    setGuardias(filas);
    setAsistentes(as.data ?? []);
    setCtxExtra({
      asistentesConPapelPorVencer: porVencer,
      asistentesConPapelVencido: vencidos,
      guardiasSinReporte: sinReporte,
      diasAviso,
      asistentesConMatriculaTrabada: matriculaTrabada,
      asistentesConMatriculaPorVencer: matriculaPorVencer,
    });
    setEstado('listo');
  }, [desde, hasta]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  // El reloj entra en el contexto una sola vez por carga, a propósito: si cada cálculo
  // preguntara la hora por su cuenta, dos contadores de la misma pantalla podrían estar
  // mirando momentos distintos y contradecirse.
  const ctx = useMemo(() => ({ ahora: new Date(), ...ctxExtra }), [ctxExtra]);

  const guardiasVisibles = useMemo(
    () => filtrarPorExcepcion(guardias, excepcionActiva, ctx),
    [guardias, excepcionActiva, ctx]
  );

  const seleccionadasEnteras = useMemo(
    () => guardias.filter((g) => seleccionadas.has(g.id)),
    [guardias, seleccionadas]
  );

  // La grilla manda la guardia entera, no el id: acá se guarda solo el id, porque una guardia
  // que se recarga desde la base es un objeto nuevo y la selección se perdería sola.
  function alternarSeleccion(guardia) {
    const id = guardia?.id ?? guardia;
    setSeleccionadas((previas) => {
      const nuevas = new Set(previas);
      if (nuevas.has(id)) nuevas.delete(id);
      else nuevas.add(id);
      return nuevas;
    });
  }

  function abrirGuardia(g) {
    // Un hueco abre el panel para cubrirlo; una guardia que ya tiene Asistente abre su
    // detalle. Es la misma acción del usuario —tocar una guardia— y el sistema hace lo
    // único que tiene sentido en cada caso, en vez de pedirle que elija de un menú.
    if (estaSinCubrir(g)) setHuecoAbierto(g);
    else setDetalleAbierto(g);
  }

  // El detalle de una guardia es el mismo cuadro que usa la pantalla de Guardias, no una
  // copia: registrar la llegada, marcar ausente o cancelar con su motivo se hacen igual desde
  // los dos lados, y una sola versión de ese cuadro es una sola versión de esas reglas.
  async function reasignarUna(guardiaId, asistenteId, fecha) {
    const g = guardias.find((x) => x.id === guardiaId);
    if (!g) return;
    const { error: falla } = await reasignarGuardia(g, asistenteId, fecha, t.matricula);
    if (falla) {
      setError(falla);
      return;
    }
    cargar();
  }

  async function moverGuardia({ guardiaId, fila, fecha, vista: vistaDelMovimiento, horaInicio, horaFin }) {
    const g = guardias.find((x) => x.id === guardiaId);
    if (!g) return;

    const cambios = { fecha };
    // La vista viene con el movimiento, no se lee del estado de esta pantalla: la grilla
    // puede estar mostrando otra cosa de la que esta pantalla cree si nadie la controla, y
    // confundir Asistente con Paciente acá guardaría la guardia en la fila equivocada.
    if ((vistaDelMovimiento ?? vista) === 'asistente') cambios.asistente_id = fila;
    else cambios.paciente_id = fila;

    // Solo la vista de línea de tiempo manda horas: ahí la posición horizontal ES la hora.
    // En las otras, mover una guardia de una fila a otra no le toca el horario. Las dos
    // horas vienen ya calculadas por la grilla, que es la única que sabe cuánto duraba.
    if (horaInicio && horaFin) {
      cambios.hora_inicio = horaInicio;
      cambios.hora_fin = horaFin;
    }

    if (cambios.asistente_id && g.ofrecida_at) {
      cambios.ofrecida_at = null;
      cambios.ofrecida_por = null;
      cambios.oferta_limite_at = null;
    }

    const { error: falla } = await supabase.from('guardias').update(cambios).eq('id', guardiaId);
    if (falla) {
      setError(falla.message);
      return;
    }
    cargar();
  }

  async function aplicarAMuchas({ accion, asistenteId, minutos, semanas, origen, alcance }) {
    let ok = 0;
    const total = seleccionadasEnteras.length;

    for (const g of seleccionadasEnteras) {
      let resultado;
      if (accion === 'reasignar') {
        const cambios = { asistente_id: asistenteId };
        if (g.ofrecida_at) {
          cambios.ofrecida_at = null;
          cambios.ofrecida_por = null;
          cambios.oferta_limite_at = null;
        }
        resultado = await supabase.from('guardias').update(cambios).eq('id', g.id);
      } else if (accion === 'correr') {
        resultado = await supabase
          .from('guardias')
          .update({
            hora_inicio: correrHora(g.hora_inicio, minutos),
            hora_fin: correrHora(g.hora_fin, minutos),
          })
          .eq('id', g.id);
      } else if (accion === 'cancelar') {
        resultado = await supabase
          .from('guardias')
          .update({ estado: 'cancelada', cancelacion_origen: origen, cancelacion_alcance: alcance })
          .eq('id', g.id);
      } else if (accion === 'duplicar') {
        // Se copia la guardia sin lo que es propio de ESA guardia y no de su copia: la
        // identidad, cuándo se creó y los dos nombres que esta pantalla le pegó encima y
        // que no son columnas de la base.
        const {
          id: _id,
          created_at: _creada,
          asistente_nombre: _nombreAsistente,
          paciente_nombre: _nombrePaciente,
          ...resto
        } = g;
        resultado = await supabase.from('guardias').insert({
          ...resto,
          fecha: sumarDias(g.fecha, semanas * 7),
          estado: 'programada',
          checkin_at: null,
          checkout_at: null,
        });
      }
      if (!resultado?.error) ok += 1;
    }

    setSeleccionadas(new Set());
    cargar();
    // Se devuelve cuántas salieron de cuántas. Que algunas fallen es un resultado normal
    // —un Asistente puede estar ocupado en tres de las cuatro fechas— y la barra lo dice
    // tal cual en vez de mostrar un "listo" que sería mentira.
    return { ok, total };
  }

  return (
    <div>
      <h1>{t.estado_actual.titulo}</h1>
      <p className="panel-lateral-subtitulo">{t.estado_actual.subtitulo}</p>

      {error && <Alert variant="error">{error}</Alert>}

      {estado === 'cargando' && <p className="estado-cargando">{t.comun.cargando}</p>}

      {estado === 'error' && (
        <Alert variant="error">
          {error || t.comun.error_generico}{' '}
          <Button variant="secondary" onClick={cargar}>
            {t.comun.reintentar}
          </Button>
        </Alert>
      )}

      {estado === 'listo' && (
        <>
          <FranjaExcepciones
            guardias={guardias}
            ctx={ctx}
            excepcionActiva={excepcionActiva}
            onElegir={setExcepcionActiva}
          />

          <GrillaGuardias
            guardias={guardiasVisibles}
            desde={desde}
            hasta={hasta}
            vista={vista}
            onVista={setVista}
            zoom={zoom}
            onZoom={setZoom}
            diaElegido={diaElegido}
            onDiaElegido={setDiaElegido}
            ctx={ctx}
            seleccionadas={seleccionadas}
            onAlternarSeleccion={alternarSeleccion}
            onAbrir={abrirGuardia}
            onMover={moverGuardia}
          />

          <BarraAccionesMasivas
            seleccionadas={seleccionadasEnteras}
            asistentes={asistentes}
            onAplicar={aplicarAMuchas}
            onLimpiar={() => setSeleccionadas(new Set())}
          />

          {huecoAbierto && (
            <PanelCobertura
              guardia={huecoAbierto}
              asistentes={asistentes}
              onCerrar={() => setHuecoAbierto(null)}
              onHecho={() => {
                setHuecoAbierto(null);
                cargar();
              }}
            />
          )}

          {detalleAbierto && (
            <GuardiaAcciones
              guardia={detalleAbierto}
              asistentes={asistentes}
              onReasignar={reasignarUna}
              onClose={() => setDetalleAbierto(null)}
              onActualizada={cargar}
            />
          )}
        </>
      )}
    </div>
  );
}
