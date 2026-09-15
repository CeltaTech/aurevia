import {
  FUENTE_AVISO_TELEFONICO,
  FUENTE_AVISO_DEMORA_ASISTENTE,
  FUENTE_CALCULO_LLEGADA_TARDIA,
  FUENTE_SIN_AVISO_NI_SALIDA,
} from '../utils/fuentesAlertaTemprana.js';
import { IDIOMA_POR_DEFECTO, IDIOMAS_SOPORTADOS, normalizarIdioma } from './idiomas.js';

/* Qué dice cada aviso que sale del motor, en los tres idiomas.
   ===========================================================

   POR QUÉ EXISTE. Un aviso que sale por correo, por WhatsApp o al celular es texto visible, y el
   texto visible se traduce (`celtatech\CLAUDE.md` §8). Hasta acá el castellano estaba escrito
   adentro de cada archivo que mandaba el aviso —una docena de archivos—, así que el producto
   hablaba tres idiomas en la pantalla y uno solo apenas salía de ella.

   CADA AVISO ES UNA FUNCIÓN DE SUS DATOS, no una plantilla con marcadores. Un aviso no es una
   frase con huecos: en castellano el plazo se dice «hace 20 minutos» y en inglés «20 minutes
   ago», y los nombres de una lista se cierran con «y», con «and» o con «e». Eso se resuelve
   escribiendo la frase entera en cada idioma, que además es la única forma de que quien traduzca
   vea lo que va a leer la persona.

   QUIEN LLAMA NO ELIGE PALABRAS. Los emisores pasan hechos —una fecha, una cantidad, si el
   Asistente marcó su salida o no— y reciben el asunto y el texto ya armados. Ninguna decisión de
   redacción queda del lado del emisor, porque ahí volvería a existir en un solo idioma.

   LOS TRES BLOQUES TIENEN LAS MISMAS CLAVES, y una prueba lo comprueba: un aviso que existe en
   castellano y no en portugués saldría en castellano sin que nadie se entere. */

/** «Ana», «Ana y Luis», «Ana, Luis y Marta» — con la conjunción que use cada idioma. */
function unirNombres(nombres, conjuncion, siNoHayNinguno) {
  const limpios = (nombres ?? []).filter(Boolean);
  if (limpios.length === 0) return siNoHayNinguno;
  return [limpios.slice(0, -1).join(', '), limpios.at(-1)].filter(Boolean).join(` ${conjuncion} `);
}

/* Cuánto hace, en la unidad que se entiende de un vistazo. Por debajo de dos horas se dice en
   minutos y por encima en horas: «185 minutos» obliga a hacer la cuenta justo cuando quien lee
   tiene que decidir rápido. */
function enMinutosUHoras(minutos, unidadMinutos, unidadHoras) {
  const redondeado = Math.round(minutos);
  return redondeado < 120
    ? `${redondeado} ${unidadMinutos}`
    : `${Math.round(redondeado / 60)} ${unidadHoras}`;
}

