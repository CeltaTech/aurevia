import { supabase } from '../db/connection.js';
import { pacientesDeGuardia } from './pacientesDeGuardia.js';
import { finDeGuardia, sumarDias } from './horarios.js';
import {
  cuandoTermino,
  laExtensionCorresponde,
  laExtensionTermino,
  laQueSigue,
} from './extensionDeTurno.js';

/* La Asistente que se quedó de más queda anotada, desde la hora en que quedó de más.
   ==================================================================================

   QUÉ MIRA. Los turnos que tienen marca de llegada, no tienen marca de cierre y ya pasaron su
   hora de fin. De ésos, los que no fueron relevados: o no hay ningún turno cargado después, o el
   que hay todavía no tiene a nadie adentro.

   POR QUÉ ES UN PROCESO PROPIO Y NO CUELGA DE NINGÚN EXPEDIENTE. Hay tres maneras de que no venga
   nadie —el turno que nunca tuvo a quién asignarle, la Asistente asignada que faltó y la que
   simplemente todavía no llegó— y cada una abre un expediente distinto, o ninguno. Las tres dejan
   a la misma persona adentro de la casa. Colgar esto de uno de esos expedientes dejaría los otros
   dos casos sin anotar, que es exactamente lo que pasaba hasta hoy.

   ESTO NO AVISA NADA, Y NO ES UN OLVIDO. De que falta el relevo ya se enteró quien coordina, por
   los procesos que miran eso; repetírselo desde acá sería el mismo aviso con otro nombre. Lo único
   que sale de esta pieza hacia el Coordinador es el «no puedo continuar», y ése lo manda la ruta
   que lo recibe, en el momento, no este proceso.

   ESTO TAMPOCO DECIDE NADA. No traba el cierre del turno, no asigna a nadie, no marca ninguna
   ausencia y no reclama. Quedarse hasta el relevo es un deber del oficio: se le pide, no se le
   ordena. Lo que este proceso hace es que el rato que se quedó exista escrito, porque hasta ahora
   no existía en ningún lado y esas horas son suyas.

   Entra con la llave de servicio, que se saltea la protección por fila, porque recorre todas las
   Prestadoras y acá no hay ninguna sesión de Panel abierta. Mismo criterio que
   `revisarIncidentesTurnoSinCubrir.js`. */

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Hasta dónde se mira hacia atrás al traer los turnos abiertos. Un turno de 72 horas empieza tres
// días antes de terminar, y todavía uno más para el caso que quedó abierto de ayer.
const DIAS_HACIA_ATRAS = 4;

export async function revisarExtensionesDeTurno() {
  const ahora = new Date();

  const { data: guardias, error } = await supabase
    .from('guardias')
    .select(
      'id, prestadora_id, asistente_id, paciente_id, fecha, hora_inicio, hora_fin, dias_hasta_el_fin, checkin_at, checkout_at'
    )
    .not('checkin_at', 'is', null)
    .gte('fecha', fechaISO(new Date(ahora.getTime() - DIAS_HACIA_ATRAS * MS_POR_DIA)))
    .lte('fecha', fechaISO(ahora));

  if (error) {
    console.error('Error consultando turnos para las extensiones:', error.message);
    return;
  }

  // Las que ya están anotadas. Se traen todas de una vez y no una por turno: en una vuelta normal
  // no hay ninguna abierta, y una consulta por turno serían cientos para no encontrar nada.
  const abiertas = await extensionesAbiertas();
  if (abiertas === null) return;

  for (const guardia of guardias ?? []) {
    if (!guardia.prestadora_id) continue;
    await revisarUnTurno({ guardia, extension: abiertas.get(guardia.id) ?? null, ahora });
  }

  // Las abiertas cuyo turno ya no aparece en la ventana de arriba: se cerraron solas cuando la
  // persona marcó el cierre, o el turno quedó viejo. Se cierran con el dato que haya, porque una
  // extensión abierta para siempre diría que alguien sigue adentro de una casa hace una semana.
  for (const [guardiaId, extension] of abiertas) {
    if ((guardias ?? []).some((g) => g.id === guardiaId)) continue;
    await cerrar({ extension, hasta: ahora });
  }
}

async function revisarUnTurno({ guardia, extension, ahora }) {
  const relevo = await buscarElRelevo({ guardia });

  if (extension) {
    if (!laExtensionTermino({ guardia, relevo })) {
      // Sigue adentro. Si el relevo apareció recién ahora —antes no había ninguno cargado—, se lo
      // anota: es el dato que la pantalla usa para contarle cómo va la búsqueda.
      if (relevo?.id && relevo.id !== extension.relevo_guardia_id) {
        await anotarElRelevo({ extension, relevoId: relevo.id });
      }
      return;
    }
    await cerrar({ extension, hasta: cuandoTermino({ guardia, relevo, ahora }) });
    return;
  }

  if (!laExtensionCorresponde({ guardia, relevo, ahora })) return;
  await abrir({ guardia, relevo });
}

