import { supabase } from '../db/connection.js';
import { notificarCoordinador, enviarWhatsApp } from './whatsapp.js';
import { enviarPushFamilia } from './push.js';
import { configuracionEvento } from './email.js';
import { necesitaNotificar } from './insistencia.js';
import { pacientesDeGuardia, pacientesDeGuardias } from './pacientesDeGuardia.js';
import { intervaloParaPremura } from './umbralesPremura.js';
import { horasEntre } from './horasDeGuardia.js';

// Punto 5 de docs/PRD_06_WhatsApp_IA.md: insistencia al Coordinador según premura, con
// coordinador de respaldo si no hay reacción, parametrizado por prestadora
// (configuracion_escalada_coordinador). Corre cada pocos minutos, mismo patrón que
// ausenciaAutomatica.js — recorre TODAS las prestadoras licenciatarias por igual.
//
// "Premura" = minutos transcurridos desde que se detectó la alerta/incidente. Cada
// prestadora define sus propios tramos en umbrales_premura (más urgente = intervalo de
// insistencia más corto). Mientras no pase ultima_notificacion_at + intervalo_actual, el
// cron no vuelve a avisar — evita mandar el mismo aviso en cada corrida de 5 minutos.
export async function revisarNotificacionesCoordinador() {
  const { data: configuraciones, error } = await supabase
    .from('configuracion_escalada_coordinador')
    .select('*');

  if (error) {
    console.error('Error consultando configuracion_escalada_coordinador:', error.message);
    return;
  }
  if (!configuraciones?.length) return;

  const ahora = new Date();

  for (const config of configuraciones) {
    await revisarAlertas(config, ahora);
    await revisarIncidentes(config, ahora);
    await revisarGuardiasSinCerrar(config, ahora);
  }
}

// Aviso de guardia que terminó y nadie cerró (pendiente #117).
//
// Decisión del Desarrollador: «Nunca puede quedar una guardia sin cerrar, la coordinadora o
// coordinador debe tomar cartas en el asunto de inmediato (15 minutos máximo de la hora
// indicada para el cierre). Una guardia sin cerrar suele ser señal de problemas.»
//
// Los minutos de espera no están escritos acá (regla 1 de CLAUDE.md §7): salen de
// `minutos_gracia_cierre_guardia`, que cada Prestadora edita desde el Panel. Quince es con lo
// que arranca la columna en la base, no una regla del producto.
//
// Va adentro de este archivo y no en uno propio porque es el mismo recorrido: una vuelta por
// Prestadora, con la misma configuración de premura, la misma insistencia y el mismo
// Coordinador de respaldo que las alertas tempranas y los incidentes de relevo. Un proceso
// aparte tendría que volver a leer la misma tabla para hacer exactamente lo mismo.
const DIAS_HACIA_ATRAS_SIN_CERRAR = 7;
const MS_POR_MINUTO = 60 * 1000;
const MS_POR_HORA = 60 * MS_POR_MINUTO;