const ES = {
  origen_de_alerta: ({ fuente }) => ({
    texto: {
      [FUENTE_AVISO_TELEFONICO]: 'aviso telefónico registrado por la Prestadora',
      [FUENTE_AVISO_DEMORA_ASISTENTE]: 'aviso de demora dado por el Asistente desde la aplicación',
      [FUENTE_CALCULO_LLEGADA_TARDIA]: 'cuenta del sistema: la hora estimada de llegada pasa la hora de inicio',
      [FUENTE_SIN_AVISO_NI_SALIDA]: 'llegó la hora de inicio sin marca de salida, sin aviso de demora y sin llegada registrada',
    }[fuente] ?? 'origen sin registrar',
  }),

  guardia_sin_cerrar: (d) => ({
    asunto: 'Guardia terminada y todavía sin cerrar',
    texto: [
      `Guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${unirNombres(d.pacientes, 'y', 'Paciente sin nombre cargado')}.`,
      `A cargo de ${d.asistente || 'Asistente sin asignar'}. Terminaba hace ${enMinutosUHoras(d.minutosDeAtraso, 'minutos', 'horas')} y sigue abierta.`,
      d.salidaMarcada
        ? 'El Asistente ya marcó su salida: falta confirmar que quedó todo hecho.'
        : 'El Asistente todavía no marcó su salida.',
      d.veces > 1 ? `Es el aviso número ${d.veces} de esta misma guardia.` : null,
    ].filter(Boolean).join('\n'),
  }),

  guardia_sin_cerrar_grave: (d) => ({
    asunto: 'Urgente: una guardia lleva horas sin cerrarse',
    texto: [
      `Guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${unirNombres(d.pacientes, 'y', 'Paciente sin nombre cargado')}.`,
      `A cargo de ${d.asistente || 'Asistente sin asignar'}. Terminaba hace ${enMinutosUHoras(d.minutosDeAtraso, 'minutos', 'horas')} y sigue abierta.`,
      'Ya se avisó al Coordinador y la guardia sigue sin cerrarse. Hace falta que intervenga alguien con autoridad para resolverlo.',
      d.salidaMarcada
        ? 'El Asistente marcó su salida, así que se fue del domicilio: lo que falta es confirmar que quedó todo hecho.'
        : 'El Asistente no marcó su salida, así que no hay constancia de que la guardia haya terminado ni de quién quedó a cargo del Paciente.',
      'Este aviso sale una sola vez por guardia.',
    ].join('\n'),
  }),

  guardia_sin_cerrar_respaldo: (d) => ({
    texto: `La guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, sigue sin cerrarse ${Math.round(d.minutosDeAtraso)} minutos después del plazo.`,
  }),

  escalada_a_respaldo: () => ({ asunto: 'Escalada a Coordinador de respaldo' }),

  alerta_temprana_sin_resolver: (d) => ({
    asunto: 'Alerta temprana de posible ausencia sin resolver',
    // El origen va adelante del motivo a propósito: quien lee tiene que poder distinguir de un
    // vistazo un aviso que dio una persona de una cuenta que sacó el sistema.
    texto: `Guardia ${d.guardiaId}. Origen: ${d.origen}. Motivo: ${d.motivo ?? '—'}. Sin resolver hace ${Math.round(d.minutos)} minutos.`,
  }),

  alerta_temprana_respaldo: (d) => ({
    texto: `Alerta temprana de guardia ${d.guardiaId} sigue sin resolver hace ${Math.round(d.minutos)} minutos.`,
  }),

  aviso_demora_asistente: (d) => ({
    asunto: 'Aviso de demora del Asistente',
    texto: `Guardia del ${d.fecha} a las ${d.horaInicio}. Origen: ${d.origen}. Motivo: ${d.motivo}.`,
  }),

  incidente_relevo_sin_resolver: (d) => ({
    asunto: 'Incidente de continuidad de guardia sin resolver',
    texto: `Guardia ${d.guardiaId}, nivel de escalada actual: ${d.nivel}. Sin resolver hace ${Math.round(d.minutos)} minutos.`,
  }),

  incidente_relevo_respaldo: (d) => ({
    texto: `Incidente de relevo de guardia ${d.guardiaId} sigue sin resolver hace ${Math.round(d.minutos)} minutos.`,
  }),

  incidente_relevo_fase_automatica: (d) => ({
    asunto: 'Fase automática de escalada: se salió a buscar quién cubre',
    texto: [
      `Guardia ${d.guardiaId} superó el umbral de fase automática (${d.minutosUmbral} minutos) sin resolverse.`,
      d.sinNivel
        ? 'No hay ningún nivel de escalada configurado para este incidente, así que no se contactó a nadie.'
        : d.sinOrden
          ? 'El nivel de escalada no tiene cargado ningún orden de prioridad, así que no se contactó a nadie.'
          : d.contactados > 0
            ? `Se le escribió a ${d.contactados} ${d.contactados === 1 ? 'Asistente' : 'Asistentes'}, en el orden de prioridad configurado.`
            : 'No había nadie disponible para contactar en el orden de prioridad configurado.',
      d.quedaElFamiliar
        ? 'El orden de prioridad incluye al familiar: esa opción la tiene que autorizar una persona, así que queda en sus manos.'
        : null,
      'Nadie quedó asignado a la guardia: quien conteste lo tiene que asignar una persona.',
    ].filter(Boolean).join('\n'),
  }),

  convocatoria_de_relevo: (d) => ({
    titulo: `Se busca quién cubra una guardia: ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}`,
  }),

  continuidad_de_guardia: () => ({ titulo: 'Continuidad de guardia' }),

  cambio_de_asistente: (d) => ({
    asunto: d.turnos.length === 1 ? 'Cambió el Asistente de una guardia' : 'Cambió el Asistente de varias guardias',
    texto: [
      d.asistenteAnterior
        ? `${d.asistenteAnterior} ya no hace ${d.turnos.length === 1 ? 'este turno' : 'estos turnos'}. Ahora ${d.turnos.length === 1 ? 'lo hace' : 'los hace'} ${d.asistenteNuevo ?? 'un Asistente sin nombre cargado'}.`
        : `${d.turnos.length === 1 ? 'Este turno pasa' : 'Estos turnos pasan'} a ${d.asistenteNuevo ?? 'un Asistente sin nombre cargado'}.`,
      ...d.turnos.map((turno) =>
        `${turno.fecha}, de ${turno.horaInicio} a ${turno.horaFin}, para ${unirNombres(turno.pacientes, 'y', 'Paciente sin nombre cargado')}.`),
    ].join('\n'),
  }),

  cambio_de_asistente_familia: (d) => ({
    titulo: 'Cambio de Asistente',
    cuerpo: d.turnos.length === 1
      ? `La guardia del ${d.turnos[0].fecha}, de ${d.turnos[0].horaInicio} a ${d.turnos[0].horaFin}, la hace ${d.asistenteNuevo ?? 'otro Asistente'}.`
      : `${d.turnos.length} guardias, desde la del ${d.turnos[0].fecha}, las hace ${d.asistenteNuevo ?? 'otro Asistente'}.`,
  }),

  guardia_sin_cubrir: (d) => ({
    asunto: d.yaEmpezo ? 'Guardia sin cubrir: la hora de inicio ya pasó' : 'Guardia sin cubrir',
    texto: [
      `Guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${unirNombres(d.pacientes, 'y', 'Paciente sin nombre cargado')}.`,
      d.yaEmpezo ? `Tendría que haber empezado hace ${d.horas} h.` : `Empieza en ${d.horas} h.`,
      estadoDeLaBusquedaES(d.busqueda),
      d.veces > 1 ? `Es el aviso número ${d.veces} de esta misma guardia.` : null,
    ].filter(Boolean).join('\n'),
  }),

  alerta_ia_coordinador: (d) => ({
    asunto: d.esRoja ? 'Alerta ROJA de IA — Paciente' : 'Alerta AMARILLA de IA — Paciente',
    texto: 'Ver detalle en el Panel.',
  }),

  alerta_ia_familia: (d) => ({
    titulo: d.esRoja ? 'Alerta sobre el Paciente' : 'Novedad sobre el Paciente',
    cuerpo: d.esRoja
      ? 'Hay una novedad importante para revisar en la app.'
      : 'Hay algo para mirar sin apuro en la app.',
  }),

  vencimiento_documentos: (d) => ({
    asunto: `Vencimientos próximos de ${d.etiqueta} — ${d.documentos.length} Asistente(s)`,
    texto: `Los siguientes Asistentes tienen ${d.etiqueta} vencido o por vencer dentro de ${d.dias} días:\n\n${d.documentos.map((x) => `${x.nombre}: vence ${x.fechaVencimiento}`).join('\n')}`,
  }),

  mfa_codigo_recuperacion: (d) => ({
    asunto: `Código de recuperación de acceso — ${d.producto}`,
    texto: `El código de recuperación es ${d.codigo}. Vence en ${d.minutos} minutos. Si no lo pidió usted, puede ignorar este correo.`,
  }),

  codigo_instruccion_circulo: (d) => ({
    asunto: `Código para confirmar los accesos de su círculo familiar — ${d.remite}`,
    texto: `Su código para confirmar la instrucción sobre los accesos de su círculo familiar es ${d.codigo}. Vence en ${d.minutos} minutos. Si no lo pidió usted, no lo use y avise a ${d.remite}.`,
  }),

  activacion_cuenta: (d) => ({
    asunto: `Activación de la cuenta en ${d.empresa}`,
    texto: `Hola ${d.nombre},\n\nYa está creada la cuenta en ${d.empresa}. Para poder entrar desde el celular hace falta activarla.\n\nSe activa acá (el link vence en ${d.dias} días):\n${d.link}\n\nSi no esperaba este correo, puede ignorarlo.${d.conMarcaDelProducto ? `\n\n—\nCon la tecnología de ${d.producto}` : ''}`,
  }),

  estado_postulacion: (d) => ({
    asunto: `${d.empresa} — Actualización de la postulación`,
    texto: [
      `Hola ${d.nombre || ''},`,
      '',
      {
        en_revision: 'La postulación como Asistente Integral está en revisión.',
        aprobado: 'La postulación como Asistente Integral fue aprobada. Pronto nos pondremos en contacto para los próximos pasos.',
        rechazado: `Gracias por el interés en ${d.empresa}. En esta oportunidad no vamos a avanzar con la postulación.`,
      }[d.estado],
      '',
      `Equipo ${d.empresa}`,
    ].join('\n'),
  }),

  nueva_postulacion_asistente: (d) => ({
    asunto: `Nueva postulación de Asistente — ${d.nombre}`,
    texto: `Nombre: ${d.nombre}\nDNI: ${d.dni}\nTeléfono: ${d.telefono}\nEmail: ${d.email}\nEspecialidades: ${d.especialidades}\nZonas: ${d.zonas}\nDisponibilidad: ${d.disponibilidad}\nSituación fiscal: ${d.situacionFiscal}`,
  }),

  nueva_solicitud_servicio: (d) => ({
    asunto: `Nueva solicitud de servicio — ${d.nombre}`,
    texto: `Nombre: ${d.nombre}\nTeléfono: ${d.telefono}\nEmail: ${d.email}\nLocalidad: ${d.localidad}\nServicio: ${d.tipoServicio} (${d.modalidad})\nDías y horario: ${d.diasHorario}\nDescripción: ${d.descripcion ?? '—'}`,
  }),

  mensaje_del_coordinador: () => ({ titulo: 'Nuevo mensaje del coordinador' }),

  guardia_asignada: (d) => ({
    titulo: 'Nueva guardia asignada',
    cuerpo: `Hay una guardia asignada el ${d.fecha} a las ${d.horaInicio}.`,
  }),

  recordatorio_de_guardia: (d) => ({
    titulo: 'Recordatorio de guardia',
    cuerpo: `La guardia del ${d.fecha} empieza a las ${d.horaInicio}.`,
  }),

  fin_periodo_sin_cargo: (d) => ({
    titulo: 'Termina el período sin cargo',
    cuerpo: `El ${d.dia} empieza a cobrarse ${d.importe}. Si prefiere no continuar, puede darse de baja antes desde la aplicación.`,
  }),

  cobro_no_realizado: (d) => ({
    titulo: 'El cobro no se pudo hacer',
    cuerpo: `No se pudo cobrar ${d.importe}. El acceso sigue funcionando hasta el ${d.dia}; si para entonces el cobro no entró, queda suspendido.`,
  }),

  // No dice por qué se cerró el servicio: el motivo es del Paciente y de su Familia. Y no dice
  // nada del desempeño del Asistente, porque este aviso sale justamente cuando el cierre no
  // tuvo que ver con él.
  cese_de_servicio: () => ({
    titulo: 'Finalización de servicio',
    cuerpo: 'Se cerró el servicio en el que participaba. Para más información, puede comunicarse con el coordinador.',
  }),
};

