import { supabase } from '../db/connection.js';
import { notificarCoordinador } from './whatsapp.js';
import { necesitaNotificar } from './insistencia.js';
import { pacientesDeGuardias } from './pacientesDeGuardia.js';

// Aviso al Coordinador cuando se viene una guardia que todavía no tiene a nadie
// (pendiente #106, docs/PENDIENTES.md).
//
// Por qué hacía falta un proceso aparte y no alcanzaba con tocar el que ya existía: los
// tres avisos de revisarRecordatoriosPush.js filtran `.not('asistente_id', 'is', null)`
// porque los tres le hablan al Asistente que tiene la guardia asignada. Un hueco no tiene
// Asistente, así que no hay a quién avisarle — el destinatario de este aviso es el
// Coordinador, que es el único que puede taparlo.
//
// Los dos números que gobiernan el aviso (con cuánta anticipación, y cada cuánto repetirlo)
// salen de configuracion_aviso_guardia_sin_cubrir, una fila por Prestadora. No hay ningún
// número escrito acá a propósito (regla 1 de CLAUDE.md §7): una Prestadora de guardias fijas
// quiere enterarse con tres días de anticipación y una que cubre urgencias se llenaría de
// avisos inútiles con ese mismo número.
//
// Usa el service role (pasa por encima de RLS) porque recorre todas las Prestadoras según su
// propia configuración — en este proceso no hay ninguna sesión de Panel abierta. Mismo
// criterio que avisoAutomaticoCese.js.

const EVENTO = 'guardia_sin_cubrir';

// Cuánto se sigue avisando un hueco después de la hora a la que tendría que haber empezado.
// No es una regla de negocio configurable sino el borde de la ventana de búsqueda: pasado un
// día, la guardia ya no se puede cubrir y el aviso solo sería ruido. Se mide en días porque
// la consulta filtra por el campo `fecha` de la guardia.
const DIAS_HACIA_ATRAS = 1;

const MS_POR_HORA = 60 * 60 * 1000;

export async function revisarGuardiasSinCubrir() {
  const { data: configuraciones, error } = await supabase
    .from('configuracion_aviso_guardia_sin_cubrir')
    .select('prestadora_id, horas_antes, horas_entre_avisos')
    .eq('activo', true);

  if (error) {
    console.error('Error consultando configuracion_aviso_guardia_sin_cubrir:', error.message);
    return;
  }
  if (!configuraciones?.length) return;

  const ahora = new Date();

  for (const config of configuraciones) {
    await revisarPrestadora(config, ahora);
  }
}

async function revisarPrestadora({ prestadora_id: prestadoraId, horas_antes: horasAntes, horas_entre_avisos: horasEntreAvisos }, ahora) {
  const limite = new Date(ahora.getTime() + horasAntes * MS_POR_HORA);

  // El filtro por `fecha` es solo para no traerse la agenda entera: la ventana fina se
  // decide después contra la hora de inicio, que la base guarda en otra columna.
  const { data: guardias, error } = await supabase
    .from('guardias')
    .select('id, paciente_id, fecha, hora_inicio, hora_fin, ofrecida_at, aviso_sin_cubrir_at, aviso_sin_cubrir_veces, ofertas_guardia(respuesta)')
    .eq('prestadora_id', prestadoraId)
    .is('asistente_id', null)
    .eq('estado', 'programada')
    .gte('fecha', fechaISO(new Date(ahora.getTime() - DIAS_HACIA_ATRAS * 24 * MS_POR_HORA)))
    .lte('fecha', fechaISO(new Date(limite.getTime() + 24 * MS_POR_HORA)));

  if (error) {
    console.error(`Error consultando guardias sin cubrir (prestadora ${prestadoraId}):`, error.message);
    return;
  }

  // A quiénes se queda sin atender cada hueco. Se piden los nombres de todos los Pacientes del
  // turno y no el de uno: un aviso que nombra a una sola persona cuando el turno cubría a dos
  // le esconde al Coordinador la mitad del problema, y de ese tamaño depende con qué urgencia
  // sale a buscar quien lo tape.
  let pacientesPorGuardia;
  try {
    pacientesPorGuardia = await pacientesDeGuardias(guardias ?? [], 'id, nombre');
  } catch (e) {
    console.error(`Error leyendo los Pacientes de las guardias sin cubrir (prestadora ${prestadoraId}):`, e.message);
    return;
  }

  for (const guardia of guardias ?? []) {
    const inicio = new Date(`${guardia.fecha}T${guardia.hora_inicio}`);

    // Todavía falta más que la anticipación configurada: no es momento de molestar.
    if (inicio.getTime() > limite.getTime()) continue;
    // Ya pasó el plazo en que taparla servía de algo.
    if (inicio.getTime() < ahora.getTime() - DIAS_HACIA_ATRAS * 24 * MS_POR_HORA) continue;

    if (!necesitaNotificar({
      ultimaNotificacionAt: guardia.aviso_sin_cubrir_at,
      intervaloMinutos: horasEntreAvisos * 60,
      ahora,
    })) continue;

    const veces = (guardia.aviso_sin_cubrir_veces ?? 0) + 1;
    await notificarCoordinador({
      evento: EVENTO,
      prestadoraId,
      asunto: asuntoDelAviso({ inicio, ahora }),
      texto: textoDelAviso({ guardia, pacientes: pacientesPorGuardia.get(guardia.id) ?? [], inicio, ahora, veces }),
    });

    const { error: errorUpdate } = await supabase
      .from('guardias')
      .update({ aviso_sin_cubrir_at: ahora.toISOString(), aviso_sin_cubrir_veces: veces })
      .eq('id', guardia.id);
    if (errorUpdate) {
      console.error(`Error marcando el aviso de guardia sin cubrir (${guardia.id}):`, errorUpdate.message);
    }
  }
}

