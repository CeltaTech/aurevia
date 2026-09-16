import { supabase } from '../db/connection.js';
import { notificarCoordinador, avisarPorWhatsapp } from './whatsapp.js';
import { enviarPushFamilia } from './push.js';
import { configuracionEvento } from './email.js';
import { necesitaNotificar } from './insistencia.js';
import { correrFaseAutomatica } from './faseAutomaticaRelevo.js';
import { pacientesDeGuardia, pacientesDeGuardias } from './pacientesDeGuardia.js';
import { intervaloParaPremura } from './umbralesPremura.js';
import { horasEntre } from './horasDeGuardia.js';
import { aviso } from '../i18n/avisos.js';
import { idiomaDeLaPrestadora } from '../i18n/idiomaDeLaPrestadora.js';

// Insistencia al Coordinador según premura, con coordinador de respaldo si no hay
// reacción, parametrizado por prestadora
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

  // El idioma se pregunta una vez por Prestadora y no una por aviso: todos los que salen en esta
  // vuelta los lee la misma gente, la del Panel de esa Prestadora.
  for (const config of configuraciones) {
    const idioma = await idiomaDeLaPrestadora(config.prestadora_id);
    await revisarAlertas(config, ahora, idioma);
    await revisarIncidentes(config, ahora, idioma);
    await revisarGuardiasSinCerrar(config, ahora, idioma);
  }
}

// Aviso de guardia que terminó y nadie cerró.
//
// Una guardia sin cerrar suele ser señal de problemas, así que nunca puede quedar así: quien
// coordina tiene que tomar cartas en el asunto apenas pasa la hora de cierre.
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

async function revisarGuardiasSinCerrar(config, ahora, idioma) {
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
    .select('id, fecha, hora_inicio, hora_fin, dias_hasta_el_fin, paciente_id, checkout_at, aviso_sin_cerrar_at, aviso_sin_cerrar_veces, aviso_sin_cerrar_backup_at, aviso_sin_cerrar_grave_at, asistentes(nombre)')
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
        ...aviso('guardia_sin_cerrar', idioma, datosDeLaGuardia(guardia, pacientesPorGuardia, fin, ahora, veces)),
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
        idioma,
        ...aviso('guardia_sin_cerrar_respaldo', idioma, {
          fecha: guardia.fecha,
          horaInicio: guardia.hora_inicio,
          horaFin: guardia.hora_fin,
          minutosDeAtraso: minutosPremura,
        }),
      });
      await supabase.from('guardias').update({ aviso_sin_cerrar_backup_at: ahora.toISOString() }).eq('id', guardia.id);
    }

    // El tercer escalón. A esta altura la insistencia al Coordinador y el aviso a su respaldo
    // ya salieron y no alcanzaron: la guardia lleva horas abierta. Deja de ser un aviso de
    // operación y pasa a ser una emergencia, que sale una sola vez por su propio evento y a
    // sus propios destinatarios.
    if (
      horasAntesDeEscalar &&
      !guardia.aviso_sin_cerrar_grave_at &&
      minutosPremura >= horasAntesDeEscalar * 60
    ) {
      await notificarCoordinador({
        evento: 'guardia_sin_cerrar_grave',
        prestadoraId,
        ...aviso('guardia_sin_cerrar_grave', idioma, datosDeLaGuardia(guardia, pacientesPorGuardia, fin, ahora)),
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
  return new Date(inicio.getTime() + horasEntre(guardia.hora_inicio, guardia.hora_fin, guardia.dias_hasta_el_fin) * MS_POR_HORA);
}

// Lo que los dos avisos de guardia sin cerrar —el de rutina y el que escala— necesitan saber
// para dejar al Coordinador en condiciones de actuar sin entrar al Panel a averiguar nada: a
// quién se atendía, a qué hora terminaba, cuánto hace que venció el plazo y —lo que decide qué
// hacer— si el Asistente marcó su salida. Las palabras las pone el catálogo, en el idioma que
// corresponda; acá van solamente los datos.
function datosDeLaGuardia(guardia, pacientesPorGuardia, fin, ahora, veces) {
  return {
    fecha: guardia.fecha,
    horaInicio: guardia.hora_inicio,
    horaFin: guardia.hora_fin,
    pacientes: (pacientesPorGuardia.get(guardia.id) ?? []).map((p) => p.nombre),
    asistente: guardia.asistentes?.nombre ?? '',
    minutosDeAtraso: (ahora.getTime() - fin.getTime()) / MS_POR_MINUTO,
    salidaMarcada: !!guardia.checkout_at,
    veces,
  };
}

// La fecha de un momento tal como la guarda la base (`2026-08-22`), en hora local.
// `toISOString()` a secas daría la fecha en UTC, que en horario argentino cambia de día tres
// horas antes de tiempo.
function fechaISO(momento) {
  const corrida = new Date(momento.getTime() - momento.getTimezoneOffset() * 60000);
  return corrida.toISOString().slice(0, 10);
}

async function revisarAlertas(config, ahora, idioma) {
  const { prestadora_id: prestadoraId, umbrales_premura: umbrales, minutos_antes_backup: minutosAntesBackup, coordinador_backup_id: backupId } = config;

  const { data: alertas, error } = await supabase
    .from('alertas_tempranas_guardia')
    .select('id, guardia_id, fuente, motivo, detectado_at, ultima_notificacion_at, veces_notificado, backup_notificado_at')
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
        ...aviso('alerta_temprana_sin_resolver', idioma, {
          guardiaId: alerta.guardia_id,
          origen: aviso('origen_de_alerta', idioma, { fuente: alerta.fuente }).texto,
          motivo: alerta.motivo,
          minutos: minutosPremura,
        }),
      });

      await supabase
        .from('alertas_tempranas_guardia')
        .update({ ultima_notificacion_at: ahora.toISOString(), veces_notificado: (alerta.veces_notificado ?? 0) + 1 })
        .eq('id', alerta.id);
    }

    if (backupId && !alerta.backup_notificado_at && minutosPremura >= minutosAntesBackup) {
      await notificarCoordinadorBackup({
        backupId,
        prestadoraId,
        idioma,
        ...aviso('alerta_temprana_respaldo', idioma, { guardiaId: alerta.guardia_id, minutos: minutosPremura }),
      });
      await supabase.from('alertas_tempranas_guardia').update({ backup_notificado_at: ahora.toISOString() }).eq('id', alerta.id);
    }
  }
}