// El aviso tiene que servir para actuar, no solo para enterarse. Por eso dice en qué punto está la
// búsqueda: si todavía no se ofreció a nadie, si se ofreció y nadie contestó, o si contestaron
// todos que no. Son tres situaciones con tres acciones distintas.
function estadoDeLaBusquedaES({ ofrecida, invitados, sinContestar, aceptaron }) {
  if (!ofrecida) return 'Todavía no se le ofreció a ningún Asistente.';
  if (invitados === 0) return 'Está publicada, pero no se invitó a ningún Asistente en particular.';
  if (sinContestar > 0) return `Se invitó a ${invitados} Asistente(s) y ${sinContestar} todavía no contestaron.`;
  if (aceptaron > 0) return `${aceptaron} Asistente(s) aceptaron pero la guardia sigue sin asignar.`;
  return `Se invitó a ${invitados} Asistente(s) y todos rechazaron.`;
}

const EN = {
  origen_de_alerta: ({ fuente }) => ({
    texto: {
      [FUENTE_AVISO_TELEFONICO]: 'phone call logged by the care provider',
      [FUENTE_AVISO_DEMORA_ASISTENTE]: 'delay reported by the care worker from the app',
      [FUENTE_CALCULO_LLEGADA_TARDIA]: 'system estimate: the expected arrival time is past the start time',
      [FUENTE_SIN_AVISO_NI_SALIDA]: 'the start time came with no departure recorded, no delay reported and no arrival logged',
    }[fuente] ?? 'source not recorded',
  }),

  guardia_sin_cerrar: (d) => ({
    asunto: 'Shift finished and still open',
    texto: [
      `Shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${unirNombres(d.pacientes, 'and', 'patient with no name on file')}.`,
      `Assigned to ${d.asistente || 'no care worker assigned'}. It was due to end ${enMinutosUHoras(d.minutosDeAtraso, 'minutes', 'hours')} ago and is still open.`,
      d.salidaMarcada
        ? 'The care worker already clocked out: what is missing is the confirmation that everything was done.'
        : 'The care worker has not clocked out yet.',
      d.veces > 1 ? `This is notice number ${d.veces} for this same shift.` : null,
    ].filter(Boolean).join('\n'),
  }),

  guardia_sin_cerrar_grave: (d) => ({
    asunto: 'Urgent: a shift has been open for hours',
    texto: [
      `Shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${unirNombres(d.pacientes, 'and', 'patient with no name on file')}.`,
      `Assigned to ${d.asistente || 'no care worker assigned'}. It was due to end ${enMinutosUHoras(d.minutosDeAtraso, 'minutes', 'hours')} ago and is still open.`,
      'The coordinator has already been notified and the shift is still open. Someone with authority needs to step in.',
      d.salidaMarcada
        ? 'The care worker clocked out, so they left the home: what is missing is the confirmation that everything was done.'
        : 'The care worker did not clock out, so there is no record that the shift ended or of who was left in charge of the patient.',
      'This notice is sent only once per shift.',
    ].join('\n'),
  }),

  guardia_sin_cerrar_respaldo: (d) => ({
    texto: `The shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, is still open ${Math.round(d.minutosDeAtraso)} minutes past the deadline.`,
  }),

  escalada_a_respaldo: () => ({ asunto: 'Escalated to the backup coordinator' }),

  alerta_temprana_sin_resolver: (d) => ({
    asunto: 'Early warning of a possible no-show, unresolved',
    texto: `Shift ${d.guardiaId}. Source: ${d.origen}. Reason: ${d.motivo ?? '—'}. Unresolved for ${Math.round(d.minutos)} minutes.`,
  }),

  alerta_temprana_respaldo: (d) => ({
    texto: `The early warning for shift ${d.guardiaId} has been unresolved for ${Math.round(d.minutos)} minutes.`,
  }),

  aviso_demora_asistente: (d) => ({
    asunto: 'Care worker reported a delay',
    texto: `Shift on ${d.fecha} at ${d.horaInicio}. Source: ${d.origen}. Reason: ${d.motivo}.`,
  }),

  incidente_relevo_sin_resolver: (d) => ({
    asunto: 'Shift handover incident unresolved',
    texto: `Shift ${d.guardiaId}, current escalation level: ${d.nivel}. Unresolved for ${Math.round(d.minutos)} minutes.`,
  }),

  incidente_relevo_respaldo: (d) => ({
    texto: `The handover incident for shift ${d.guardiaId} has been unresolved for ${Math.round(d.minutos)} minutes.`,
  }),

  incidente_relevo_fase_automatica: (d) => ({
    asunto: 'Automatic escalation phase: the search for cover has started',
    texto: [
      `Shift ${d.guardiaId} passed the automatic phase threshold (${d.minutosUmbral} minutes) without being resolved.`,
      d.sinNivel
        ? 'There is no escalation level configured for this incident, so nobody was contacted.'
        : d.sinOrden
          ? 'The escalation level has no priority order on file, so nobody was contacted.'
          : d.contactados > 0
            ? `${d.contactados} ${d.contactados === 1 ? 'care worker was' : 'care workers were'} contacted, in the configured priority order.`
            : 'Nobody in the configured priority order was available to contact.',
      d.quedaElFamiliar
        ? 'The priority order includes the family member: that option has to be authorised by a person, so it is left to you.'
        : null,
      'Nobody has been assigned to the shift: whoever answers still has to be assigned by a person.',
    ].filter(Boolean).join('\n'),
  }),

  convocatoria_de_relevo: (d) => ({
    titulo: `Cover needed for a shift: ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}`,
  }),

  continuidad_de_guardia: () => ({ titulo: 'Shift continuity' }),

  cambio_de_asistente: (d) => ({
    asunto: d.turnos.length === 1 ? 'The Assistant on a shift changed' : 'The Assistant on several shifts changed',
    texto: [
      d.asistenteAnterior
        ? `${d.asistenteAnterior} no longer covers ${d.turnos.length === 1 ? 'this shift' : 'these shifts'}. ${d.asistenteNuevo ?? 'An Assistant with no name on file'} covers ${d.turnos.length === 1 ? 'it' : 'them'} now.`
        : `${d.turnos.length === 1 ? 'This shift goes' : 'These shifts go'} to ${d.asistenteNuevo ?? 'an Assistant with no name on file'}.`,
      ...d.turnos.map((turno) =>
        `${turno.fecha}, from ${turno.horaInicio} to ${turno.horaFin}, for ${unirNombres(turno.pacientes, 'and', 'patient with no name on file')}.`),
    ].join('\n'),
  }),

  cambio_de_asistente_familia: (d) => ({
    titulo: 'Change of Assistant',
    cuerpo: d.turnos.length === 1
      ? `The shift on ${d.turnos[0].fecha}, from ${d.turnos[0].horaInicio} to ${d.turnos[0].horaFin}, will be covered by ${d.asistenteNuevo ?? 'another Assistant'}.`
      : `${d.turnos.length} shifts, starting with the one on ${d.turnos[0].fecha}, will be covered by ${d.asistenteNuevo ?? 'another Assistant'}.`,
  }),

  guardia_sin_cubrir: (d) => ({
    asunto: d.yaEmpezo ? 'Shift not covered: the start time has passed' : 'Shift not covered',
    texto: [
      `Shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${unirNombres(d.pacientes, 'and', 'patient with no name on file')}.`,
      d.yaEmpezo ? `It should have started ${d.horas} h ago.` : `It starts in ${d.horas} h.`,
      estadoDeLaBusquedaEN(d.busqueda),
      d.veces > 1 ? `This is notice number ${d.veces} for this same shift.` : null,
    ].filter(Boolean).join('\n'),
  }),

  alerta_ia_coordinador: (d) => ({
    asunto: d.esRoja ? 'RED AI alert — patient' : 'YELLOW AI alert — patient',
    texto: 'See the details in the panel.',
  }),

  alerta_ia_familia: (d) => ({
    titulo: d.esRoja ? 'Alert about the patient' : 'Update about the patient',
    cuerpo: d.esRoja
      ? 'There is something important to review in the app.'
      : 'There is something to look at in the app, no rush.',
  }),

  vencimiento_documentos: (d) => ({
    asunto: `${d.etiqueta} expiring soon — ${d.documentos.length} care worker(s)`,
    texto: `The following care workers have their ${d.etiqueta} expired or expiring within ${d.dias} days:\n\n${d.documentos.map((x) => `${x.nombre}: expires ${x.fechaVencimiento}`).join('\n')}`,
  }),

  mfa_codigo_recuperacion: (d) => ({
    asunto: `Access recovery code — ${d.producto}`,
    texto: `The recovery code is ${d.codigo}. It expires in ${d.minutos} minutes. If you did not request it, you can ignore this email.`,
  }),

  codigo_instruccion_circulo: (d) => ({
    asunto: `Code to confirm your family circle's access — ${d.remite}`,
    texto: `Your code to confirm the instruction about your family circle's access is ${d.codigo}. It expires in ${d.minutos} minutes. If you did not request it, do not use it and let ${d.remite} know.`,
  }),

  activacion_cuenta: (d) => ({
    asunto: `Activate your ${d.empresa} account`,
    texto: `Hi ${d.nombre},\n\nYour ${d.empresa} account has been created. To sign in from your phone you need to activate it.\n\nActivate it here (this link expires in ${d.dias} days):\n${d.link}\n\nIf you were not expecting this email, you can ignore it.${d.conMarcaDelProducto ? `\n\n—\nPowered by ${d.producto}` : ''}`,
  }),

  estado_postulacion: (d) => ({
    asunto: `${d.empresa} — Update on your application`,
    texto: [
      `Hi ${d.nombre || ''},`,
      '',
      {
        en_revision: 'Your application as an Asistente Integral is under review.',
        aprobado: 'Your application as an Asistente Integral was approved. We will contact you soon about next steps.',
        rechazado: `Thank you for your interest in ${d.empresa}. We will not be moving forward with your application at this time.`,
      }[d.estado],
      '',
      `${d.empresa} Team`,
    ].join('\n'),
  }),

  nueva_postulacion_asistente: (d) => ({
    asunto: `New care worker application — ${d.nombre}`,
    texto: `Name: ${d.nombre}\nID number: ${d.dni}\nPhone: ${d.telefono}\nEmail: ${d.email}\nSpecialties: ${d.especialidades}\nAreas: ${d.zonas}\nAvailability: ${d.disponibilidad}\nTax status: ${d.situacionFiscal}`,
  }),

  nueva_solicitud_servicio: (d) => ({
    asunto: `New service request — ${d.nombre}`,
    texto: `Name: ${d.nombre}\nPhone: ${d.telefono}\nEmail: ${d.email}\nTown: ${d.localidad}\nService: ${d.tipoServicio} (${d.modalidad})\nDays and hours: ${d.diasHorario}\nDescription: ${d.descripcion ?? '—'}`,
  }),

  mensaje_del_coordinador: () => ({ titulo: 'New message from the coordinator' }),

  guardia_asignada: (d) => ({
    titulo: 'New shift assigned',
    cuerpo: `A shift has been assigned on ${d.fecha} at ${d.horaInicio}.`,
  }),

  recordatorio_de_guardia: (d) => ({
    titulo: 'Shift reminder',
    cuerpo: `The shift on ${d.fecha} starts at ${d.horaInicio}.`,
  }),

  fin_periodo_sin_cargo: (d) => ({
    titulo: 'The free period is ending',
    cuerpo: `On ${d.dia} charging starts at ${d.importe}. If you would rather not continue, you can cancel before then from the app.`,
  }),

  cobro_no_realizado: (d) => ({
    titulo: 'The payment could not be taken',
    cuerpo: `${d.importe} could not be charged. Access keeps working until ${d.dia}; if the payment has not come through by then, it is suspended.`,
  }),

  cese_de_servicio: () => ({
    titulo: 'Service ended',
    cuerpo: 'The service you were part of has ended. For more information, please get in touch with the coordinator.',
  }),
};