/**
 * El turno que tendría que haber empezado cuando éste terminó.
 *
 * Se busca por **todos** los Pacientes del turno, no por uno: si cubre a un matrimonio, el relevo
 * puede estar cargado sobre cualquiera de los dos. Mismo criterio que `marcarAusente.js`, que hace
 * la búsqueda espejo.
 *
 * Devuelve `null` cuando no hay ninguno cargado, y eso no es una falla: es la forma más cruda de
 * que no venga nadie.
 */
async function buscarElRelevo({ guardia }) {
  let pacienteIds;
  try {
    pacienteIds = (await pacientesDeGuardia(guardia, 'id')).map((p) => p.id);
  } catch (e) {
    console.error(`Error leyendo los Pacientes del turno ${guardia.id}:`, e.message);
    return null;
  }
  if (pacienteIds.length === 0) return null;

  // El relevo arranca el día en que éste termina, o al siguiente si hay un hueco entre los dos.
  const diaDelFinal = sumarDias(guardia.fecha, Number(guardia.dias_hasta_el_fin) || 0);

  const { data, error } = await supabase
    .from('guardia_pacientes')
    .select('guardias!inner(id, fecha, hora_inicio, asistente_id, checkin_at, ofrecida_at)')
    .in('paciente_id', pacienteIds)
    .eq('prestadora_id', guardia.prestadora_id)
    .in('guardias.fecha', [diaDelFinal, sumarDias(diaDelFinal, 1)])
    .neq('guardias.estado', 'cancelada')
    .neq('guardias.id', guardia.id);

  if (error) {
    console.error(`Error buscando el relevo del turno ${guardia.id}:`, error.message);
    return null;
  }

  const filas = (data ?? []).map((fila) => fila.guardias).filter(Boolean);
  return laQueSigue(guardia, filas);
}

async function extensionesAbiertas() {
  const porGuardia = new Map();

  const { data, error } = await supabase
    .from('extensiones_de_turno')
    .select('id, guardia_id, relevo_guardia_id, desde_at')
    .is('hasta_at', null);

  if (error) {
    // Sin poder leer lo que ya está no se abre ninguna: abrir a ciegas dejaría dos filas del mismo
    // rato, y de ahí saldrían horas de más contadas dos veces.
    console.error('Error leyendo las extensiones abiertas:', error.message);
    return null;
  }

  for (const fila of data ?? []) porGuardia.set(fila.guardia_id, fila);
  return porGuardia;
}

async function abrir({ guardia, relevo }) {
  const { error } = await supabase.from('extensiones_de_turno').insert({
    prestadora_id: guardia.prestadora_id,
    guardia_id: guardia.id,
    relevo_guardia_id: relevo?.id ?? null,
    // La hora en que su turno terminaba, no la hora en que este proceso pasó. La diferencia son
    // los minutos que el proceso tardó en darse cuenta, y esos minutos ella los estuvo adentro.
    desde_at: finDeGuardia(guardia).toISOString(),
  });

  if (error) {
    // El índice único deja una sola extensión abierta por turno: si dos vueltas se cruzaron, la
    // segunda pierde y no pasa nada. Cualquier otro error sí se anota.
    if (error.code !== '23505') {
      console.error(`Error abriendo la extension del turno ${guardia.id}:`, error.message);
    }
  }
}

async function cerrar({ extension, hasta }) {
  // Nunca antes de cuando empezó: si los relojes de dos actos vinieron cruzados, la extensión
  // queda en cero y no en negativo, que la base rechazaría y dejaría la fila abierta para siempre.
  const desde = Date.parse(extension.desde_at);
  const momento = Number.isNaN(desde) ? hasta : new Date(Math.max(desde, hasta.getTime()));

  const { error } = await supabase
    .from('extensiones_de_turno')
    .update({ hasta_at: momento.toISOString() })
    .eq('id', extension.id);

  if (error) {
    console.error(`Error cerrando la extension ${extension.id}:`, error.message);
  }
}

async function anotarElRelevo({ extension, relevoId }) {
  const { error } = await supabase
    .from('extensiones_de_turno')
    .update({ relevo_guardia_id: relevoId })
    .eq('id', extension.id);

  if (error) {
    console.error(`Error anotando el relevo de la extension ${extension.id}:`, error.message);
  }
}

// La fecha de un momento como la guarda la base (`2026-09-16`), en hora local. `toISOString()` a
// secas daría la fecha en UTC, que en horario argentino cambia de día tres horas antes de tiempo.
function fechaISO(momento) {
  const corrida = new Date(momento.getTime() - momento.getTimezoneOffset() * 60000);
  return corrida.toISOString().slice(0, 10);
}
