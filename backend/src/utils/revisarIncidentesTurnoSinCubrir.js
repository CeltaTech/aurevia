import { supabase } from '../db/connection.js';
import { enviarEmail } from './email.js';
import { necesitaNotificar } from './insistencia.js';
import { pacientesDeGuardias } from './pacientesDeGuardia.js';
import { equipoDeUnPaciente } from './equipoDeUnPaciente.js';
import { aviso } from '../i18n/avisos.js';
import { idiomaDeLaPrestadora } from '../i18n/idiomaDeLaPrestadora.js';
import {
  CIERRES,
  REGLA_QUE_SE_PUEDE_TOCAR,
  elTurnoYaEsGrave,
  horasHastaElTurno,
  reglaDelIncidenteDe,
} from './incidenteTurnoSinCubrir.js';
import { reglaDeLaToma, tomadasAhora } from './tomasDeAlarma.js';
import { TIPOS_DE_ALARMA } from './alarmasTomadas.js';
import { escalonesYaAvisados, escalarSiCorresponde, minutosDesde } from './avisosDeEscalon.js';

// El turno que llega sin nadie abre un incidente, y el incidente no se va solo.
// ============================================================================
//
// POR QUÉ NO ALCANZABA CON LO QUE YA HABÍA. `revisarGuardiasSinCubrir.js` avisa y nada más: el
// aviso sale, llega y se termina, y al día siguiente ese turno ya no entra en la ventana que ese
// proceso mira. El turno queda en `programada` para siempre y nadie tiene que dar cuenta de él.
// Un turno que nunca se cubrió es una falla del servicio, y una falla del servicio queda abierta
// hasta que alguien la cierre diciendo cómo terminó.
//
// LOS DOS CONVIVEN Y NO SE PISAN. El aviso avisa temprano, con la anticipación que cada Prestadora
// configuró; el incidente se abre recién cuando el turno está cerca y ya es grave. Cuándo es eso
// lo contesta `incidenteTurnoSinCubrir.js`, que es el mismo archivo que usa el Panel.
//
// EL RECORDATORIO NO VA AL DESTINO GENERAL DE LA PRESTADORA, VA A QUIEN COORDINA A ESE PACIENTE.
// Un aviso que le llega a seis personas no le llega a ninguna, y acá hay alguien que puede tapar
// el turno ahora mismo. Por eso sale por correo a esa persona, con el equipo del Paciente adentro
// —primero quien cubre francos— para que no tenga que ir a buscar a quién llamar.
//
// Y POR ESO NO ESTÁ EN EL CATÁLOGO DE AVISOS. Ese catálogo sirve para elegir a qué dirección va
// cada aviso y si se manda o no; acá el destinatario no es una dirección elegible sino la persona
// que coordina a ese Paciente, y el recordatorio de un defecto grave no se apaga. Lo que sí decide
// cada Prestadora son los dos números: a cuántas horas se abre y cada cuánto se insiste.
//
// QUÉ CIERRA SOLO Y QUÉ NO. Cierra solo lo que la base ya dice: apareció una Asistente asignada
// —`cubierto`— o el turno se canceló —`ya_no_hacía_falta`—. Que el turno haya quedado en manos de
// la familia no lo sabe nadie más que quien lo vivió, así que ése lo cierra una persona desde el
// Panel, y queda escrito como defecto grave que no se pudo solucionar.
//
// Entra con la llave de servicio, que se saltea la protección por fila, porque recorre todas las
// Prestadoras y acá no hay ninguna sesión de Panel abierta. Mismo criterio que
// `revisarAusenciasAvisadas.js`.

const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Cuánto se sigue mirando un turno después de su hora de inicio. El incidente ya abierto no se
// cierra solo cuando pasa este plazo —sigue abierto hasta que alguien diga cómo terminó—; lo que
// deja de pasar es abrir uno nuevo y seguir insistiendo por un turno que ya no se puede tapar.
const DIAS_HACIA_ATRAS = 1;

// Hasta dónde se mira hacia adelante al traer los turnos. Es el máximo que una Prestadora puede
// configurar; el recorte fino lo hace después la regla de cada una.
const DIAS_HACIA_ADELANTE = Math.ceil(REGLA_QUE_SE_PUEDE_TOCAR.horas_para_abrirlo.maximo / 24);