function estadoDeLaBusquedaEN({ ofrecida, invitados, sinContestar, aceptaron }) {
  if (!ofrecida) return 'It has not been offered to any care worker yet.';
  if (invitados === 0) return 'It is published, but no particular care worker was invited.';
  if (sinContestar > 0) return `${invitados} care worker(s) were invited and ${sinContestar} have not replied yet.`;
  if (aceptaron > 0) return `${aceptaron} care worker(s) accepted but the shift is still unassigned.`;
  return `${invitados} care worker(s) were invited and all of them declined.`;
}

const PT = {
  origen_de_alerta: ({ fuente }) => ({
    texto: {
      [FUENTE_AVISO_TELEFONICO]: 'aviso por telefone registrado pela Prestadora',
      [FUENTE_AVISO_DEMORA_ASISTENTE]: 'aviso de atraso dado pelo Asistente pelo aplicativo',
      [FUENTE_CALCULO_LLEGADA_TARDIA]: 'cálculo do sistema: o horário previsto de chegada passa do horário de início',
      [FUENTE_SIN_AVISO_NI_SALIDA]: 'chegou o horário de início sem registro de saída, sem aviso de atraso e sem chegada registrada',
    }[fuente] ?? 'origem sem registro',
  }),

  guardia_sin_cerrar: (d) => ({
    asunto: 'Plantão terminado e ainda sem fechar',
    texto: [
      `Plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')}.`,
      `A cargo de ${d.asistente || 'Asistente sem atribuição'}. Terminava há ${enMinutosUHoras(d.minutosDeAtraso, 'minutos', 'horas')} e continua aberto.`,
      d.salidaMarcada
        ? 'O Asistente já registrou a saída: falta confirmar que ficou tudo feito.'
        : 'O Asistente ainda não registrou a saída.',
      d.veces > 1 ? `É o aviso número ${d.veces} deste mesmo plantão.` : null,
    ].filter(Boolean).join('\n'),
  }),

  guardia_sin_cerrar_grave: (d) => ({
    asunto: 'Urgente: um plantão está há horas sem fechar',
    texto: [
      `Plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')}.`,
      `A cargo de ${d.asistente || 'Asistente sem atribuição'}. Terminava há ${enMinutosUHoras(d.minutosDeAtraso, 'minutos', 'horas')} e continua aberto.`,
      'O Coordenador já foi avisado e o plantão continua sem fechar. É preciso que alguém com autoridade intervenha.',
      d.salidaMarcada
        ? 'O Asistente registrou a saída, então saiu do domicílio: falta confirmar que ficou tudo feito.'
        : 'O Asistente não registrou a saída, então não há constância de que o plantão tenha terminado nem de quem ficou a cargo do Paciente.',
      'Este aviso sai uma única vez por plantão.',
    ].join('\n'),
  }),

  guardia_sin_cerrar_respaldo: (d) => ({
    texto: `O plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, continua sem fechar ${Math.round(d.minutosDeAtraso)} minutos depois do prazo.`,
  }),

  escalada_a_respaldo: () => ({ asunto: 'Escalado ao Coordenador de retaguarda' }),

  alerta_temprana_sin_resolver: (d) => ({
    asunto: 'Alerta antecipado de possível ausência sem resolver',
    texto: `Plantão ${d.guardiaId}. Origem: ${d.origen}. Motivo: ${d.motivo ?? '—'}. Sem resolver há ${Math.round(d.minutos)} minutos.`,
  }),

  alerta_temprana_respaldo: (d) => ({
    texto: `O alerta antecipado do plantão ${d.guardiaId} continua sem resolver há ${Math.round(d.minutos)} minutos.`,
  }),

  aviso_demora_asistente: (d) => ({
    asunto: 'Aviso de atraso do Asistente',
    texto: `Plantão de ${d.fecha} às ${d.horaInicio}. Origem: ${d.origen}. Motivo: ${d.motivo}.`,
  }),

  incidente_relevo_sin_resolver: (d) => ({
    asunto: 'Incidente de continuidade de plantão sem resolver',
    texto: `Plantão ${d.guardiaId}, nível de escalada atual: ${d.nivel}. Sem resolver há ${Math.round(d.minutos)} minutos.`,
  }),

  incidente_relevo_respaldo: (d) => ({
    texto: `O incidente de rendição do plantão ${d.guardiaId} continua sem resolver há ${Math.round(d.minutos)} minutos.`,
  }),

  incidente_relevo_fase_automatica: (d) => ({
    asunto: 'Fase automática de escalada: saiu-se à procura de quem cubra',
    texto: [
      `O plantão ${d.guardiaId} passou o limite da fase automática (${d.minutosUmbral} minutos) sem se resolver.`,
      d.sinNivel
        ? 'Não há nenhum nível de escalada configurado para este incidente, portanto ninguém foi contatado.'
        : d.sinOrden
          ? 'O nível de escalada não tem nenhuma ordem de prioridade cadastrada, portanto ninguém foi contatado.'
          : d.contactados > 0
            ? `${d.contactados} ${d.contactados === 1 ? 'Assistente foi contatado' : 'Assistentes foram contatados'}, na ordem de prioridade configurada.`
            : 'Não havia ninguém disponível para contatar na ordem de prioridade configurada.',
      d.quedaElFamiliar
        ? 'A ordem de prioridade inclui o familiar: essa opção precisa ser autorizada por uma pessoa, portanto fica nas suas mãos.'
        : null,
      'Ninguém ficou designado ao plantão: quem responder ainda precisa ser designado por uma pessoa.',
    ].filter(Boolean).join('\n'),
  }),

  convocatoria_de_relevo: (d) => ({
    titulo: `Procura-se quem cubra um plantão: ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}`,
  }),

  continuidad_de_guardia: () => ({ titulo: 'Continuidade de plantão' }),

  cambio_de_asistente: (d) => ({
    asunto: d.turnos.length === 1 ? 'O Assistente de um plantão mudou' : 'O Assistente de vários plantões mudou',
    texto: [
      d.asistenteAnterior
        ? `${d.asistenteAnterior} não faz mais ${d.turnos.length === 1 ? 'este plantão' : 'estes plantões'}. Agora ${d.turnos.length === 1 ? 'é feito' : 'são feitos'} por ${d.asistenteNuevo ?? 'um Assistente sem nome cadastrado'}.`
        : `${d.turnos.length === 1 ? 'Este plantão passa' : 'Estes plantões passam'} para ${d.asistenteNuevo ?? 'um Assistente sem nome cadastrado'}.`,
      ...d.turnos.map((turno) =>
        `${turno.fecha}, das ${turno.horaInicio} às ${turno.horaFin}, para ${unirNombres(turno.pacientes, 'e', 'Paciente sem nome cadastrado')}.`),
    ].join('\n'),
  }),

  cambio_de_asistente_familia: (d) => ({
    titulo: 'Mudança de Assistente',
    cuerpo: d.turnos.length === 1
      ? `O plantão de ${d.turnos[0].fecha}, das ${d.turnos[0].horaInicio} às ${d.turnos[0].horaFin}, será feito por ${d.asistenteNuevo ?? 'outro Assistente'}.`
      : `${d.turnos.length} plantões, a partir do de ${d.turnos[0].fecha}, serão feitos por ${d.asistenteNuevo ?? 'outro Assistente'}.`,
  }),

  guardia_sin_cubrir: (d) => ({
    asunto: d.yaEmpezo ? 'Plantão sem cobertura: o horário de início já passou' : 'Plantão sem cobertura',
    texto: [
      `Plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')}.`,
      d.yaEmpezo ? `Deveria ter começado há ${d.horas} h.` : `Começa em ${d.horas} h.`,
      estadoDeLaBusquedaPT(d.busqueda),
      d.veces > 1 ? `É o aviso número ${d.veces} deste mesmo plantão.` : null,
    ].filter(Boolean).join('\n'),
  }),

  alerta_ia_coordinador: (d) => ({
    asunto: d.esRoja ? 'Alerta VERMELHO de IA — Paciente' : 'Alerta AMARELO de IA — Paciente',
    texto: 'Ver o detalhe no Painel.',
  }),

  alerta_ia_familia: (d) => ({
    titulo: d.esRoja ? 'Alerta sobre o Paciente' : 'Novidade sobre o Paciente',
    cuerpo: d.esRoja
      ? 'Há uma novidade importante para revisar no aplicativo.'
      : 'Há algo para olhar sem pressa no aplicativo.',
  }),

  vencimiento_documentos: (d) => ({
    asunto: `Vencimentos próximos de ${d.etiqueta} — ${d.documentos.length} Asistente(s)`,
    texto: `Os seguintes Asistentes têm ${d.etiqueta} vencido ou a vencer dentro de ${d.dias} dias:\n\n${d.documentos.map((x) => `${x.nombre}: vence ${x.fechaVencimiento}`).join('\n')}`,
  }),

  mfa_codigo_recuperacion: (d) => ({
    asunto: `Código de recuperação de acesso — ${d.producto}`,
    texto: `O código de recuperação é ${d.codigo}. Vence em ${d.minutos} minutos. Se não foi você que pediu, pode ignorar este email.`,
  }),

  codigo_instruccion_circulo: (d) => ({
    asunto: `Código para confirmar os acessos do seu círculo familiar — ${d.remite}`,
    texto: `O seu código para confirmar a instrução sobre os acessos do seu círculo familiar é ${d.codigo}. Vence em ${d.minutos} minutos. Se não foi você que pediu, não o use e avise ${d.remite}.`,
  }),

  activacion_cuenta: (d) => ({
    asunto: `Ativação da conta na ${d.empresa}`,
    texto: `Olá ${d.nombre},\n\nA conta na ${d.empresa} já está criada. Para acessar pelo celular é preciso ativá-la.\n\nA ativação é feita aqui (o link expira em ${d.dias} dias):\n${d.link}\n\nSe não esperava este email, pode ignorá-lo.${d.conMarcaDelProducto ? `\n\n—\nCom a tecnologia de ${d.producto}` : ''}`,
  }),

  estado_postulacion: (d) => ({
    asunto: `${d.empresa} — Atualização da candidatura`,
    texto: [
      `Olá ${d.nombre || ''},`,
      '',
      {
        en_revision: 'A candidatura como Asistente Integral está em análise.',
        aprobado: 'A candidatura como Asistente Integral foi aprovada. Em breve entraremos em contato para os próximos passos.',
        rechazado: `Obrigado pelo interesse na ${d.empresa}. Desta vez não vamos avançar com a candidatura.`,
      }[d.estado],
      '',
      `Equipe ${d.empresa}`,
    ].join('\n'),
  }),

  nueva_postulacion_asistente: (d) => ({
    asunto: `Nova candidatura de Asistente — ${d.nombre}`,
    texto: `Nome: ${d.nombre}\nDocumento: ${d.dni}\nTelefone: ${d.telefono}\nEmail: ${d.email}\nEspecialidades: ${d.especialidades}\nZonas: ${d.zonas}\nDisponibilidade: ${d.disponibilidad}\nSituação fiscal: ${d.situacionFiscal}`,
  }),

  nueva_solicitud_servicio: (d) => ({
    asunto: `Nova solicitação de serviço — ${d.nombre}`,
    texto: `Nome: ${d.nombre}\nTelefone: ${d.telefono}\nEmail: ${d.email}\nLocalidade: ${d.localidad}\nServiço: ${d.tipoServicio} (${d.modalidad})\nDias e horário: ${d.diasHorario}\nDescrição: ${d.descripcion ?? '—'}`,
  }),

  mensaje_del_coordinador: () => ({ titulo: 'Nova mensagem do coordenador' }),

  guardia_asignada: (d) => ({
    titulo: 'Novo plantão atribuído',
    cuerpo: `Há um plantão atribuído no dia ${d.fecha} às ${d.horaInicio}.`,
  }),

  recordatorio_de_guardia: (d) => ({
    titulo: 'Lembrete de plantão',
    cuerpo: `O plantão do dia ${d.fecha} começa às ${d.horaInicio}.`,
  }),

  fin_periodo_sin_cargo: (d) => ({
    titulo: 'Termina o período sem cobrança',
    cuerpo: `Em ${d.dia} começa a ser cobrado ${d.importe}. Se preferir não continuar, pode cancelar antes pelo aplicativo.`,
  }),

  cobro_no_realizado: (d) => ({
    titulo: 'A cobrança não pôde ser feita',
    cuerpo: `Não foi possível cobrar ${d.importe}. O acesso continua funcionando até ${d.dia}; se até lá a cobrança não entrar, fica suspenso.`,
  }),

  cese_de_servicio: () => ({
    titulo: 'Fim do serviço',
    cuerpo: 'O serviço do qual participava foi encerrado. Para mais informações, pode entrar em contato com o coordenador.',
  }),
};