async function revisarIncidentes(config, ahora, idioma) {
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
      const textos = aviso('incidente_relevo_sin_resolver', idioma, {
        guardiaId: incidente.guardia_entrante_id,
        nivel: incidente.nivel_actual,
        minutos: minutosPremura,
      });

      await notificarCoordinador({
        evento: 'incidente_relevo_sin_resolver',
        prestadoraId,
        ...textos,
      });

      await notificarFamiliaSiCorresponde({
        prestadoraId,
        guardiaEntranteId: incidente.guardia_entrante_id,
        texto: textos.texto,
        idioma,
      });

      await supabase
        .from('incidentes_relevo')
        .update({ ultima_notificacion_at: ahora.toISOString(), veces_notificado: (incidente.veces_notificado ?? 0) + 1 })
        .eq('id', incidente.id);
    }

    if (backupId && !incidente.backup_notificado_at && minutosPremura >= minutosAntesBackup) {
      await notificarCoordinadorBackup({
        backupId,
        prestadoraId,
        idioma,
        ...aviso('incidente_relevo_respaldo', idioma, { guardiaId: incidente.guardia_entrante_id, minutos: minutosPremura }),
      });
      await supabase.from('incidentes_relevo').update({ backup_notificado_at: ahora.toISOString() }).eq('id', incidente.id);
    }

    if (
      faseAutomaticaActiva
      && !incidente.fase_automatica_notificada_at
      && minutosPremura >= minutosAntesFaseAutomatica
    ) {
      // Acá el sistema deja de esperar a una persona y sale a buscar quién cubre, con el orden de
      // prioridad y el texto que la Prestadora cargó en `configuracion_escalada_relevo`
      // (`utils/faseAutomaticaRelevo.js`). Nadie queda asignado: se pregunta quién puede.
      //
      // Si la búsqueda falla entera, el aviso a quien coordina sale igual. Es lo único que impide
      // que un incidente se quede esperando en silencio a un proceso que no pudo hacer nada.
      let loQueSeHizo = { contactados: 0, sinNivel: false, sinOrden: false, quedaElFamiliar: false };
      try {
        loQueSeHizo = await correrFaseAutomatica({ incidente, prestadoraId, idioma });
      } catch (err) {
        console.error(`Error corriendo la fase automática del incidente ${incidente.id}:`, err.message);
      }

      await notificarCoordinador({
        evento: 'incidente_relevo_sin_resolver',
        prestadoraId,
        ...aviso('incidente_relevo_fase_automatica', idioma, {
          guardiaId: incidente.guardia_entrante_id,
          minutosUmbral: minutosAntesFaseAutomatica,
          ...loQueSeHizo,
        }),
      });
      await supabase.from('incidentes_relevo').update({ fase_automatica_notificada_at: ahora.toISOString() }).eq('id', incidente.id);
    }
  }
}

// "Ausente sin relevo previo" es una alerta crítica: a diferencia del respaldo de avisos de
// rutina (revisarRecordatoriosPush.js), acá va push + WhatsApp a la vez, nunca uno de respaldo
// del otro. Apagado por defecto: cada
// Prestadora decide si su política es avisarle a la Familia o no (algunas prefieren no
// alarmarla si el incidente se resuelve internamente sin que llegue a necesitar su
// intervención) — CLAUDE.md §2, "configuración sobre programación".
async function notificarFamiliaSiCorresponde({ prestadoraId, guardiaEntranteId, texto, idioma }) {
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

  const { titulo } = aviso('continuidad_de_guardia', idioma);

  for (const familiaId of familiaIds) {
    await enviarPushFamilia(familiaId, {
      ...aviso('continuidad_de_guardia', idioma),
      cuerpo: texto,
      url: '/',
    });

    const telefono = telefonoPorFamilia.get(familiaId);
    if (!telefono) continue;
    try {
      // Lo empieza la Prestadora, así que sale por la plantilla del aviso, con los mismos dos
      // valores que le llegan al Coordinador: el título y el cuerpo.
      await avisarPorWhatsapp({ config, prestadoraId, telefono, valores: [titulo, texto] });
    } catch (err) {
      console.error(`Error enviando WhatsApp a Familia (incidente_relevo_sin_resolver, guardia ${guardiaEntranteId}):`, err.message);
    }
  }
}

async function notificarCoordinadorBackup({ backupId, prestadoraId, texto, idioma }) {
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('telefono, email')
    .eq('id', backupId)
    .single();

  if (!usuario) return;

  await notificarCoordinador({
    evento: 'incidente_relevo_sin_resolver',
    prestadoraId,
    ...aviso('escalada_a_respaldo', idioma),
    texto,
    telefono: usuario.telefono,
  });
}