async function revisarGuardiasSinCerrar(config, ahora) {
  const {
    prestadora_id: prestadoraId,
    umbrales_premura: umbrales,
    minutos_antes_backup: minutosAntesBackup,
    coordinador_backup_id: backupId,
    minutos_gracia_cierre_guardia: minutosDeGracia,
    horas_antes_aviso_grave_sin_cerrar: horasAntesDeEscalar,
  } = config;

  // Sin margen configurado no se avisa nada. La columna tiene valor por defecto, así que esto
  // solo pasa si alguien lo puso en nulo a mano: mejor callarse que inventar un número.
  if (!minutosDeGracia) return;

  // El filtro por `fecha` es solo para no traerse la agenda entera; la cuenta fina se hace
  // después contra la hora de fin, que la base guarda en otra columna.
  const { data: guardias, error } = await supabase
    .from('guardias')
    .select('id, fecha, hora_inicio, hora_fin, paciente_id, checkout_at, aviso_sin_cerrar_at, aviso_sin_cerrar_veces, aviso_sin_cerrar_backup_at, aviso_sin_cerrar_grave_at, asistentes(nombre)')
    .eq('prestadora_id', prestadoraId)
    .eq('estado', 'activa')
    .is('cerrada_at', null)
    .gte('fecha', fechaISO(new Date(ahora.getTime() - DIAS_HACIA_ATRAS_SIN_CERRAR * 24 * MS_POR_HORA)))
    .lte('fecha', fechaISO(ahora));

  if (error) {
    console.error(`Error consultando guardias sin cerrar (prestadora ${prestadoraId}):`, error.message);
    return;
  }
  if (!guardias?.length) return;

  // A quiénes atendía la guardia. Mismo criterio que el aviso de guardia sin cubrir: un turno
  // puede cubrir a más de un Paciente y nombrar a uno solo le esconde al Coordinador la mitad
  // de lo que quedó sin confirmar.
  let pacientesPorGuardia;
  try {
    pacientesPorGuardia = await pacientesDeGuardias(guardias, 'id, nombre');
  } catch (e) {
    console.error(`Error leyendo los Pacientes de las guardias sin cerrar (prestadora ${prestadoraId}):`, e.message);
    return;
  }

  for (const guardia of guardias) {
    const fin = finDeLaGuardia(guardia);
    if (!fin) continue;

    // El plazo que la Prestadora eligió todavía no venció: la guardia recién terminó y el
    // Asistente puede estar cerrándola en este momento.
    const vencimiento = fin.getTime() + minutosDeGracia * MS_POR_MINUTO;
    if (ahora.getTime() < vencimiento) continue;

    const minutosPremura = (ahora.getTime() - vencimiento) / MS_POR_MINUTO;
    const intervalo = intervaloParaPremura(umbrales, minutosPremura);

    if (necesitaNotificar({ ultimaNotificacionAt: guardia.aviso_sin_cerrar_at, intervaloMinutos: intervalo, ahora })) {
      const veces = (guardia.aviso_sin_cerrar_veces ?? 0) + 1;

      await notificarCoordinador({
        evento: 'guardia_sin_cerrar',
        prestadoraId,
        asunto: 'Guardia terminada y todavía sin cerrar',
        texto: textoGuardiaSinCerrar({
          guardia,
          pacientes: pacientesPorGuardia.get(guardia.id) ?? [],
          fin,
          ahora,
          veces,
        }),
      });

      const { error: errorUpdate } = await supabase
        .from('guardias')
        .update({ aviso_sin_cerrar_at: ahora.toISOString(), aviso_sin_cerrar_veces: veces })
        .eq('id', guardia.id);
      if (errorUpdate) {
        console.error(`Error marcando el aviso de guardia sin cerrar (${guardia.id}):`, errorUpdate.message);
      }
    }

    if (backupId && !guardia.aviso_sin_cerrar_backup_at && minutosPremura >= minutosAntesBackup) {
      await notificarCoordinadorBackup({
        backupId,
        prestadoraId,
        texto: `La guardia del ${guardia.fecha}, de ${guardia.hora_inicio} a ${guardia.hora_fin}, sigue sin cerrarse ${Math.round(minutosPremura)} minutos después del plazo.`,
      });
      await supabase.from('guardias').update({ aviso_sin_cerrar_backup_at: ahora.toISOString() }).eq('id', guardia.id);
    }

    // El tercer escalón. A esta altura la insistencia al Coordinador y el aviso a su respaldo
    // ya salieron y no alcanzaron: la guardia lleva horas abierta. Deja de ser un aviso de
    // operación y pasa a ser una emergencia, que sale una sola vez por su propio evento y a
    // sus propios destinatarios. Ver la migración
    // 20260822210000_una_guardia_sin_cerrar_que_no_se_resuelve_escala_a_la_direccion.sql.
    if (
      horasAntesDeEscalar &&
      !guardia.aviso_sin_cerrar_grave_at &&
      minutosPremura >= horasAntesDeEscalar * 60
    ) {
      await notificarCoordinador({
        evento: 'guardia_sin_cerrar_grave',
        prestadoraId,
        asunto: 'Urgente: una guardia lleva horas sin cerrarse',
        texto: textoGuardiaSinCerrarGrave({
          guardia,
          pacientes: pacientesPorGuardia.get(guardia.id) ?? [],
          fin,
          ahora,
        }),
      });

      const { error: errorGrave } = await supabase
        .from('guardias')
        .update({ aviso_sin_cerrar_grave_at: ahora.toISOString() })
        .eq('id', guardia.id);
      if (errorGrave) {
        console.error(`Error marcando el aviso grave de guardia sin cerrar (${guardia.id}):`, errorGrave.message);
      }
    }
  }
}