const EVENTO = 'incidente_turno_sin_cubrir';

export async function revisarIncidentesTurnoSinCubrir() {
  const ahora = new Date();
  const desde = fechaISO(new Date(ahora.getTime() - DIAS_HACIA_ATRAS * MS_POR_DIA));
  const hasta = fechaISO(new Date(ahora.getTime() + DIAS_HACIA_ADELANTE * MS_POR_DIA));

  const { data: guardias, error } = await supabase
    .from('guardias')
    .select('id, prestadora_id, asistente_id, paciente_id, fecha, hora_inicio, hora_fin, estado')
    .gte('fecha', desde)
    .lte('fecha', hasta);

  if (error) {
    console.error('Error consultando turnos para el incidente de turno sin cubrir:', error.message);
    return;
  }

  const porPrestadora = new Map();
  for (const guardia of guardias ?? []) {
    if (!guardia.prestadora_id) continue;
    if (!porPrestadora.has(guardia.prestadora_id)) porPrestadora.set(guardia.prestadora_id, []);
    porPrestadora.get(guardia.prestadora_id).push(guardia);
  }

  for (const [prestadoraId, suyas] of porPrestadora) {
    await revisarPrestadora({ prestadoraId, guardias: suyas, ahora });
  }
}

async function revisarPrestadora({ prestadoraId, guardias, ahora }) {
  // Sin fila de configuración corren los valores de fábrica: que una Prestadora no haya tocado
  // nada no puede dejarla sin incidentes.
  const { data: configuracion, error: errorConfig } = await supabase
    .from('configuracion_incidentes_turno_sin_cubrir')
    .select('regla')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  if (errorConfig) {
    console.error(
      `Error leyendo la configuracion del incidente de turno sin cubrir (prestadora ${prestadoraId}):`,
      errorConfig.message
    );
    return;
  }

  const regla = reglaDelIncidenteDe(configuracion?.regla);

  const { data: abiertos, error: errorAbiertos } = await supabase
    .from('incidentes_turno_sin_cubrir')
    .select('id, guardia_id, abierto_at, ultimo_recordatorio_at, veces_recordado')
    .eq('prestadora_id', prestadoraId)
    .is('resuelto_at', null);

  if (errorAbiertos) {
    console.error(
      `Error leyendo los incidentes abiertos (prestadora ${prestadoraId}):`,
      errorAbiertos.message
    );
    return;
  }

  const porGuardia = new Map((abiertos ?? []).map((i) => [i.guardia_id, i]));
  const guardiaPorId = new Map(guardias.map((g) => [g.id, g]));

  await cerrarLosQueYaNoCorresponden({ abiertos: abiertos ?? [], guardiaPorId, ahora });

  // Una sola vez por Prestadora: todos los recordatorios de esta vuelta los lee la misma gente.
  const idioma = await idiomaDeLaPrestadora(prestadoraId);

  // De cuáles ya se hizo cargo alguien. Un incidente tomado no recuerda: recordar existe porque
  // nadie reaccionó, y acá alguien reaccionó. El incidente sigue abierto igual, y cuando a la toma
  // se le cumple el rato el recordatorio vuelve.
  const tomados = await tomadasAhora({
    prestadoraId,
    tipo: TIPOS_DE_ALARMA.TURNO_SIN_CUBRIR,
    ahora,
    regla: await reglaDeLaToma(prestadoraId),
  });

  // El incidente que lleva demasiado abierto deja de ser asunto de quien coordina a ese Paciente.
  // Cuándo pasa eso, y a quién le llega, está en `avisosDeEscalon.js`. Dos consultas por vuelta,
  // no dos por incidente.
  const configEscalada = await configuracionDeLaEscalada(prestadoraId);
  const escalonesQueSalieron = await escalonesYaAvisados({
    prestadoraId,
    tipo: TIPOS_DE_ALARMA.TURNO_SIN_CUBRIR,
  });

  for (const guardia of guardias) {
    if (!elTurnoYaEsGrave({ guardia, regla, ahora })) continue;

    const horas = horasHastaElTurno(guardia, ahora);
    // Ya pasó el plazo en que taparlo servía de algo: no se abre uno nuevo.
    const yaNoSePuedeTapar = horas !== null && horas < -DIAS_HACIA_ATRAS * 24;

    let incidente = porGuardia.get(guardia.id);
    if (!incidente) {
      if (yaNoSePuedeTapar) continue;
      incidente = await abrirIncidente({ guardia, prestadoraId });
      if (!incidente) continue;
      porGuardia.set(guardia.id, incidente);
    }

    if (yaNoSePuedeTapar) continue;
    if (tomados.has(incidente.id)) continue;

    await escalarSiCorresponde({
      prestadoraId,
      tipo: TIPOS_DE_ALARMA.TURNO_SIN_CUBRIR,
      referenciaId: incidente.id,
      minutosPremura: minutosDesde(incidente.abierto_at, ahora),
      config: configEscalada,
      idioma,
      // El cuerpo se arma sólo si hay un escalón para mandar: la mayoría de las vueltas no escala
      // nada, y armarlo cuesta una consulta por los Pacientes del turno.
      texto: async () =>
        (
          await armarElRecordatorio({
            guardia,
            prestadoraId,
            idioma,
            horas,
            veces: (incidente.veces_recordado ?? 0) + 1,
            ahora,
          })
        ).aviso.texto,
      yaSalieron: escalonesQueSalieron,
      ahora,
    });

    if (
      !necesitaNotificar({
        ultimaNotificacionAt: incidente.ultimo_recordatorio_at,
        intervaloMinutos: regla.horas_entre_recordatorios * 60,
        ahora,
      })
    ) {
      continue;
    }

    await recordar({ incidente, guardia, prestadoraId, idioma, horas, ahora });
  }
}