function estadoDeLaBusquedaPT({ ofrecida, invitados, sinContestar, aceptaron }) {
  if (!ofrecida) return 'Ainda não foi oferecido a nenhum Asistente.';
  if (invitados === 0) return 'Está publicado, mas não se convidou nenhum Asistente em particular.';
  if (sinContestar > 0) return `Convidaram-se ${invitados} Asistente(s) e ${sinContestar} ainda não responderam.`;
  if (aceptaron > 0) return `${aceptaron} Asistente(s) aceitaram mas o plantão continua sem atribuição.`;
  return `Convidaram-se ${invitados} Asistente(s) e todos recusaram.`;
}

const CATALOGO = { 'es-AR': ES, en: EN, 'pt-BR': PT };

/** Las claves del catálogo, para que una prueba pueda recorrerlas sin que nadie las escriba dos veces. */
export const CLAVES_DE_AVISO = Object.keys(CATALOGO[IDIOMA_POR_DEFECTO]);

/** Los idiomas del catálogo, en el mismo orden en que los declara `idiomas.js`. */
export const IDIOMAS_DEL_CATALOGO = IDIOMAS_SOPORTADOS;

/**
 * Un aviso armado: `{ asunto, texto }` para los que salen por correo o WhatsApp, `{ titulo,
 * cuerpo }` para los que llegan al celular.
 *
 * Una clave que no existe rompe acá y no en el buzón de nadie: un aviso vacío que sale es peor que
 * un proceso que falla, porque el que sale nadie lo mira.
 *
 * @param {string} clave
 * @param {string|null|undefined} idioma
 * @param {object} [datos]
 */
export function aviso(clave, idioma, datos = {}) {
  const armar = CATALOGO[normalizarIdioma(idioma)][clave];
  if (!armar) throw new Error(`Aviso desconocido: ${clave}`);
  return armar(datos);
}