// Cuándo terminaba la guardia. La duración sale de `horasEntre()` y no de restar las dos horas
// acá, porque esa resta tiene un caso que no se ve a simple vista: una guardia de 08:00 a 08:00
// dura veinticuatro horas, no cero, y una de 20:00 a 06:00 cruza la medianoche. Esa regla vive
// en un solo lugar (utils/horasDeGuardia.js, regla 12 de CLAUDE.md §7).
function finDeLaGuardia(guardia) {
  if (!guardia.fecha || !guardia.hora_inicio || !guardia.hora_fin) return null;
  const inicio = new Date(`${guardia.fecha}T${guardia.hora_inicio}`);
  if (Number.isNaN(inicio.getTime())) return null;
  return new Date(inicio.getTime() + horasEntre(guardia.hora_inicio, guardia.hora_fin) * MS_POR_HORA);
}

// El aviso tiene que dejar al Coordinador en condiciones de actuar sin entrar al Panel a
// averiguar nada. Por eso dice a quién se atendía, a qué hora terminaba, cuánto hace que
// venció el plazo y —lo que decide qué hacer— si el Asistente marcó su salida: si la marcó,
// se fue y lo que falta es la confirmación; si no la marcó, puede seguir en el domicilio y
// eso es otra conversación.
function textoGuardiaSinCerrar({ guardia, pacientes, fin, ahora, veces }) {
  const lineas = [
    `Guardia del ${guardia.fecha}, de ${guardia.hora_inicio} a ${guardia.hora_fin}, para ${nombresDePacientes(pacientes)}.`,
    `A cargo de ${asistenteDe(guardia)}. Terminaba hace ${atrasoDesde(fin, ahora)} y sigue abierta.`,
    guardia.checkout_at
      ? 'El Asistente ya marcó su salida: falta confirmar que quedó todo hecho.'
      : 'El Asistente todavía no marcó su salida.',
  ];

  if (veces > 1) lineas.push(`Es el aviso número ${veces} de esta misma guardia.`);

  return lineas.join('\n');
}

// El aviso que escala. Dice lo mismo que el anterior más las dos cosas que lo vuelven otra
// conversación: que a esto ya se le avisó al Coordinador y no se resolvió, y qué está en juego
// si sigue así. Lo segundo no es dramatismo: una guardia abierta durante días es, en los
// hechos, una Familia que no sabe si a su Paciente lo cuidaron.
function textoGuardiaSinCerrarGrave({ guardia, pacientes, fin, ahora }) {
  const lineas = [
    `Guardia del ${guardia.fecha}, de ${guardia.hora_inicio} a ${guardia.hora_fin}, para ${nombresDePacientes(pacientes)}.`,
    `A cargo de ${asistenteDe(guardia)}. Terminaba hace ${atrasoDesde(fin, ahora)} y sigue abierta.`,
    'Ya se avisó al Coordinador y la guardia sigue sin cerrarse. Hace falta que intervenga alguien con autoridad para resolverlo.',
    guardia.checkout_at
      ? 'El Asistente marcó su salida, así que se fue del domicilio: lo que falta es confirmar que quedó todo hecho.'
      : 'El Asistente no marcó su salida, así que no hay constancia de que la guardia haya terminado ni de quién quedó a cargo del Paciente.',
    'Este aviso sale una sola vez por guardia.',
  ];

  return lineas.join('\n');
}

/** Los Pacientes de una guardia, en una frase: «Ana», «Ana y Luis», «Ana, Luis y Marta». */
function nombresDePacientes(pacientes) {
  const nombres = pacientes.map((p) => p.nombre).filter(Boolean);
  if (nombres.length === 0) return 'Paciente sin nombre cargado';
  return [nombres.slice(0, -1).join(', '), nombres.at(-1)].filter(Boolean).join(' y ');
}

const asistenteDe = (guardia) => guardia.asistentes?.nombre ?? 'Asistente sin asignar';

/**
 * Cuánto hace que terminaba la guardia, en la unidad que se entiende de un vistazo. Por debajo
 * de dos horas se dice en minutos y por encima en horas: «185 minutos» obliga a hacer la cuenta
 * justo cuando quien lee tiene que decidir rápido.
 */
function atrasoDesde(fin, ahora) {
  const minutos = Math.round((ahora.getTime() - fin.getTime()) / MS_POR_MINUTO);
  return minutos < 120 ? `${minutos} minutos` : `${Math.round(minutos / 60)} horas`;
}