/**
 * Los que la base ya dice cómo terminaron.
 *
 * No es una deducción: que el turno tenga Asistente asignada o esté cancelado está escrito. Lo
 * que nadie puede saber mirando la base es si el turno terminó en manos de la familia, y ése es
 * justamente el final que importa: lo cierra una persona, desde el Panel.
 */
async function cerrarLosQueYaNoCorresponden({ abiertos, guardiaPorId, ahora }) {
  for (const incidente of abiertos) {
    const guardia = guardiaPorId.get(incidente.guardia_id);
    // El turno quedó fuera de la ventana que se mira: no se sabe nada nuevo de él y sigue abierto.
    if (!guardia) continue;

    const comoTermino = guardia.asistente_id
      ? CIERRES.LLEGO_UN_RELEVO
      : guardia.estado === 'cancelada'
        ? CIERRES.YA_NO_HACIA_FALTA
        : null;
    if (!comoTermino) continue;

    const { error } = await supabase
      .from('incidentes_turno_sin_cubrir')
      .update({ resuelto_at: ahora.toISOString(), resuelto_como: comoTermino })
      .eq('id', incidente.id);
    if (error) {
      console.error(`Error cerrando el incidente de turno sin cubrir (${incidente.id}):`, error.message);
    }
  }
}

/**
 * Los minutos a los que esta Prestadora hace subir de escalón una alarma.
 *
 * Sin fila configurada no hay escalones, y eso no es una falla: es una Prestadora que todavía no
 * armó su escalada. Devuelve un objeto vacío, que `escalonesQueCorresponden` lee como «apagado».
 */
async function configuracionDeLaEscalada(prestadoraId) {
  const { data, error } = await supabase
    .from('configuracion_escalada_coordinador')
    .select('minutos_antes_todos_los_coordinadores, minutos_antes_administracion')
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  if (error) {
    console.error(
      `Error leyendo la escalada del Coordinador (prestadora ${prestadoraId}):`,
      error.message
    );
    return {};
  }
  return data ?? {};
}

async function abrirIncidente({ guardia, prestadoraId }) {
  const { data, error } = await supabase
    .from('incidentes_turno_sin_cubrir')
    .insert({ prestadora_id: prestadoraId, guardia_id: guardia.id })
    .select('id, guardia_id, abierto_at, ultimo_recordatorio_at, veces_recordado')
    .single();

  if (error) {
    // El índice único deja un solo incidente abierto por turno: si dos vueltas se cruzaron, la
    // segunda pierde y no pasa nada. Cualquier otro error sí se anota.
    if (error.code !== '23505') {
      console.error(`Error abriendo el incidente del turno ${guardia.id}:`, error.message);
    }
    return null;
  }
  return data;
}

