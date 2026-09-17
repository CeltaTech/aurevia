import { supabase } from '../db/connection.js';
import { notificarCoordinador } from './whatsapp.js';
import { necesitaNotificar } from './insistencia.js';
import { pacientesDeGuardias } from './pacientesDeGuardia.js';
import { aviso } from '../i18n/avisos.js';
import { idiomaDeLaPrestadora } from '../i18n/idiomaDeLaPrestadora.js';
import {
  COMO_LLEGO,
  REGLA_QUE_SE_PUEDE_TOCAR,
  comoLlegoLaAusencia,
  reglaDeAvisoDe,
} from './avisoDeAusencia.js';

// Aviso a la Coordinadora cuando falta un Asistente, y distinto según cómo llegó la falta.
//
// POR QUÉ NO ALCANZABA CON LO QUE YA HABÍA. El aviso de guardia sin cubrir mira los turnos que no
// tienen a nadie asignado. Un turno cuya Asistente está de licencia sigue teniéndola asignada: la
// falta está en la ausencia, no en el turno, y por eso ese proceso no lo ve. Este es el que lo ve.
//
// LAS DOS CLASES SON DOS TRABAJOS DISTINTOS. La que avisó con margen es una tarea para cuando se
// pueda y se dice una sola vez. La que deja un turno que empieza enseguida es una alarma y se
// repite cada tantas horas mientras siga sin resolverse. Los dos números los decide cada
// Prestadora; los de fábrica están en `avisoDeAusencia.js` y no se escriben acá.
//
// Y LA CLASE NO SE GUARDA: SE RECALCULA EN CADA VUELTA. Mide con cuánto margen llegó el aviso, así
// que no cambia sola con el reloj, pero sí cambia si se corrige cuándo se supo, si aparece un turno
// más cercano o si la Prestadora corre el número. Cuando cambia se avisa de nuevo aunque no haya
// pasado el intervalo: dejó de ser el mismo problema.
//
// Entra con la llave de servicio, que se saltea la protección por fila, porque recorre todas las
// Prestadoras y acá no hay ninguna sesión de Panel abierta. Mismo criterio que
// `revisarGuardiasSinCubrir.js`.

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Cuánto se sigue avisando una ausencia después del turno que dejó sin nadie. No es una regla de
// negocio sino el borde de la ventana: pasado un día ese turno ya no se puede tapar y el aviso
// sería ruido. Es el mismo día del turno sin cubrir, a propósito.
const DIAS_HACIA_ATRAS = 1;

// Hasta dónde se mira hacia adelante al traer las filas. Es el máximo que una Prestadora puede
// configurar: más lejos que eso no hay ninguna que quiera enterarse todavía. El recorte fino lo
// hace después la regla de cada una.
const DIAS_HACIA_ADELANTE = Math.ceil(REGLA_QUE_SE_PUEDE_TOCAR.horas_para_considerarla_con_tiempo.maximo / 24);

const EVENTO_POR_CLASE = {
  [COMO_LLEGO.CON_TIEMPO]: 'ausencia_avisada_con_tiempo',
  [COMO_LLEGO.DE_GOLPE]: 'ausencia_de_golpe',
};

export async function revisarAusenciasAvisadas() {
  const ahora = new Date();
  const desde = fechaISO(new Date(ahora.getTime() - DIAS_HACIA_ATRAS * MS_POR_DIA));
  const hasta = fechaISO(new Date(ahora.getTime() + DIAS_HACIA_ADELANTE * MS_POR_DIA));

  // Las que todavía pueden dejar un turno sin nadie: empezaron o empiezan dentro de la ventana, y
  // no terminaron antes de ayer. Una licencia sin fecha de vuelta sigue vigente siempre.
  const { data: ausencias, error } = await supabase
    .from('ausencias')
    .select('id, prestadora_id, asistente_id, fecha_inicio, fecha_fin, avisada_en, created_at, aviso_ausencia_at, aviso_ausencia_veces, aviso_ausencia_clase')
    .lte('fecha_inicio', hasta)
    .or(`fecha_fin.is.null,fecha_fin.gte.${desde}`);

  if (error) {
    console.error('Error consultando ausencias para avisar:', error.message);
    return;
  }
  if (!ausencias?.length) return;

  const porPrestadora = new Map();
  for (const ausencia of ausencias) {
    if (!ausencia.prestadora_id || !ausencia.asistente_id) continue;
    if (!porPrestadora.has(ausencia.prestadora_id)) porPrestadora.set(ausencia.prestadora_id, []);
    porPrestadora.get(ausencia.prestadora_id).push(ausencia);
  }

  for (const [prestadoraId, suyas] of porPrestadora) {
    await revisarPrestadora({ prestadoraId, ausencias: suyas, desde, hasta, ahora });
  }
}