// La fecha de un momento tal como la guarda la base (`2026-08-22`), en hora local.
// `toISOString()` a secas daría la fecha en UTC, que en horario argentino cambia de día tres
// horas antes de tiempo.
function fechaISO(momento) {
  const corrida = new Date(momento.getTime() - momento.getTimezoneOffset() * 60000);
  return corrida.toISOString().slice(0, 10);
}

async function revisarAlertas(config, ahora) {
  const { prestadora_id: prestadoraId, umbrales_premura: umbrales, minutos_antes_backup: minutosAntesBackup, coordinador_backup_id: backupId } = config;

  const { data: alertas, error } = await supabase
    .from('alertas_tempranas_guardia')
    .select('id, guardia_id, motivo, detectado_at, ultima_notificacion_at, veces_notificado, backup_notificado_at')
    .eq('prestadora_id', prestadoraId)
    .is('resuelto_at', null);

  if (error) {
    console.error(`Error consultando alertas_tempranas_guardia (prestadora ${prestadoraId}):`, error.message);
    return;
  }

  for (const alerta of alertas ?? []) {
    const minutosPremura = (ahora.getTime() - new Date(alerta.detectado_at).getTime()) / 60_000;
    const intervalo = intervaloParaPremura(umbrales, minutosPremura);

    if (necesitaNotificar({ ultimaNotificacionAt: alerta.ultima_notificacion_at, intervaloMinutos: intervalo, ahora })) {
      await notificarCoordinador({
        evento: 'alerta_temprana_guardia',
        prestadoraId,
        asunto: 'Alerta temprana de posible ausencia sin resolver',
        texto: `Guardia ${alerta.guardia_id}, motivo: ${alerta.motivo ?? '—'}. Sin resolver hace ${Math.round(minutosPremura)} minutos.`,
      });

      await supabase
        .from('alertas_tempranas_guardia')
        .update({ ultima_notificacion_at: ahora.toISOString(), veces_notificado: (alerta.veces_notificado ?? 0) + 1 })
        .eq('id', alerta.id);
    }

    if (backupId && !alerta.backup_notificado_at && minutosPremura >= minutosAntesBackup) {
      await notificarCoordinadorBackup({ backupId, prestadoraId, texto: `Alerta temprana de guardia ${alerta.guardia_id} sigue sin resolver hace ${Math.round(minutosPremura)} minutos.` });
      await supabase.from('alertas_tempranas_guardia').update({ backup_notificado_at: ahora.toISOString() }).eq('id', alerta.id);
    }
  }
}

async function revisarIncidentes(config, ahora) {
  const {
    prestadora_id: prestadoraId,
    umbrales_premura: umbrales,
    minutos_antes_backup: minutosAntesBackup,
    coordinador_backup_id: backupId,
    fase_automatica_activa: faseAutomaticaActiva,
    minutos_antes_fase_automatica: minutosAntesFaseAutomatica,
  } = config;

  const { data: incidentes, error } = await supabase
    .from('incidentes_relevo')
    .select('id, guardia_entrante_id, nivel_actual, iniciado_at, ultima_notificacion_at, veces_notificado, backup_notificado_at, fase_automatica_notificada_at')
    .eq('prestadora_id', prestadoraId)
    .is('resuelto_at', null);

  if (error) {
    console.error(`Error consultando incidentes_relevo (prestadora ${prestadoraId}):`, error.message);
    return;
  }

  for (const incidente of incidentes ?? []) {
    const minutosPremura = (ahora.getTime() - new Date(incidente.iniciado_at).getTime()) / 60_000;
    const intervalo = intervaloParaPremura(umbrales, minutosPremura);

    if (necesitaNotificar({ ultimaNotificacionAt: incidente.ultima_notificacion_at, intervaloMinutos: intervalo, ahora })) {
      const texto = `Guardia ${incidente.guardia_entrante_id}, nivel de escalada actual: ${incidente.nivel_actual}. Sin resolver hace ${Math.round(minutosPremura)} minutos.`;

      await notificarCoordinador({
        evento: 'incidente_relevo_sin_resolver',
        prestadoraId,
        asunto: 'Incidente de continuidad de guardia sin resolver',
        texto,
      });

      await notificarFamiliaSiCorresponde({ prestadoraId, guardiaEntranteId: incidente.guardia_entrante_id, texto });

      await supabase
        .from('incidentes_relevo')
        .update({ ultima_notificacion_at: ahora.toISOString(), veces_notificado: (incidente.veces_notificado ?? 0) + 1 })
        .eq('id', incidente.id);
    }

    if (backupId && !incidente.backup_notificado_at && minutosPremura >= minutosAntesBackup) {
      await notificarCoordinadorBackup({ backupId, prestadoraId, texto: `Incidente de relevo de guardia ${incidente.guardia_entrante_id} sigue sin resolver hace ${Math.round(minutosPremura)} minutos.` });
      await supabase.from('incidentes_relevo').update({ backup_notificado_at: ahora.toISOString() }).eq('id', incidente.id);
    }

    if (
      faseAutomaticaActiva
      && !incidente.fase_automatica_notificada_at
      && minutosPremura >= minutosAntesFaseAutomatica
    ) {
      // El envío automático del mensaje de escalada a los Asistentes (orden_prioridad de
      // configuracion_escalada_relevo) requiere plantilla de WhatsApp aprobada por Meta —
      // se completa en el test final con una prestadora real. Por ahora se avisa al
      // Coordinador de que la fase automática debería haber arrancado, sin dejarlo pasar
      // en silencio.
      await notificarCoordinador({
        evento: 'incidente_relevo_sin_resolver',
        prestadoraId,
        asunto: 'Fase automática de escalada alcanzada (envío automático pendiente de plantilla Meta)',
        texto: `Guardia ${incidente.guardia_entrante_id} superó el umbral de fase automática (${minutosAntesFaseAutomatica} minutos) sin resolverse. El envío automático a Asistentes todavía no está activo — requiere acción manual.`,
      });
      await supabase.from('incidentes_relevo').update({ fase_automatica_notificada_at: ahora.toISOString() }).eq('id', incidente.id);
    }
  }
}

