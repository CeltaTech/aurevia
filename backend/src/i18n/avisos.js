import {
  FUENTE_AVISO_TELEFONICO,
  FUENTE_AVISO_DEMORA_ASISTENTE,
  FUENTE_CALCULO_LLEGADA_TARDIA,
  FUENTE_SIN_AVISO_NI_SALIDA,
} from '../utils/fuentesAlertaTemprana.js';
import { IDIOMA_POR_DEFECTO, IDIOMAS_SOPORTADOS, normalizarIdioma } from './idiomas.js';
import { IDENTIDAD } from '../config/identidadProducto.js';

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

/* Escapa lo que venga de la base —un nombre, el nombre de fantasía de una Prestadora— antes de
   meterlo adentro del HTML. Un apellido con «&» o con «<» rompería el correo, y un texto cargado
   por alguien no puede convertirse en etiquetas. */
function comoTextoHTML(valor) {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* Un correo con un enlace para hacer clic, en vez de una dirección larga suelta en el texto.
   El enlace se ve con el estilo que cada programa de correo le da a un enlace: no se inventan
   acá colores ni tipografías (`celtatech\CLAUDE.md` §8, «Diseño sólo con el sistema propio»), y
   además cada programa de correo recorta el estilo a su manera.

   Quien lea el correo en un programa que no muestra formato recibe igual la versión en texto, que
   sí lleva la dirección escrita entera. */
function correoConBoton({ saludo, cuerpo, boton, link, pieDeAviso, marca }) {
  const partes = [
    `<p>${comoTextoHTML(saludo)}</p>`,
    `<p>${comoTextoHTML(cuerpo)}</p>`,
    `<p><a href="${comoTextoHTML(link)}">${comoTextoHTML(boton)}</a></p>`,
    `<p>${comoTextoHTML(pieDeAviso)}</p>`,
  ];
  if (marca) partes.push(`<hr><p>${comoTextoHTML(marca)}</p>`);
  return partes.join('\n');
}

// LA LÍNEA AL PIE. Todo correo dirigido a una Familia o a un Asistente lleva adelante la marca de
// la Prestadora y el nombre del producto en una sola línea al pie
// (`docs\REGLAS_PRODUCTOS_CAREONYS.md` §4). El nombre sale de `IDENTIDAD` y no de un parámetro:
// así ningún emisor puede olvidarse de pasarlo y quedarse sin el pie. Los dos correos con formato
// —activación y clave nueva— lo siguen recibiendo por parámetro, porque el pie va adentro del
// armado del HTML.
const PIE = {
  es: `\n\n—\nCon la tecnología de ${IDENTIDAD.nombre}`,
  en: `\n\n—\nPowered by ${IDENTIDAD.nombre}`,
  pt: `\n\n—\nCom a tecnologia de ${IDENTIDAD.nombre}`,
};

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
    ].join('\n'),
  }),

  // Lo mismo que arriba, contado para la Familia. Dice cuál es la guardia y qué pasó, y nada de
  // adentro: ni el escalón de la alarma, ni los minutos de la cuenta interna, ni ningún
  // identificador, ni el nombre de quien estaba asignado. Las claves terminan en `_familia` por lo
  // mismo que `incidente_relevo_familia`: son dos textos distintos sobre el mismo hecho, y tenerlos
  // separados es lo que impide que a la Familia le llegue el de adentro.
  guardia_sin_cerrar_familia: (d) => ({
    titulo: 'Guardia sin cerrar',
    cuerpo: `La guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${unirNombres(d.pacientes, 'y', 'Paciente sin nombre cargado')} pasó su hora de cierre y todavía figura abierta. Ante cualquier duda, puede comunicarse con el Coordinador.`,
  }),

  guardia_sin_cerrar_grave_familia: (d) => ({
    titulo: 'Guardia sin cerrar',
    cuerpo: `La guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${unirNombres(d.pacientes, 'y', 'Paciente sin nombre cargado')} sigue figurando abierta varias horas después de su hora de cierre. Ante cualquier duda, puede comunicarse con el Coordinador.`,
  }),

  alerta_temprana_guardia_familia: (d) => ({
    titulo: 'Guardia con un aviso pendiente',
    cuerpo: `La guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${unirNombres(d.pacientes, 'y', 'Paciente sin nombre cargado')} tiene un aviso pendiente de resolver. Ante cualquier duda, puede comunicarse con el Coordinador.`,
  }),

  guardia_sin_cerrar_respaldo: (d) => ({
    texto: `La guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, sigue sin cerrarse ${Math.round(d.minutosDeAtraso)} minutos después del plazo.`,
  }),

  escalada_a_respaldo: () => ({ asunto: 'Sin resolver: pasa al Coordinador de respaldo' }),

  // Los dos escalones que siguen. El asunto dice los minutos porque el cuerpo es el mismo que ya
  // recibió quien coordina: sin eso, quien lo lee no sabe por qué le está llegando a él.
  escalada_a_todos_los_coordinadores: (d) => ({
    asunto: `Sin resolver hace ${d.minutos} minutos: pasa a todos los Coordinadores`,
  }),

  escalada_a_la_administracion: (d) => ({
    asunto: `Sin resolver hace ${d.minutos} minutos: pasa a la administración`,
  }),

  alerta_temprana_sin_resolver: (d) => ({
    asunto: 'Alerta temprana de posible ausencia sin resolver',
    // El origen va adelante del motivo a propósito: quien lee tiene que poder distinguir de un
    // vistazo un aviso que dio una persona de una cuenta que sacó el sistema.
    texto: [
      `Guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${unirNombres(d.pacientes, 'y', 'Paciente sin nombre cargado')}.`,
      `Origen: ${d.origen}. Motivo: ${d.motivo ?? '—'}. Sin resolver hace ${Math.round(d.minutos)} minutos.`,
    ].join('\n'),
  }),

  alerta_temprana_respaldo: (d) => ({
    texto: [
      `Guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${unirNombres(d.pacientes, 'y', 'Paciente sin nombre cargado')}.`,
      `La alerta temprana sigue sin resolver hace ${Math.round(d.minutos)} minutos.`,
    ].join('\n'),
  }),

  aviso_demora_asistente: (d) => ({
    asunto: 'Aviso de demora del Asistente',
    texto: `Guardia del ${d.fecha} a las ${d.horaInicio}. Origen: ${d.origen}. Motivo: ${d.motivo}.`,
  }),

  // Lo que escribió el Asistente no entra acá. Este mensaje sale por WhatsApp o por correo, y lo
  // escribió alguien que está mirando a un Paciente (`celtatech/CLAUDE.md` §6). El texto se lee
  // entrando al Panel, que es donde el permiso se comprueba.
  emergencia_en_guardia: (d) => ({
    asunto: 'Emergencia avisada desde una guardia',
    texto: `Guardia del ${d.fecha} a las ${d.horaInicio}. El Asistente avisó una emergencia. El detalle está en el Panel.`,
  }),

  // Lo mismo: lo que escribió no entra acá. Y el texto no pide nada ni sugiere qué hacer — quien
  // decide es quien coordina.
  no_puede_continuar_la_extension: (d) => ({
    asunto: 'El Asistente que espera el relevo no puede continuar',
    texto: `Guardia del ${d.fecha} de ${d.horaInicio} a ${d.horaFin}. Terminó y el relevo no llegó. El Asistente sigue en el domicilio y avisó que no puede continuar. El detalle está en el Panel.`,
  }),

  // El nivel de escalada no va en el texto: es una cuenta interna. Y este texto es sólo para quien
  // coordina: a la Familia le llega el suyo, `incidente_relevo_familia`.
  incidente_relevo_sin_resolver: (d) => ({
    asunto: 'La guardia terminó y el relevo todavía no llegó',
    texto: [
      `Guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${unirNombres(d.pacientes, 'y', 'Paciente sin nombre cargado')}.`,
      `El relevo sigue sin llegar hace ${Math.round(d.minutos)} minutos.`,
    ].join('\n'),
  }),

  incidente_relevo_respaldo: (d) => ({
    texto: [
      `Guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${unirNombres(d.pacientes, 'y', 'Paciente sin nombre cargado')}.`,
      `El relevo sigue sin llegar hace ${Math.round(d.minutos)} minutos.`,
    ].join('\n'),
  }),

  incidente_relevo_fase_automatica: (d) => ({
    asunto: 'Se salió a buscar quién cubra la guardia',
    texto: [
      `Guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${unirNombres(d.pacientes, 'y', 'Paciente sin nombre cargado')}. Sin resolver hace más de ${d.minutosUmbral} minutos.`,
      d.sinNivel || d.sinOrden
        ? 'No hay ningún orden de prioridad cargado, así que no se contactó a nadie.'
        : d.contactados > 0
          ? `Se le escribió a ${d.contactados} ${d.contactados === 1 ? 'Asistente' : 'Asistentes'}, en el orden de prioridad cargado.`
          : 'No había nadie disponible en el orden de prioridad cargado.',
      d.quedaElFamiliar ? 'Queda por avisarle al familiar, y esa decisión es suya.' : null,
      'La guardia sigue sin nadie asignado.',
    ].filter(Boolean).join('\n'),
  }),

  convocatoria_de_relevo: (d) => ({
    titulo: `Se busca quién cubra una guardia: ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}`,
  }),

  // A la Familia se le dice lo que le toca saber y nada más: cuál es la guardia y que el relevo
  // todavía no llegó. Nada de adentro del funcionamiento, y con quién hablar si quiere preguntar.
  incidente_relevo_familia: (d) => ({
    titulo: 'Continuidad de guardia',
    cuerpo: `La guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, terminó y el relevo todavía no llegó. Ante cualquier duda, puede comunicarse con el Coordinador.`,
  }),

  cambio_de_asistente: (d) => ({
    asunto: d.turnos.length === 1 ? 'Cambió el Asistente de una guardia' : 'Cambió el Asistente de varias guardias',
    texto: [
      d.asistenteAnterior
        ? `${d.asistenteAnterior} ya no hace ${d.turnos.length === 1 ? 'esta guardia' : 'estas guardias'}. Ahora ${d.turnos.length === 1 ? 'la hace' : 'las hace'} ${d.asistenteNuevo ?? 'un Asistente sin nombre cargado'}.`
        : `${d.turnos.length === 1 ? 'Esta guardia pasa' : 'Estas guardias pasan'} a ${d.asistenteNuevo ?? 'un Asistente sin nombre cargado'}.`,
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

  ausencia_avisada_con_tiempo: (d) => ({
    asunto: 'Un Asistente avisó que falta',
    texto: [
      `${d.asistente ?? 'Un Asistente'} no va a estar desde el ${d.fechaInicio}${d.fechaFin ? ` hasta el ${d.fechaFin}` : ''}.`,
      `Deja ${d.turnos} ${d.turnos === 1 ? 'guardia' : 'guardias'} sin nadie. La primera es la del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, y empieza en ${d.horas} h.`,
      d.veces > 1 ? `Es el aviso número ${d.veces} de esta misma ausencia.` : null,
    ].filter(Boolean).join('\n'),
  }),

  ausencia_de_golpe: (d) => ({
    asunto: d.yaEmpezo ? 'Falta un Asistente: la guardia ya tendría que haber empezado' : 'Falta un Asistente y la guardia empieza enseguida',
    texto: [
      `${d.asistente ?? 'Un Asistente'} no va a estar desde el ${d.fechaInicio}${d.fechaFin ? ` hasta el ${d.fechaFin}` : ''}.`,
      `Guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${unirNombres(d.pacientes, 'y', 'Paciente sin nombre cargado')}.`,
      d.yaEmpezo ? `Tendría que haber empezado hace ${d.horas} h.` : `Empieza en ${d.horas} h.`,
      d.turnos > 1 ? `Además deja ${d.turnos - 1 === 1 ? 'otra guardia' : `otras ${d.turnos - 1} guardias`} sin nadie.` : null,
      d.veces > 1 ? `Es el aviso número ${d.veces} de esta misma ausencia.` : null,
    ].filter(Boolean).join('\n'),
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


  incidente_turno_sin_cubrir: (d) => ({
    asunto: d.yaEmpezo
      ? 'Guardia sin nadie: ya empezó y sigue abierta'
      : 'Guardia sin nadie: queda poco para que empiece',
    texto: [
      `Guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${unirNombres(d.pacientes, 'y', 'Paciente sin nombre cargado')}.`,
      d.yaEmpezo ? `Tendría que haber empezado hace ${d.horas} h.` : `Empieza en ${d.horas} h.`,
      d.cubrenFrancos?.length
        ? `Cubre francos de este Paciente: ${unirNombres(d.cubrenFrancos, 'y', '')}.`
        : null,
      d.candidatos?.length
        ? `Equipo del Paciente: ${unirNombres(d.candidatos, 'y', '')}.`
        : 'Este Paciente todavía no tiene equipo armado.',
      d.veces > 1 ? `Es el recordatorio número ${d.veces} de esta misma guardia.` : null,
    ].filter(Boolean).join('\n'),
  }),

  alerta_ia_coordinador: (d) => ({
    asunto: d.esRoja ? 'Alerta roja sobre un Paciente' : 'Alerta amarilla sobre un Paciente',
    texto: 'El detalle está en el Panel.',
  }),

  alerta_ia_familia: (d) => ({
    titulo: d.esRoja ? 'Alerta sobre el Paciente' : 'Novedad sobre el Paciente',
    cuerpo: d.esRoja
      ? 'Hay una novedad importante para revisar en la aplicación.'
      : 'Hay algo para mirar sin apuro en la aplicación.',
  }),

  vencimiento_documentos: (d) => ({
    asunto: `Vencimientos próximos de ${d.etiqueta} — ${d.documentos.length} ${d.documentos.length === 1 ? 'Asistente' : 'Asistentes'}`,
    texto: `Estos Asistentes tienen ${d.etiqueta} vencido o por vencer dentro de ${d.dias} días:\n\n${d.documentos.map((x) => `${x.nombre}: vence ${x.fechaVencimiento}`).join('\n')}`,
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
    asunto: `Active su cuenta en ${d.empresa}`,
    texto: `Hola ${d.nombre},\n\nSu cuenta en ${d.empresa} ya está creada. Falta un paso: elegir su contraseña.\n\nSe activa acá:\n${d.link}\n\nEl enlace vence en ${d.dias} días. Si no esperaba este correo, puede ignorarlo.\n\n—\nCon la tecnología de ${d.producto}`,
    html: correoConBoton({
      saludo: `Hola ${d.nombre},`,
      cuerpo: `Su cuenta en ${d.empresa} ya está creada. Falta un paso: elegir su contraseña.`,
      boton: 'Activar mi cuenta',
      link: d.link,
      pieDeAviso: `El enlace vence en ${d.dias} días. Si no esperaba este correo, puede ignorarlo.`,
      marca: `Con la tecnología de ${d.producto}`,
    }),
  }),

  recuperacion_clave: (d) => ({
    asunto: `Recupere su clave en ${d.empresa}`,
    texto: `Hola ${d.nombre},\n\nSe pidió una clave nueva para su cuenta en ${d.empresa}.\n\nSe elige acá:\n${d.link}\n\nEl enlace vence en ${d.horas} horas y sirve una sola vez. Si no lo pidió, puede ignorar este correo: su clave sigue siendo la de siempre.\n\n—\nCon la tecnología de ${d.producto}`,
    html: correoConBoton({
      saludo: `Hola ${d.nombre},`,
      cuerpo: `Se pidió una clave nueva para su cuenta en ${d.empresa}.`,
      boton: 'Elegir una clave nueva',
      link: d.link,
      pieDeAviso: `El enlace vence en ${d.horas} horas y sirve una sola vez. Si no lo pidió, puede ignorar este correo: su clave sigue siendo la de siempre.`,
      marca: `Con la tecnología de ${d.producto}`,
    }),
  }),

  /* No nombra ningún tipo de Asistente: los tipos salen de un catálogo que carga cada Prestadora,
     y escribir uno acá lo dejaría fijo en el código para todas. */
  estado_postulacion: (d) => ({
    asunto: `${d.empresa} — Su postulación`,
    texto: [
      `Hola ${d.nombre || ''},`,
      '',
      {
        en_revision: 'Su postulación está en revisión.',
        aprobado: 'Su postulación fue aprobada. Nos vamos a poner en contacto con usted.',
        rechazado: `Gracias por su interés en ${d.empresa}. En esta oportunidad no vamos a avanzar con su postulación.`,
      }[d.estado],
      '',
      `Equipo de ${d.empresa}`,
    ].join('\n') + PIE.es,
  }),

  // Los datos de quien se postula no salen en el cuerpo del correo, igual que en
  // `emergencia_en_guardia`: se leen entrando al Panel, que es donde el permiso se comprueba.
  nueva_postulacion_asistente: (d) => ({
    asunto: `Nueva postulación de Asistente — ${d.nombre}`,
    texto: `Se recibió una postulación de ${d.nombre}. Los datos están en el Panel.`,
  }),

  nueva_solicitud_servicio: (d) => ({
    asunto: `Nueva solicitud de servicio — ${d.nombre}`,
    texto: `Nombre: ${d.nombre}\nTeléfono: ${d.telefono}\nCorreo: ${d.email}\nLocalidad: ${d.localidad}\nServicio: ${d.tipoServicio} (${d.modalidad})\nDías y horario: ${d.diasHorario}\nDescripción: ${d.descripcion ?? '—'}`,
  }),

  mensaje_del_coordinador: () => ({ titulo: 'Nuevo mensaje del Coordinador' }),

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
    cuerpo: `A partir del ${d.dia} se cobra ${d.importe}. Si prefiere no continuar, puede darse de baja antes desde la aplicación.`,
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
    cuerpo: 'Se cerró el Servicio en el que participaba. Para más información, puede comunicarse con el Coordinador.',
  }),

  /* Los tres avisos de la entrevista salen por correo, porque quien se postuló todavía no tiene
     ninguna aplicación instalada: lo único que dejó es su correo.

     EL ENLACE NO ES LA SALA. Lleva a una pantalla del producto, que comprueba que sea la hora
     antes de dejar entrar. Por eso el mismo enlace sigue sirviendo si la entrevista se
     reprograma, y por eso el aviso dice desde cuándo se puede entrar. */
  entrevista_agendada: (d) => ({
    titulo: `Entrevista con ${d.prestadora}`,
    cuerpo: `Su entrevista quedó agendada para el ${d.cuando}.\n\nEl día de la entrevista, entre por acá:\n${d.enlace}\n\nLa puerta se abre ${d.anticipo} minutos antes de la hora. No hace falta instalar nada ni crear ninguna cuenta.${PIE.es}`,
  }),

  entrevista_reprogramada: (d) => ({
    titulo: `Se cambió el día de su entrevista con ${d.prestadora}`,
    cuerpo: `Su entrevista pasó al ${d.cuando}.\n\nEntre por el mismo enlace de siempre:\n${d.enlace}\n\nLa puerta se abre ${d.anticipo} minutos antes de la hora.${PIE.es}`,
  }),

  // No dice por qué se canceló. El motivo es de la Prestadora, y un aviso automático que lo
  // adelante contesta mal una pregunta que todavía no se hizo.
  entrevista_cancelada: (d) => ({
    titulo: `Se canceló su entrevista con ${d.prestadora}`,
    cuerpo: `La entrevista del ${d.cuando} quedó sin efecto. Su postulación sigue en pie.${PIE.es}`,
  }),

  // Los cuatro avisos de la seguridad de la cuenta. Salen siempre, sin que nadie los configure:
  // quien recibe uno que no reconoce es la única persona que puede darse cuenta de que alguien más
  // está entrando. Por eso cada uno dice qué hacer, y lo que hay que hacer es siempre lo mismo.
  //
  // NINGUNO LLEVA EL NÚMERO NI EL CÓDIGO. Son datos sensibles y no viajan por correo. El aviso dice
  // que el número cambió, no a cuál.
  clave_recuperada: (d) => ({
    asunto: `Se cambió la clave de su cuenta en ${d.prestadora}`,
    texto: `${d.nombre}: la clave de su cuenta acaba de cambiarse.\n\nSi no fue usted, avise a ${d.prestadora} ahora mismo.${PIE.es}`,
  }),

  telefono_cambiado: (d) => ({
    asunto: `Se cambió el teléfono de su cuenta en ${d.prestadora}`,
    texto: `${d.nombre}: el teléfono de su cuenta acaba de cambiarse y todavía está sin verificar.\n\nSi no fue usted, avise a ${d.prestadora} ahora mismo.${PIE.es}`,
  }),

  entrada_desde_equipo_nuevo: (d) => ({
    asunto: `Entraron a su cuenta de ${d.prestadora} desde un equipo nuevo`,
    texto: `${d.nombre}: se entró a su cuenta desde un equipo desde el que nunca se había entrado.\n\nSi no fue usted, cambie su clave y cierre la sesión en todos los equipos desde su propia pantalla.${PIE.es}`,
  }),

  cambio_de_clave_habilitado: (d) => ({
    asunto: `${d.prestadora} habilitó un cambio de clave en su cuenta`,
    texto: `${d.nombre}: ${d.prestadora} habilitó por un rato que usted elija una clave nueva. La clave la elige usted: nadie de ${d.prestadora} la ve ni la conoce.\n\nSi usted no llamó para pedirlo, avise ahora mismo.${PIE.es}`,
  }),
};

// El aviso tiene que servir para actuar, no solo para enterarse. Por eso dice en qué punto está la
// búsqueda: si todavía no se ofreció a nadie, si se ofreció y nadie contestó, o si contestaron
// todos que no. Son tres situaciones con tres acciones distintas.
function estadoDeLaBusquedaES({ ofrecida, invitados, sinContestar, aceptaron }) {
  const asistentes = (n) => `${n} ${n === 1 ? 'Asistente' : 'Asistentes'}`;
  if (!ofrecida) return 'Todavía no se le ofreció a ningún Asistente.';
  if (invitados === 0) return 'Está publicada, pero no se invitó a ningún Asistente en particular.';
  if (sinContestar > 0) return `Se invitó a ${asistentes(invitados)} y ${sinContestar} todavía no ${sinContestar === 1 ? 'contestó' : 'contestaron'}.`;
  if (aceptaron > 0) return `${asistentes(aceptaron)} ${aceptaron === 1 ? 'aceptó' : 'aceptaron'}, pero la guardia sigue sin asignar.`;
  return `Se invitó a ${asistentes(invitados)} y ${invitados === 1 ? 'rechazó' : 'todos rechazaron'}.`;
}

const EN = {
  origen_de_alerta: ({ fuente }) => ({
    texto: {
      [FUENTE_AVISO_TELEFONICO]: 'phone call logged by the care provider',
      [FUENTE_AVISO_DEMORA_ASISTENTE]: 'delay reported by the care worker from the application',
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
    ].join('\n'),
  }),

  guardia_sin_cerrar_familia: (d) => ({
    titulo: 'Shift not closed',
    cuerpo: `The shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${unirNombres(d.pacientes, 'and', 'patient with no name on file')} is past its closing time and is still open. If you have any questions, you can contact the coordinator.`,
  }),

  guardia_sin_cerrar_grave_familia: (d) => ({
    titulo: 'Shift not closed',
    cuerpo: `The shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${unirNombres(d.pacientes, 'and', 'patient with no name on file')} is still open several hours after its closing time. If you have any questions, you can contact the coordinator.`,
  }),

  alerta_temprana_guardia_familia: (d) => ({
    titulo: 'Shift with an open alert',
    cuerpo: `The shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${unirNombres(d.pacientes, 'and', 'patient with no name on file')} has an alert that is still open. If you have any questions, you can contact the coordinator.`,
  }),

  guardia_sin_cerrar_respaldo: (d) => ({
    texto: `The shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, is still open ${Math.round(d.minutosDeAtraso)} minutes past the deadline.`,
  }),

  escalada_a_respaldo: () => ({ asunto: 'Still unresolved: passed to the backup coordinator' }),

  escalada_a_todos_los_coordinadores: (d) => ({
    asunto: `Unresolved for ${d.minutos} minutes: passed to every coordinator`,
  }),

  escalada_a_la_administracion: (d) => ({
    asunto: `Unresolved for ${d.minutos} minutes: passed to management`,
  }),

  alerta_temprana_sin_resolver: (d) => ({
    asunto: 'Early warning of a possible no-show, unresolved',
    texto: [
      `Shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${unirNombres(d.pacientes, 'and', 'patient with no name on file')}.`,
      `Source: ${d.origen}. Reason: ${d.motivo ?? '—'}. Unresolved for ${Math.round(d.minutos)} minutes.`,
    ].join('\n'),
  }),

  alerta_temprana_respaldo: (d) => ({
    texto: [
      `Shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${unirNombres(d.pacientes, 'and', 'patient with no name on file')}.`,
      `The early warning has been unresolved for ${Math.round(d.minutos)} minutes.`,
    ].join('\n'),
  }),

  aviso_demora_asistente: (d) => ({
    asunto: 'Care worker reported a delay',
    texto: `Shift on ${d.fecha} at ${d.horaInicio}. Source: ${d.origen}. Reason: ${d.motivo}.`,
  }),

  emergencia_en_guardia: (d) => ({
    asunto: 'Emergency reported from a shift',
    texto: `Shift on ${d.fecha} at ${d.horaInicio}. The care worker reported an emergency. The details are in the Panel.`,
  }),

  no_puede_continuar_la_extension: (d) => ({
    asunto: 'The care worker waiting for the handover cannot continue',
    texto: `Shift on ${d.fecha} from ${d.horaInicio} to ${d.horaFin}. It ended and no one arrived. The care worker is still at the home and reported being unable to continue. The details are in the Panel.`,
  }),

  incidente_relevo_sin_resolver: (d) => ({
    asunto: 'The shift ended and the relief has not arrived',
    texto: [
      `Shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${unirNombres(d.pacientes, 'and', 'patient with no name on file')}.`,
      `The relief has still not arrived after ${Math.round(d.minutos)} minutes.`,
    ].join('\n'),
  }),

  incidente_relevo_respaldo: (d) => ({
    texto: [
      `Shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${unirNombres(d.pacientes, 'and', 'patient with no name on file')}.`,
      `The relief has still not arrived after ${Math.round(d.minutos)} minutes.`,
    ].join('\n'),
  }),

  incidente_relevo_fase_automatica: (d) => ({
    asunto: 'The search for someone to cover the shift has started',
    texto: [
      `Shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${unirNombres(d.pacientes, 'and', 'patient with no name on file')}. Unresolved for more than ${d.minutosUmbral} minutes.`,
      d.sinNivel || d.sinOrden
        ? 'There is no priority order on file, so nobody was contacted.'
        : d.contactados > 0
          ? `${d.contactados} ${d.contactados === 1 ? 'care worker was' : 'care workers were'} contacted, in the priority order on file.`
          : 'Nobody in the priority order on file was available to contact.',
      d.quedaElFamiliar ? 'The family member is still to be told, and that decision is yours.' : null,
      'The shift still has nobody assigned.',
    ].filter(Boolean).join('\n'),
  }),

  convocatoria_de_relevo: (d) => ({
    titulo: `Cover needed for a shift: ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}`,
  }),

  incidente_relevo_familia: (d) => ({
    titulo: 'Shift continuity',
    cuerpo: `The shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, has ended and the relief has not arrived yet. If you have any questions, you can contact the coordinator.`,
  }),

  cambio_de_asistente: (d) => ({
    asunto: d.turnos.length === 1 ? 'The care worker on a shift changed' : 'The care worker on several shifts changed',
    texto: [
      d.asistenteAnterior
        ? `${d.asistenteAnterior} no longer covers ${d.turnos.length === 1 ? 'this shift' : 'these shifts'}. ${d.asistenteNuevo ?? 'A care worker with no name on file'} covers ${d.turnos.length === 1 ? 'it' : 'them'} now.`
        : `${d.turnos.length === 1 ? 'This shift goes' : 'These shifts go'} to ${d.asistenteNuevo ?? 'a care worker with no name on file'}.`,
      ...d.turnos.map((turno) =>
        `${turno.fecha}, from ${turno.horaInicio} to ${turno.horaFin}, for ${unirNombres(turno.pacientes, 'and', 'patient with no name on file')}.`),
    ].join('\n'),
  }),

  cambio_de_asistente_familia: (d) => ({
    titulo: 'Change of care worker',
    cuerpo: d.turnos.length === 1
      ? `The shift on ${d.turnos[0].fecha}, from ${d.turnos[0].horaInicio} to ${d.turnos[0].horaFin}, will be covered by ${d.asistenteNuevo ?? 'another care worker'}.`
      : `${d.turnos.length} shifts, starting with the one on ${d.turnos[0].fecha}, will be covered by ${d.asistenteNuevo ?? 'another care worker'}.`,
  }),

  ausencia_avisada_con_tiempo: (d) => ({
    asunto: 'A care worker reported an absence',
    texto: [
      `${d.asistente ?? 'A care worker'} will be away from ${d.fechaInicio}${d.fechaFin ? ` to ${d.fechaFin}` : ''}.`,
      `This leaves ${d.turnos} ${d.turnos === 1 ? 'shift' : 'shifts'} with nobody. The first one is on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, and it starts in ${d.horas} h.`,
      d.veces > 1 ? `This is notice number ${d.veces} for this same absence.` : null,
    ].filter(Boolean).join('\n'),
  }),

  ausencia_de_golpe: (d) => ({
    asunto: d.yaEmpezo ? 'A care worker is missing: the shift should have started already' : 'A care worker is missing and the shift starts shortly',
    texto: [
      `${d.asistente ?? 'A care worker'} will be away from ${d.fechaInicio}${d.fechaFin ? ` to ${d.fechaFin}` : ''}.`,
      `Shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${unirNombres(d.pacientes, 'and', 'patient with no name on file')}.`,
      d.yaEmpezo ? `It should have started ${d.horas} h ago.` : `It starts in ${d.horas} h.`,
      d.turnos > 1 ? `It also leaves ${d.turnos - 1} more ${d.turnos - 1 === 1 ? 'shift' : 'shifts'} with nobody.` : null,
      d.veces > 1 ? `This is notice number ${d.veces} for this same absence.` : null,
    ].filter(Boolean).join('\n'),
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


  incidente_turno_sin_cubrir: (d) => ({
    asunto: d.yaEmpezo
      ? 'Shift with nobody: it already started and is still open'
      : 'Shift with nobody: little time left before it starts',
    texto: [
      `Shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${unirNombres(d.pacientes, 'and', 'patient with no name on file')}.`,
      d.yaEmpezo ? `It should have started ${d.horas} h ago.` : `It starts in ${d.horas} h.`,
      d.cubrenFrancos?.length
        ? `Covers this patient's days off: ${unirNombres(d.cubrenFrancos, 'and', '')}.`
        : null,
      d.candidatos?.length
        ? `Patient's team: ${unirNombres(d.candidatos, 'and', '')}.`
        : 'This patient has no team set up yet.',
      d.veces > 1 ? `This is reminder number ${d.veces} for this same shift.` : null,
    ].filter(Boolean).join('\n'),
  }),

  alerta_ia_coordinador: (d) => ({
    asunto: d.esRoja ? 'Red alert about a patient' : 'Yellow alert about a patient',
    texto: 'The details are in the Panel.',
  }),

  alerta_ia_familia: (d) => ({
    titulo: d.esRoja ? 'Alert about the patient' : 'Update about the patient',
    cuerpo: d.esRoja
      ? 'There is something important to review in the application.'
      : 'There is something to look at in the application, no rush.',
  }),

  vencimiento_documentos: (d) => ({
    asunto: `${d.etiqueta} expiring soon — ${d.documentos.length} ${d.documentos.length === 1 ? 'care worker' : 'care workers'}`,
    texto: `These care workers have their ${d.etiqueta} expired or expiring within ${d.dias} days:\n\n${d.documentos.map((x) => `${x.nombre}: expires ${x.fechaVencimiento}`).join('\n')}`,
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
    texto: `Hi ${d.nombre},\n\nYour ${d.empresa} account has been created. One step left: choose your password.\n\nActivate it here:\n${d.link}\n\nThe link expires in ${d.dias} days. If you were not expecting this email, you can ignore it.\n\n—\nPowered by ${d.producto}`,
    html: correoConBoton({
      saludo: `Hi ${d.nombre},`,
      cuerpo: `Your ${d.empresa} account has been created. One step left: choose your password.`,
      boton: 'Activate my account',
      link: d.link,
      pieDeAviso: `The link expires in ${d.dias} days. If you were not expecting this email, you can ignore it.`,
      marca: `Powered by ${d.producto}`,
    }),
  }),

  recuperacion_clave: (d) => ({
    asunto: `Recover your ${d.empresa} password`,
    texto: `Hi ${d.nombre},\n\nA new password was requested for your ${d.empresa} account.\n\nChoose it here:\n${d.link}\n\nThe link expires in ${d.horas} hours and works only once. If you did not request it, you can ignore this email: your password stays as it was.\n\n—\nPowered by ${d.producto}`,
    html: correoConBoton({
      saludo: `Hi ${d.nombre},`,
      cuerpo: `A new password was requested for your ${d.empresa} account.`,
      boton: 'Choose a new password',
      link: d.link,
      pieDeAviso: `The link expires in ${d.horas} hours and works only once. If you did not request it, you can ignore this email: your password stays as it was.`,
      marca: `Powered by ${d.producto}`,
    }),
  }),

  estado_postulacion: (d) => ({
    asunto: `${d.empresa} — Your application`,
    texto: [
      `Hi ${d.nombre || ''},`,
      '',
      {
        en_revision: 'Your application is under review.',
        aprobado: 'Your application was approved. We will be in touch with you.',
        rechazado: `Thank you for your interest in ${d.empresa}. We will not be moving forward with your application at this time.`,
      }[d.estado],
      '',
      `The ${d.empresa} team`,
    ].join('\n') + PIE.en,
  }),

  nueva_postulacion_asistente: (d) => ({
    asunto: `New care worker application — ${d.nombre}`,
    texto: `An application from ${d.nombre} was received. The details are in the Panel.`,
  }),

  nueva_solicitud_servicio: (d) => ({
    asunto: `New service request — ${d.nombre}`,
    texto: `Name: ${d.nombre}\nPhone: ${d.telefono}\nEmail address: ${d.email}\nTown: ${d.localidad}\nService: ${d.tipoServicio} (${d.modalidad})\nDays and hours: ${d.diasHorario}\nDescription: ${d.descripcion ?? '—'}`,
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
    cuerpo: `From ${d.dia} the charge is ${d.importe}. If you would rather not continue, you can cancel before then from the application.`,
  }),

  cobro_no_realizado: (d) => ({
    titulo: 'The payment could not be taken',
    cuerpo: `${d.importe} could not be charged. Access keeps working until ${d.dia}; if the payment has not come through by then, it is suspended.`,
  }),

  cese_de_servicio: () => ({
    titulo: 'Service ended',
    cuerpo: 'The service you were taking part in has been closed. For more information, please get in touch with the coordinator.',
  }),

  entrevista_agendada: (d) => ({
    titulo: `Interview with ${d.prestadora}`,
    cuerpo: `Your interview is scheduled for ${d.cuando}.\n\nOn the day, join here:\n${d.enlace}\n\nThe door opens ${d.anticipo} minutes before the start time. Nothing to install, no account to create.${PIE.en}`,
  }),

  entrevista_reprogramada: (d) => ({
    titulo: `Your interview with ${d.prestadora} has moved`,
    cuerpo: `Your interview is now set for ${d.cuando}.\n\nJoin through the same link as before:\n${d.enlace}\n\nThe door opens ${d.anticipo} minutes before the start time.${PIE.en}`,
  }),

  entrevista_cancelada: (d) => ({
    titulo: `Your interview with ${d.prestadora} was cancelled`,
    cuerpo: `The interview set for ${d.cuando} has been called off. Your application still stands.${PIE.en}`,
  }),

  clave_recuperada: (d) => ({
    asunto: `Your ${d.prestadora} account password was changed`,
    texto: `${d.nombre}: the password on your account has just been changed.\n\nIf this was not you, tell ${d.prestadora} right away.${PIE.en}`,
  }),

  telefono_cambiado: (d) => ({
    asunto: `The phone number on your ${d.prestadora} account was changed`,
    texto: `${d.nombre}: the phone number on your account has just been changed and is not verified yet.\n\nIf this was not you, tell ${d.prestadora} right away.${PIE.en}`,
  }),

  entrada_desde_equipo_nuevo: (d) => ({
    asunto: `Your ${d.prestadora} account was opened from a new device`,
    texto: `${d.nombre}: your account was opened from a device that had never been used before.\n\nIf this was not you, change your password and sign out on every device from your own screen.${PIE.en}`,
  }),

  cambio_de_clave_habilitado: (d) => ({
    asunto: `${d.prestadora} opened a password change on your account`,
    texto: `${d.nombre}: ${d.prestadora} has opened a short window for you to choose a new password. You choose it: nobody at ${d.prestadora} sees it or knows it.\n\nIf you did not call to ask for this, say so right away.${PIE.en}`,
  }),
};

function estadoDeLaBusquedaEN({ ofrecida, invitados, sinContestar, aceptaron }) {
  const cuidadores = (n) => `${n} ${n === 1 ? 'care worker' : 'care workers'}`;
  if (!ofrecida) return 'It has not been offered to any care worker yet.';
  if (invitados === 0) return 'It is published, but no particular care worker was invited.';
  if (sinContestar > 0) return `${cuidadores(invitados)} were invited and ${sinContestar} ${sinContestar === 1 ? 'has' : 'have'} not replied yet.`;
  if (aceptaron > 0) return `${cuidadores(aceptaron)} accepted, but the shift is still unassigned.`;
  return `${cuidadores(invitados)} were invited and ${invitados === 1 ? 'declined' : 'all of them declined'}.`;
}

const PT = {
  origen_de_alerta: ({ fuente }) => ({
    texto: {
      [FUENTE_AVISO_TELEFONICO]: 'aviso por telefone registrado pela Prestadora',
      [FUENTE_AVISO_DEMORA_ASISTENTE]: 'aviso de atraso dado pelo Assistente pelo aplicativo',
      [FUENTE_CALCULO_LLEGADA_TARDIA]: 'cálculo do sistema: o horário previsto de chegada passa do horário de início',
      [FUENTE_SIN_AVISO_NI_SALIDA]: 'chegou o horário de início sem registro de saída, sem aviso de atraso e sem chegada registrada',
    }[fuente] ?? 'origem sem registro',
  }),

  guardia_sin_cerrar: (d) => ({
    asunto: 'Plantão terminado e ainda sem fechar',
    texto: [
      `Plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')}.`,
      `A cargo de ${d.asistente || 'Assistente sem atribuição'}. Terminava há ${enMinutosUHoras(d.minutosDeAtraso, 'minutos', 'horas')} e continua aberto.`,
      d.salidaMarcada
        ? 'O Assistente já registrou a saída: falta confirmar que ficou tudo feito.'
        : 'O Assistente ainda não registrou a saída.',
      d.veces > 1 ? `É o aviso número ${d.veces} deste mesmo plantão.` : null,
    ].filter(Boolean).join('\n'),
  }),

  guardia_sin_cerrar_grave: (d) => ({
    asunto: 'Urgente: um plantão está há horas sem fechar',
    texto: [
      `Plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')}.`,
      `A cargo de ${d.asistente || 'Assistente sem atribuição'}. Terminava há ${enMinutosUHoras(d.minutosDeAtraso, 'minutos', 'horas')} e continua aberto.`,
      'O Coordenador já foi avisado e o plantão continua sem fechar. É preciso que alguém com autoridade intervenha.',
      d.salidaMarcada
        ? 'O Assistente registrou a saída, então saiu do domicílio: falta confirmar que ficou tudo feito.'
        : 'O Assistente não registrou a saída, então não há registro de que o plantão tenha terminado nem de quem ficou a cargo do Paciente.',
    ].join('\n'),
  }),

  guardia_sin_cerrar_familia: (d) => ({
    titulo: 'Plantão sem encerrar',
    cuerpo: `O plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')} passou da hora de encerramento e ainda consta aberto. Em caso de dúvida, pode entrar em contato com o Coordenador.`,
  }),

  guardia_sin_cerrar_grave_familia: (d) => ({
    titulo: 'Plantão sem encerrar',
    cuerpo: `O plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')} continua aberto várias horas depois da hora de encerramento. Em caso de dúvida, pode entrar em contato com o Coordenador.`,
  }),

  alerta_temprana_guardia_familia: (d) => ({
    titulo: 'Plantão com um aviso pendente',
    cuerpo: `O plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')} tem um aviso pendente de resolver. Em caso de dúvida, pode entrar em contato com o Coordenador.`,
  }),

  guardia_sin_cerrar_respaldo: (d) => ({
    texto: `O plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, continua sem fechar ${Math.round(d.minutosDeAtraso)} minutos depois do prazo.`,
  }),

  escalada_a_respaldo: () => ({ asunto: 'Sem resolver: passa ao Coordenador de retaguarda' }),

  escalada_a_todos_los_coordinadores: (d) => ({
    asunto: `Sem resolver há ${d.minutos} minutos: passa a todos os Coordenadores`,
  }),

  escalada_a_la_administracion: (d) => ({
    asunto: `Sem resolver há ${d.minutos} minutos: passa à administração`,
  }),

  alerta_temprana_sin_resolver: (d) => ({
    asunto: 'Alerta antecipado de possível ausência sem resolver',
    texto: [
      `Plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')}.`,
      `Origem: ${d.origen}. Motivo: ${d.motivo ?? '—'}. Sem resolver há ${Math.round(d.minutos)} minutos.`,
    ].join('\n'),
  }),

  alerta_temprana_respaldo: (d) => ({
    texto: [
      `Plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')}.`,
      `O alerta antecipado continua sem resolver há ${Math.round(d.minutos)} minutos.`,
    ].join('\n'),
  }),

  aviso_demora_asistente: (d) => ({
    asunto: 'Aviso de atraso do Assistente',
    texto: `Plantão de ${d.fecha} às ${d.horaInicio}. Origem: ${d.origen}. Motivo: ${d.motivo}.`,
  }),

  emergencia_en_guardia: (d) => ({
    asunto: 'Emergência avisada a partir de um plantão',
    texto: `Plantão de ${d.fecha} às ${d.horaInicio}. O Assistente avisou uma emergência. O detalhe está no Painel.`,
  }),

  no_puede_continuar_la_extension: (d) => ({
    asunto: 'O Assistente que espera a rendição não pode continuar',
    texto: `Plantão de ${d.fecha} das ${d.horaInicio} às ${d.horaFin}. Terminou e a rendição não chegou. O Assistente continua no domicílio e avisou que não pode continuar. O detalhe está no Painel.`,
  }),

  incidente_relevo_sin_resolver: (d) => ({
    asunto: 'O plantão terminou e a rendição ainda não chegou',
    texto: [
      `Plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')}.`,
      `A rendição continua sem chegar há ${Math.round(d.minutos)} minutos.`,
    ].join('\n'),
  }),

  incidente_relevo_respaldo: (d) => ({
    texto: [
      `Plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')}.`,
      `A rendição continua sem chegar há ${Math.round(d.minutos)} minutos.`,
    ].join('\n'),
  }),

  incidente_relevo_fase_automatica: (d) => ({
    asunto: 'Saiu-se à procura de quem cubra o plantão',
    texto: [
      `Plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')}. Sem resolver há mais de ${d.minutosUmbral} minutos.`,
      d.sinNivel || d.sinOrden
        ? 'Não há nenhuma ordem de prioridade cadastrada, portanto ninguém foi contatado.'
        : d.contactados > 0
          ? `${d.contactados} ${d.contactados === 1 ? 'Assistente foi contatado' : 'Assistentes foram contatados'}, na ordem de prioridade cadastrada.`
          : 'Não havia ninguém disponível na ordem de prioridade cadastrada.',
      d.quedaElFamiliar ? 'Falta avisar o familiar, e essa decisão é sua.' : null,
      'O plantão continua sem ninguém atribuído.',
    ].filter(Boolean).join('\n'),
  }),

  convocatoria_de_relevo: (d) => ({
    titulo: `Procura-se quem cubra um plantão: ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}`,
  }),

  incidente_relevo_familia: (d) => ({
    titulo: 'Continuidade de plantão',
    cuerpo: `O plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, terminou e a rendição ainda não chegou. Em caso de dúvida, pode entrar em contato com o Coordenador.`,
  }),

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

  ausencia_avisada_con_tiempo: (d) => ({
    asunto: 'Um Assistente avisou que vai faltar',
    texto: [
      `${d.asistente ?? 'Um Assistente'} não vai estar de ${d.fechaInicio}${d.fechaFin ? ` até ${d.fechaFin}` : ''}.`,
      `Deixa ${d.turnos} ${d.turnos === 1 ? 'plantão' : 'plantões'} sem ninguém. O primeiro é o de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, e começa em ${d.horas} h.`,
      d.veces > 1 ? `É o aviso número ${d.veces} desta mesma ausência.` : null,
    ].filter(Boolean).join('\n'),
  }),

  ausencia_de_golpe: (d) => ({
    asunto: d.yaEmpezo ? 'Falta um Assistente: o plantão já deveria ter começado' : 'Falta um Assistente e o plantão começa em seguida',
    texto: [
      `${d.asistente ?? 'Um Assistente'} não vai estar de ${d.fechaInicio}${d.fechaFin ? ` até ${d.fechaFin}` : ''}.`,
      `Plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')}.`,
      d.yaEmpezo ? `Deveria ter começado há ${d.horas} h.` : `Começa em ${d.horas} h.`,
      d.turnos > 1 ? `Além disso, deixa ${d.turnos - 1 === 1 ? 'outro plantão' : `outros ${d.turnos - 1} plantões`} sem ninguém.` : null,
      d.veces > 1 ? `É o aviso número ${d.veces} desta mesma ausência.` : null,
    ].filter(Boolean).join('\n'),
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


  incidente_turno_sin_cubrir: (d) => ({
    asunto: d.yaEmpezo
      ? 'Plantão sem ninguém: já começou e continua aberto'
      : 'Plantão sem ninguém: falta pouco para começar',
    texto: [
      `Plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${unirNombres(d.pacientes, 'e', 'Paciente sem nome cadastrado')}.`,
      d.yaEmpezo ? `Deveria ter começado há ${d.horas} h.` : `Começa em ${d.horas} h.`,
      d.cubrenFrancos?.length
        ? `Cobre as folgas deste Paciente: ${unirNombres(d.cubrenFrancos, 'e', '')}.`
        : null,
      d.candidatos?.length
        ? `Equipe do Paciente: ${unirNombres(d.candidatos, 'e', '')}.`
        : 'Este Paciente ainda não tem equipe montada.',
      d.veces > 1 ? `É o lembrete número ${d.veces} deste mesmo plantão.` : null,
    ].filter(Boolean).join('\n'),
  }),

  alerta_ia_coordinador: (d) => ({
    asunto: d.esRoja ? 'Alerta vermelho sobre um Paciente' : 'Alerta amarelo sobre um Paciente',
    texto: 'O detalhe está no Painel.',
  }),

  alerta_ia_familia: (d) => ({
    titulo: d.esRoja ? 'Alerta sobre o Paciente' : 'Novidade sobre o Paciente',
    cuerpo: d.esRoja
      ? 'Há uma novidade importante para revisar no aplicativo.'
      : 'Há algo para olhar sem pressa no aplicativo.',
  }),

  vencimiento_documentos: (d) => ({
    asunto: `Vencimentos próximos de ${d.etiqueta} — ${d.documentos.length} ${d.documentos.length === 1 ? 'Assistente' : 'Assistentes'}`,
    texto: `Estes Assistentes têm ${d.etiqueta} vencido ou a vencer dentro de ${d.dias} dias:\n\n${d.documentos.map((x) => `${x.nombre}: vence ${x.fechaVencimiento}`).join('\n')}`,
  }),

  mfa_codigo_recuperacion: (d) => ({
    asunto: `Código de recuperação de acesso — ${d.producto}`,
    texto: `O código de recuperação é ${d.codigo}. Vence em ${d.minutos} minutos. Se não tiver sido solicitado, pode ignorar este e-mail.`,
  }),

  codigo_instruccion_circulo: (d) => ({
    asunto: `Código para confirmar os acessos do seu círculo familiar — ${d.remite}`,
    texto: `O seu código para confirmar a instrução sobre os acessos do seu círculo familiar é ${d.codigo}. Vence em ${d.minutos} minutos. Se não tiver sido solicitado, não o use e avise ${d.remite}.`,
  }),

  activacion_cuenta: (d) => ({
    asunto: `Ative a sua conta na ${d.empresa}`,
    texto: `Olá ${d.nombre},\n\nA sua conta na ${d.empresa} já está criada. Falta um passo: escolher a sua senha.\n\nA ativação é feita aqui:\n${d.link}\n\nO link expira em ${d.dias} dias. Se este e-mail não era esperado, pode ser ignorado.\n\n—\nCom a tecnologia de ${d.producto}`,
    html: correoConBoton({
      saludo: `Olá ${d.nombre},`,
      cuerpo: `A sua conta na ${d.empresa} já está criada. Falta um passo: escolher a sua senha.`,
      boton: 'Ativar a minha conta',
      link: d.link,
      pieDeAviso: `O link expira em ${d.dias} dias. Se este e-mail não era esperado, pode ser ignorado.`,
      marca: `Com a tecnologia de ${d.producto}`,
    }),
  }),

  recuperacion_clave: (d) => ({
    asunto: `Recupere a sua senha na ${d.empresa}`,
    texto: `Olá ${d.nombre},\n\nFoi pedida uma senha nova para a sua conta na ${d.empresa}.\n\nA escolha é feita aqui:\n${d.link}\n\nO link expira em ${d.horas} horas e serve uma só vez. Se não tiver sido solicitada, pode ignorar este e-mail: a sua senha continua a mesma.\n\n—\nCom a tecnologia de ${d.producto}`,
    html: correoConBoton({
      saludo: `Olá ${d.nombre},`,
      cuerpo: `Foi pedida uma senha nova para a sua conta na ${d.empresa}.`,
      boton: 'Escolher uma senha nova',
      link: d.link,
      pieDeAviso: `O link expira em ${d.horas} horas e serve uma só vez. Se não tiver sido solicitada, pode ignorar este e-mail: a sua senha continua a mesma.`,
      marca: `Com a tecnologia de ${d.producto}`,
    }),
  }),

  estado_postulacion: (d) => ({
    asunto: `${d.empresa} — A sua candidatura`,
    texto: [
      `Olá ${d.nombre || ''},`,
      '',
      {
        en_revision: 'A sua candidatura está em análise.',
        aprobado: 'A sua candidatura foi aprovada. Entraremos em contato.',
        rechazado: `Obrigado pelo interesse na ${d.empresa}. Desta vez não vamos avançar com a candidatura.`,
      }[d.estado],
      '',
      `Equipe ${d.empresa}`,
    ].join('\n') + PIE.pt,
  }),

  nueva_postulacion_asistente: (d) => ({
    asunto: `Nova candidatura de Assistente — ${d.nombre}`,
    texto: `Foi recebida uma candidatura de ${d.nombre}. Os dados estão no Painel.`,
  }),

  nueva_solicitud_servicio: (d) => ({
    asunto: `Nova solicitação de serviço — ${d.nombre}`,
    texto: `Nome: ${d.nombre}\nTelefone: ${d.telefono}\nE-mail: ${d.email}\nLocalidade: ${d.localidad}\nServiço: ${d.tipoServicio} (${d.modalidad})\nDias e horário: ${d.diasHorario}\nDescrição: ${d.descripcion ?? '—'}`,
  }),

  mensaje_del_coordinador: () => ({ titulo: 'Nova mensagem do Coordenador' }),

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
    cuerpo: `A partir de ${d.dia} passa a ser cobrado ${d.importe}. Se preferir não continuar, pode cancelar antes pelo aplicativo.`,
  }),

  cobro_no_realizado: (d) => ({
    titulo: 'A cobrança não pôde ser feita',
    cuerpo: `Não foi possível cobrar ${d.importe}. O acesso continua funcionando até ${d.dia}; se até lá a cobrança não entrar, fica suspenso.`,
  }),

  cese_de_servicio: () => ({
    titulo: 'Fim do serviço',
    cuerpo: 'O Serviço do qual participava foi encerrado. Para mais informações, pode entrar em contato com o Coordenador.',
  }),

  entrevista_agendada: (d) => ({
    titulo: `Entrevista com ${d.prestadora}`,
    cuerpo: `A sua entrevista ficou marcada para ${d.cuando}.\n\nNo dia da entrevista, entre por aqui:\n${d.enlace}\n\nA porta abre ${d.anticipo} minutos antes do horário. Não é preciso instalar nada nem criar nenhuma conta.${PIE.pt}`,
  }),

  entrevista_reprogramada: (d) => ({
    titulo: `Mudou o dia da sua entrevista com ${d.prestadora}`,
    cuerpo: `A sua entrevista passou para ${d.cuando}.\n\nEntre pelo mesmo link de sempre:\n${d.enlace}\n\nA porta abre ${d.anticipo} minutos antes do horário.${PIE.pt}`,
  }),

  entrevista_cancelada: (d) => ({
    titulo: `Sua entrevista com ${d.prestadora} foi cancelada`,
    cuerpo: `A entrevista de ${d.cuando} ficou sem efeito. A sua candidatura continua de pé.${PIE.pt}`,
  }),

  clave_recuperada: (d) => ({
    asunto: `A senha da sua conta na ${d.prestadora} foi alterada`,
    texto: `${d.nombre}: a senha da sua conta acaba de ser alterada.\n\nSe não foi você, avise a ${d.prestadora} agora mesmo.${PIE.pt}`,
  }),

  telefono_cambiado: (d) => ({
    asunto: `O telefone da sua conta na ${d.prestadora} foi alterado`,
    texto: `${d.nombre}: o telefone da sua conta acaba de ser alterado e ainda está sem verificar.\n\nSe não foi você, avise a ${d.prestadora} agora mesmo.${PIE.pt}`,
  }),

  entrada_desde_equipo_nuevo: (d) => ({
    asunto: `Entraram na sua conta da ${d.prestadora} a partir de um equipamento novo`,
    texto: `${d.nombre}: entraram na sua conta a partir de um equipamento do qual nunca se tinha entrado.\n\nSe não foi você, troque a sua senha e feche a sessão em todos os equipamentos pela sua própria tela.${PIE.pt}`,
  }),

  cambio_de_clave_habilitado: (d) => ({
    asunto: `A ${d.prestadora} liberou uma troca de senha na sua conta`,
    texto: `${d.nombre}: a ${d.prestadora} liberou por um tempo curto que você escolha uma senha nova. A senha é escolhida por você: ninguém da ${d.prestadora} a vê nem a conhece.\n\nSe você não ligou para pedir isso, avise agora mesmo.${PIE.pt}`,
  }),
};

function estadoDeLaBusquedaPT({ ofrecida, invitados, sinContestar, aceptaron }) {
  const assistentes = (n) => `${n} ${n === 1 ? 'Assistente' : 'Assistentes'}`;
  if (!ofrecida) return 'Ainda não foi oferecido a nenhum Assistente.';
  if (invitados === 0) return 'Está publicado, mas não se convidou nenhum Assistente em particular.';
  if (sinContestar > 0) return `Foram convidados ${assistentes(invitados)} e ${sinContestar} ainda não ${sinContestar === 1 ? 'respondeu' : 'responderam'}.`;
  if (aceptaron > 0) return `${assistentes(aceptaron)} ${aceptaron === 1 ? 'aceitou' : 'aceitaram'}, mas o plantão continua sem atribuição.`;
  return `Foram convidados ${assistentes(invitados)} e ${invitados === 1 ? 'recusou' : 'todos recusaram'}.`;
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