async function revisarPrestadora({ prestadoraId, ausencias, desde, hasta, ahora }) {
  // Sin fila de configuración corren los valores de fábrica: que una Prestadora no haya tocado
  // nada no puede dejarla sin avisos.
  const { data: configuracion, error: errorConfig } = await supabase
    .from('configuracion_ausencias')
    .select('regla')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  if (errorConfig) {
    console.error(`Error leyendo la configuracion de ausencias (prestadora ${prestadoraId}):`, errorConfig.message);
    return;
  }

  const regla = reglaDeAvisoDe(configuracion?.regla);
  // Una sola vez por Prestadora: todos los avisos de esta vuelta los lee la misma gente.
  const idioma = await idiomaDeLaPrestadora(prestadoraId);

  const asistentes = [...new Set(ausencias.map((a) => a.asistente_id))];
  const { data: guardias, error: errorGuardias } = await supabase
    .from('guardias')
    .select('id, asistente_id, paciente_id, fecha, hora_inicio, hora_fin, estado')
    .eq('prestadora_id', prestadoraId)
    .in('asistente_id', asistentes)
    .eq('estado', 'programada')
    .gte('fecha', desde)
    .lte('fecha', hasta);

  if (errorGuardias) {
    console.error(`Error consultando las guardias de los ausentes (prestadora ${prestadoraId}):`, errorGuardias.message);
    return;
  }

  const guardiasPorAsistente = new Map();
  for (const guardia of guardias ?? []) {
    if (!guardiasPorAsistente.has(guardia.asistente_id)) guardiasPorAsistente.set(guardia.asistente_id, []);
    guardiasPorAsistente.get(guardia.asistente_id).push(guardia);
  }

  // Los nombres de los Pacientes que se quedan sin atender. Se piden todos los del turno y no uno:
  // de ese tamaño depende con qué urgencia sale la Coordinadora a taparlo.
  let pacientesPorGuardia;
  try {
    pacientesPorGuardia = await pacientesDeGuardias(guardias ?? [], 'id, nombre');
  } catch (e) {
    console.error(`Error leyendo los Pacientes de las guardias de los ausentes (prestadora ${prestadoraId}):`, e.message);
    return;
  }

  const nombres = await nombresDeAsistentes(asistentes, prestadoraId);

  for (const ausencia of ausencias) {
    const { como, horas, primerTurno, turnos } = comoLlegoLaAusencia({
      ausencia,
      guardias: guardiasPorAsistente.get(ausencia.asistente_id) ?? [],
      regla,
    });

    // No deja ningún turno sin nadie: no hay nada que resolver y avisar sería llenar la pantalla
    // de tareas que no son tareas.
    if (como === COMO_LLEGO.SIN_TURNOS) continue;

    const inicio = new Date(`${primerTurno.fecha}T${primerTurno.hora_inicio}`);
    // Ya pasó el plazo en que taparlo servía de algo.
    if (inicio.getTime() < ahora.getTime() - DIAS_HACIA_ATRAS * MS_POR_DIA) continue;

    if (!corresponde({ como, ausencia, regla, ahora })) continue;

    const veces = (ausencia.aviso_ausencia_veces ?? 0) + 1;
    const yaEmpezo = inicio.getTime() <= ahora.getTime();

    await notificarCoordinador({
      evento: EVENTO_POR_CLASE[como],
      prestadoraId,
      ...aviso(EVENTO_POR_CLASE[como], idioma, {
        asistente: nombres.get(ausencia.asistente_id) ?? null,
        fechaInicio: ausencia.fecha_inicio,
        fechaFin: ausencia.fecha_fin,
        fecha: primerTurno.fecha,
        horaInicio: primerTurno.hora_inicio,
        horaFin: primerTurno.hora_fin,
        pacientes: (pacientesPorGuardia.get(primerTurno.id) ?? []).map((p) => p.nombre),
        turnos: turnos.length,
        yaEmpezo,
        horas: Math.round(Math.abs(horas ?? 0)),
        veces,
      }),
    });

    const { error: errorUpdate } = await supabase
      .from('ausencias')
      .update({
        aviso_ausencia_at: ahora.toISOString(),
        aviso_ausencia_veces: veces,
        aviso_ausencia_clase: como,
      })
      .eq('id', ausencia.id);
    if (errorUpdate) {
      console.error(`Error marcando el aviso de ausencia (${ausencia.id}):`, errorUpdate.message);
    }
  }
}

/**
 * Si toca avisar ahora.
 *
 * La que cambió de clase avisa siempre: lo que entró como tarea resultó ser una alarma, y callarla
 * porque «ya se avisó» sería perder el momento en que el aviso importa. La que sigue igual,
 * depende de la clase: la urgente insiste cada tantas horas, la que llegó con margen se dice una
 * sola vez. Repetir cada dos horas algo que tiene tres días es el modo más rápido de que la
 * Coordinadora deje de leer los avisos.
 */
function corresponde({ como, ausencia, regla, ahora }) {
  if (ausencia.aviso_ausencia_clase && ausencia.aviso_ausencia_clase !== como) return true;
  if (como === COMO_LLEGO.CON_TIEMPO) return !ausencia.aviso_ausencia_at;
  return necesitaNotificar({
    ultimaNotificacionAt: ausencia.aviso_ausencia_at,
    intervaloMinutos: regla.horas_entre_avisos * 60,
    ahora,
  });
}

/** Cómo se llama cada ausente, para que el aviso diga quién falta y no un identificador. */
async function nombresDeAsistentes(ids, prestadoraId) {
  const nombres = new Map();
  if (!ids.length) return nombres;
  const { data, error } = await supabase
    .from('asistentes')
    .select('id, nombre')
    .eq('prestadora_id', prestadoraId)
    .in('id', ids);
  if (error) {
    // Sin el nombre el aviso sale igual, diciendo «Un Asistente»: es peor no avisar.
    console.error(`Error leyendo los nombres de los ausentes (prestadora ${prestadoraId}):`, error.message);
    return nombres;
  }
  for (const fila of data ?? []) nombres.set(fila.id, fila.nombre);
  return nombres;
}

// La fecha de un momento como la guarda la base (`2026-08-07`), en hora local. `toISOString()` a
// secas daría la fecha en UTC, que en horario argentino cambia de día tres horas antes de tiempo.
function fechaISO(momento) {
  const corrida = new Date(momento.getTime() - momento.getTimezoneOffset() * 60000);
  return corrida.toISOString().slice(0, 10);
}