// Fase 11: "Ausente sin relevo previo" es la alerta crítica que el Desarrollador señaló
// explícitamente — a diferencia del respaldo de avisos de rutina (revisarRecordatoriosPush.js),
// acá va push + WhatsApp a la vez, nunca uno de respaldo del otro. Apagado por defecto: cada
// Prestadora decide si su política es avisarle a la Familia o no (algunas prefieren no
// alarmarla si el incidente se resuelve internamente sin que llegue a necesitar su
// intervención) — CLAUDE.md §2, "configuración sobre programación".
async function notificarFamiliaSiCorresponde({ prestadoraId, guardiaEntranteId, texto }) {
  const config = await configuracionEvento('incidente_relevo_sin_resolver', prestadoraId);
  if (!config?.notificar_familia) return;

  const { data: guardia } = await supabase
    .from('guardias')
    .select('id, paciente_id')
    .eq('id', guardiaEntranteId)
    .single();
  if (!guardia) return;

  // Un turno puede cubrir a más de un Paciente, y cada uno tiene su propia Familia esperando.
  // Se avisa a todas: la Familia del segundo Paciente se quedó igual de sin cuidado que la del
  // primero, y no enterarse es exactamente lo que este aviso existe para evitar.
  let familiaIds;
  try {
    const pacientes = await pacientesDeGuardia(guardia, 'id, familia_id');
    familiaIds = [...new Set(pacientes.map((p) => p.familia_id).filter(Boolean))];
  } catch (err) {
    console.error(`Error leyendo los Pacientes de la guardia ${guardiaEntranteId}:`, err.message);
    return;
  }
  if (familiaIds.length === 0) return;

  const { data: usuarios } = await supabase.from('usuarios').select('id, telefono').in('id', familiaIds);
  const telefonoPorFamilia = new Map((usuarios ?? []).map((u) => [u.id, u.telefono]));

  for (const familiaId of familiaIds) {
    await enviarPushFamilia(familiaId, {
      titulo: 'Continuidad de guardia',
      cuerpo: texto,
      url: '/',
    });

    const telefono = telefonoPorFamilia.get(familiaId);
    if (!telefono) continue;
    try {
      await enviarWhatsApp({ prestadoraId, telefono, texto });
    } catch (err) {
      console.error(`Error enviando WhatsApp a Familia (incidente_relevo_sin_resolver, guardia ${guardiaEntranteId}):`, err.message);
    }
  }
}

async function notificarCoordinadorBackup({ backupId, prestadoraId, texto }) {
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('telefono, email')
    .eq('id', backupId)
    .single();

  if (!usuario) return;

  await notificarCoordinador({
    evento: 'incidente_relevo_sin_resolver',
    prestadoraId,
    asunto: 'Escalada a Coordinador de respaldo',
    texto,
    telefono: usuario.telefono,
  });
}