/**
 * El aviso de un turno sin cubrir, y a quién coordina se lo escribe.
 *
 * Vive aparte porque lo piden dos: el recordatorio, que se lo manda a quien coordina, y el
 * escalón, que le manda lo mismo a más gente. El escalón no cuenta otra cosa.
 */
async function armarElRecordatorio({ guardia, prestadoraId, idioma, horas, veces, ahora }) {
  let pacientes = [];
  try {
    pacientes = (await pacientesDeGuardias([guardia], 'id, nombre')).get(guardia.id) ?? [];
  } catch (e) {
    console.error(`Error leyendo los Pacientes del turno ${guardia.id}:`, e.message);
  }

  const { destinatarios, candidatos, cubrenFrancos } = await aQuienSeLeAvisa({
    pacientes,
    prestadoraId,
    ahora,
  });

  return {
    destinatarios,
    aviso: aviso(EVENTO, idioma, {
      fecha: guardia.fecha,
      horaInicio: guardia.hora_inicio,
      horaFin: guardia.hora_fin,
      pacientes: pacientes.map((p) => p.nombre),
      yaEmpezo: (horas ?? 0) <= 0,
      horas: Math.round(Math.abs(horas ?? 0)),
      veces,
      candidatos,
      cubrenFrancos,
    }),
  };
}

async function recordar({ incidente, guardia, prestadoraId, idioma, horas, ahora }) {
  const veces = (incidente.veces_recordado ?? 0) + 1;
  const { destinatarios, aviso: texto } = await armarElRecordatorio({
    guardia,
    prestadoraId,
    idioma,
    horas,
    veces,
    ahora,
  });

  if (!destinatarios.length) {
    // Sin nadie a quien escribirle no se marca el recordatorio: el incidente sigue abierto y la
    // vuelta siguiente lo intenta de nuevo. Marcarlo sería dar por avisado a nadie.
    console.error(`El turno ${guardia.id} no tiene a quien coordine con correo cargado.`);
    return;
  }

  for (const to of destinatarios) {
    try {
      await enviarEmail({ to, ...texto, prestadoraId });
    } catch (e) {
      console.error(`Error mandando el recordatorio del turno ${guardia.id}:`, e.message);
    }
  }

  const { error } = await supabase
    .from('incidentes_turno_sin_cubrir')
    .update({ ultimo_recordatorio_at: ahora.toISOString(), veces_recordado: veces })
    .eq('id', incidente.id);
  if (error) {
    console.error(`Error marcando el recordatorio del incidente (${incidente.id}):`, error.message);
  }
  incidente.ultimo_recordatorio_at = ahora.toISOString();
  incidente.veces_recordado = veces;
}

/**
 * A quién se le escribe y con qué lista de nombres adentro.
 *
 * Un turno puede cubrir a más de un Paciente —un matrimonio, una residencia—, así que se junta el
 * equipo de todos: quien coordina a cualquiera de ellos tiene que enterarse, y quien cubre francos
 * de cualquiera de ellos es alguien a quien llamar.
 */
async function aQuienSeLeAvisa({ pacientes, prestadoraId, ahora }) {
  const destinatarios = new Set();
  const candidatos = new Set();
  const cubrenFrancos = new Set();

  for (const paciente of pacientes) {
    const equipo = await equipoDeUnPaciente({ pacienteId: paciente.id, prestadoraId, ahora });
    for (const coordinador of equipo.coordinadores) {
      if (coordinador.email) destinatarios.add(coordinador.email);
    }
    for (const asistente of equipo.asistentes) {
      if (asistente.nombre) candidatos.add(asistente.nombre);
    }
    for (const asistente of equipo.cubrenFrancos) {
      if (asistente.nombre) cubrenFrancos.add(asistente.nombre);
    }
  }

  return {
    destinatarios: [...destinatarios],
    candidatos: [...candidatos],
    cubrenFrancos: [...cubrenFrancos],
  };
}

// La fecha de un momento como la guarda la base (`2026-08-07`), en hora local. `toISOString()` a
// secas daría la fecha en UTC, que en horario argentino cambia de día tres horas antes de tiempo.
function fechaISO(momento) {
  const corrida = new Date(momento.getTime() - momento.getTimezoneOffset() * 60000);
  return corrida.toISOString().slice(0, 10);
}