function asuntoDelAviso({ inicio, ahora }) {
  return inicio.getTime() <= ahora.getTime()
    ? 'Guardia sin cubrir: la hora de inicio ya pasó'
    : 'Guardia sin cubrir';
}

// El aviso tiene que servir para actuar, no solo para enterarse. Por eso además de cuándo y
// de quién dice en qué punto está la búsqueda: si todavía no se ofreció a nadie, si se
// ofreció y nadie contestó, o si contestaron todos que no. Son tres situaciones con tres
// acciones distintas, y sin esa línea el Coordinador tiene que entrar al Panel a averiguarlo.
function textoDelAviso({ guardia, pacientes, inicio, ahora, veces }) {
  const nombres = pacientes.map((p) => p.nombre).filter(Boolean);
  // "Elena y Alberto", no "Elena, Alberto": el aviso lo lee una persona apurada, no una
  // pantalla. Con tres o más, la coma separa y la "y" cierra, como se escribe en castellano.
  const paciente =
    nombres.length === 0
      ? 'Paciente sin nombre cargado'
      : [nombres.slice(0, -1).join(', '), nombres.at(-1)].filter(Boolean).join(' y ');
  const horas = Math.round(Math.abs(inicio.getTime() - ahora.getTime()) / MS_POR_HORA);
  const cuando = inicio.getTime() <= ahora.getTime()
    ? `Tendría que haber empezado hace ${horas} h.`
    : `Empieza en ${horas} h.`;

  const lineas = [
    `Guardia del ${guardia.fecha}, de ${guardia.hora_inicio} a ${guardia.hora_fin}, para ${paciente}.`,
    cuando,
    estadoDeLaBusqueda(guardia),
  ];

  if (veces > 1) lineas.push(`Es el aviso número ${veces} de esta misma guardia.`);

  return lineas.join('\n');
}

function estadoDeLaBusqueda(guardia) {
  if (!guardia.ofrecida_at) return 'Todavía no se le ofreció a ningún Asistente.';

  const invitaciones = guardia.ofertas_guardia ?? [];
  if (invitaciones.length === 0) return 'Está publicada, pero no se invitó a ningún Asistente en particular.';

  const sinContestar = invitaciones.filter((o) => !o.respuesta).length;
  if (sinContestar > 0) return `Se invitó a ${invitaciones.length} Asistente(s) y ${sinContestar} todavía no contestaron.`;

  const aceptaron = invitaciones.filter((o) => o.respuesta === 'acepta').length;
  if (aceptaron > 0) return `${aceptaron} Asistente(s) aceptaron pero la guardia sigue sin asignar.`;

  return `Se invitó a ${invitaciones.length} Asistente(s) y todos rechazaron.`;
}

// La fecha de un momento en el formato en que la guarda la base (`2026-08-07`), en hora
// local. `toISOString()` a secas daría la fecha en UTC, que en horario argentino cambia de
// día tres horas antes de tiempo.
function fechaISO(momento) {
  const corrida = new Date(momento.getTime() - momento.getTimezoneOffset() * 60000);
  return corrida.toISOString().slice(0, 10);
}
