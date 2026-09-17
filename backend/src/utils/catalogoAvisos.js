// Catálogo único de los avisos que emite Careonys.
//
// ESTE ES EL ÚNICO LUGAR DONDE SE AGREGA UN AVISO NUEVO. La lista de acá abajo es la fuente de
// verdad (CLAUDE.md §7 regla 12): la pantalla la muestra completa y las filas guardadas solo
// aportan lo que la Prestadora eligió. Ningún aviso depende de que alguien se acuerde de
// sembrarle una fila en `configuracion_notificaciones`: si eso hiciera falta, la fila que
// faltara dejaría al aviso fuera de la pantalla de Avisos del Panel —sin poder apagarlo ni
// redirigirlo a otro correo— aunque el aviso se siguiera mandando igual.
//
// Para agregar un aviso: se suma una entrada acá y nada más. No hace falta ninguna migración
// ni ninguna siembra — la fila se crea sola la primera vez que la Prestadora guarda ese aviso
// desde el Panel. Al revés también vale: un evento que se deja de emitir se saca de esta lista
// y desaparece de la pantalla, aunque queden filas viejas en la base (se ignoran).
//
// Qué significa cada campo:
//   evento          — la clave con la que el código emite el aviso.
//   descripcion     — para qué sirve, en español. Es la que se guarda en la fila y la que ve
//                     el Panel si todavía no hay traducción cargada para ese evento.
//   admite_whatsapp — si el aviso puede salir por WhatsApp además de por correo. Solo pueden
//                     los que pasan por `notificarCoordinador()` (utils/whatsapp.js) o por el
//                     respaldo de `revisarRecordatoriosPush.js`; los que llaman directo a
//                     `enviarEmailCoordinador()` no miran `whatsapp_activo` en ningún lado, así
//                     que dibujarles la casilla sería ofrecer algo que no ocurre. Encender la
//                     casilla no alcanza: el aviso lo empieza la Prestadora, y Meta esos mensajes
//                     los entrega solamente con una plantilla aprobada, la que la Prestadora le
//                     elija en `plantilla_whatsapp_id`. El mensaje sale al número de WhatsApp de
//                     contacto de la Prestadora, salvo que quien avisa tenga uno propio —el de la
//                     Familia, el del respaldo— (`utils/whatsapp.js`).
//   admite_familia  — si el aviso, además de al Coordinador, le puede llegar a la Familia.
//   se_puede_apagar — si la Prestadora puede decidir que este aviso no se mande. Casi todos sí.
//                     Los que no son los que la persona está esperando en ese mismo momento para
//                     poder seguir —hoy, el código de un solo uso del Círculo—: ahí la
//                     configuración elige por qué canal sale, nunca si sale. Dibujarles la casilla
//                     de encendido sería ofrecer un apagado que el código no obedece.
//
// Dónde se emite cada uno:
//   guardia_sin_cubrir             → utils/revisarGuardiasSinCubrir.js:100 (notificarCoordinador)
//   guardia_sin_cerrar             → utils/revisarNotificacionesCoordinador.js (notificarCoordinador)
//   guardia_sin_cerrar_grave       → utils/revisarNotificacionesCoordinador.js (notificarCoordinador)
//   alerta_temprana_guardia        → utils/revisarNotificacionesCoordinador.js:65 (notificarCoordinador)
//   incidente_relevo_sin_resolver  → utils/revisarNotificacionesCoordinador.js:113, 143, 213
//                                    (notificarCoordinador) + :160 aviso a la Familia
//   alerta_ia_nivel2               → utils/revisarAlertasIA.js:114 (notificarCoordinador)
//   vencimiento_documento_asistente→ utils/vencimientos.js (notificarCoordinador)
//   aviso_rutina_asistente         → utils/revisarRecordatoriosPush.js:24 (push, con respaldo WhatsApp)
//   nueva_postulacion_asistente    → routes/postulacionAsistente.js:40 (enviarEmailCoordinador)
//   nueva_solicitud_servicio       → routes/solicitudServicio.js:32 (enviarEmailCoordinador)
//   aviso_cese_asistente           → utils/avisoAutomaticoCese.js (push, con respaldo WhatsApp)
//   codigo_instruccion_circulo     → utils/instruccionesCirculo.js (WhatsApp, con caída a correo)
//   cambio_de_asistente            → utils/avisoCambioDeAsistente.js (notificarCoordinador + push
//                                    a la Familia), pedido por routes/panelGuardias.js
//   emergencia_en_guardia          → routes/appAsistentes.js (notificarCoordinador)
//   ausencia_avisada_con_tiempo    → utils/revisarAusenciasAvisadas.js (notificarCoordinador)
//   ausencia_de_golpe              → utils/revisarAusenciasAvisadas.js (notificarCoordinador)
// No hay ningún otro evento emitido. El vencimiento de documentos tiene un solo evento genérico,
// `vencimiento_documento_asistente`, y no uno por tipo de documento, porque qué documentos se le
// piden a un Asistente lo define el catálogo de cada Prestadora.

export const CATALOGO_AVISOS = [
  {
    evento: 'guardia_sin_cubrir',
    descripcion: 'Una guardia próxima sigue sin Asistente asignado',
    admite_whatsapp: true,
    admite_familia: false,
  },
  {
    evento: 'ausencia_avisada_con_tiempo',
    descripcion: 'Un Asistente avisó que falta, con margen para conseguir reemplazo',
    admite_whatsapp: true,
    // No le llega a la Familia. Todavía no le pasó nada a su Paciente: hay tiempo de sobra para
    // conseguir a alguien, y avisarle sería alarmarla por un problema que probablemente no llegue
    // a existir. Si el turno igual queda sin nadie, el aviso que sale es otro.
    admite_familia: false,
  },
  {
    evento: 'ausencia_de_golpe',
    descripcion: 'Un Asistente falta a un turno que empieza enseguida',
    admite_whatsapp: true,
    // Tiene su propio evento, y no es el de arriba con otro texto. Son dos trabajos distintos:
    // uno es una tarea para cuando se pueda, el otro es un turno que hay que tapar ahora. Con un
    // solo evento la Prestadora tendría que apagar los dos juntos, y el que no se puede apagar es
    // justamente éste.
    admite_familia: false,
  },
  {
    evento: 'guardia_sin_cerrar',
    descripcion: 'Una guardia en curso pasó su hora de cierre y nadie la cerró',
    admite_whatsapp: true,
    // No le llega a la Familia a propósito. Que nadie haya cerrado la guardia es un problema
    // de la operación de la Prestadora, no del cuidado: el Asistente puede haber estado las
    // ocho horas y haberse ido a horario. Avisarle a la Familia sería alarmarla por algo que
    // no le pasó a su Paciente.
    admite_familia: false,
  },
  {
    evento: 'guardia_sin_cerrar_grave',
    descripcion: 'Una guardia lleva horas sin cerrarse y nadie lo resolvió',
    admite_whatsapp: true,
    // Tiene su propio evento, y no es una repetición del anterior con otro texto. El de arriba
    // le llega a quien coordina el día; este le llega a quien tiene autoridad para resolver lo
    // que la coordinación no pudo. Separarlos es lo que le permite a la Prestadora poner
    // destinatarios distintos sin que el primero le llegue a la dirección cada quince minutos.
    admite_familia: false,
  },
  {
    evento: 'alerta_temprana_guardia',
    descripcion: 'Alerta temprana de posible ausencia en una guardia',
    admite_whatsapp: true,
    admite_familia: false,
  },
  {
    evento: 'incidente_relevo_sin_resolver',
    descripcion: 'Incidente de continuidad de guardia todavía sin resolver (Ausente sin relevo previo)',
    admite_whatsapp: true,
    admite_familia: true,
  },
  {
    evento: 'alerta_ia_nivel2',
    descripcion: 'Revisión con IA que encontró un patrón preocupante en los reportes de un Paciente',
    admite_whatsapp: true,
    // A quién le llega una alerta roja y a quién una amarilla no se decide con una sola casilla:
    // son dos decisiones distintas y viven juntas en la pantalla de la revisión con IA
    // (`roja_avisa_familia` / `amarilla_avisa_familia` de `configuracion_alertas_ia`, expuestas
    // por GET/PATCH /alertas-ia). Dibujar acá una tercera casilla que decidiera lo mismo dejaría
    // la misma regla escrita en dos lugares, que es justo lo que prohíbe CLAUDE.md §7 regla 12.
    admite_familia: false,
  },
  {
    evento: 'vencimiento_documento_asistente',
    descripcion: 'Documento de un Asistente vencido o por vencer, según el catálogo y el plazo de aviso configurados por la prestadora',
    admite_whatsapp: true,
    admite_familia: false,
  },
  {
    evento: 'aviso_rutina_asistente',
    descripcion: 'Avisos de rutina a la Asistente (guardia asignada, mensaje del coordinador, recordatorio de guardia próxima)',
    admite_whatsapp: true,
    admite_familia: false,
  },
  {
    evento: 'nueva_postulacion_asistente',
    descripcion: 'Nueva postulación de Asistente desde el sitio público',
    admite_whatsapp: false,
    admite_familia: false,
  },
  {
    evento: 'nueva_solicitud_servicio',
    descripcion: 'Nueva solicitud de servicio desde el sitio público',
    admite_whatsapp: false,
    admite_familia: false,
  },
  {
    evento: 'aviso_cese_asistente',
    descripcion: 'Se cerró el servicio en el que participaba un Asistente, y nadie le avisó dentro del plazo',
    admite_whatsapp: true,
    admite_familia: false,
  },
  {
    evento: 'cambio_de_asistente',
    descripcion: 'Una guardia pasó a manos de otro Asistente',
    admite_whatsapp: true,
    // A la Familia le cambia quién entra a su casa, así que este aviso le puede llegar. Que le
    // llegue o no lo decide la Prestadora en la pantalla de Avisos, como en todos los demás: acá
    // se dice que el canal existe, nunca que está encendido.
    admite_familia: true,
  },
  {
    evento: 'emergencia_en_guardia',
    descripcion: 'El Asistente avisó una emergencia desde una guardia en curso',
    admite_whatsapp: true,
    // No le llega a la Familia por esta puerta. Que haya pasado algo en la casa de su Paciente es
    // exactamente lo que una Familia quiere saber, pero quién se lo dice y con qué palabras es una
    // decisión de la Prestadora, no una consecuencia automática de que alguien apretó un botón.
    admite_familia: false,
    // No se puede apagar, por lo mismo que el código del Círculo: hay una persona esperando del
    // otro lado. La configuración elige por qué canal sale y a qué dirección, nunca si sale.
    se_puede_apagar: false,
  },
  {
    evento: 'codigo_instruccion_circulo',
    descripcion: 'El código de un solo uso con el que la Familia firma una instrucción de acceso al Círculo',
    admite_whatsapp: true,
    admite_familia: false,
    // La Familia lo está esperando en la pantalla para poder seguir. Acá se elige por qué canal
    // sale: con plantilla aprobada va por WhatsApp, y si no, por correo.
    se_puede_apagar: false,
  },
];

// Lo que vale para un aviso que todavía no tiene fila guardada. No son valores elegidos acá:
// son exactamente los que aplica hoy el código cuando no encuentra la fila. `configuracionEvento()`
// y `destinatariosEvento()` (utils/email.js) y `notificarCoordinador()` (utils/whatsapp.js) solo
// se frenan si la fila existe Y dice `activo: false`; sin fila el aviso se manda igual, al correo
// de contacto de la Prestadora. De ahí que `activo` arranque en verdadero y los demás en falso.
export const VALORES_POR_DEFECTO_AVISO = {
  emails: [],
  activo: true,
  whatsapp_activo: false,
  notificar_familia: false,
  // Sin plantilla elegida el aviso no sale por WhatsApp aunque el canal esté encendido: Meta no
  // entrega como texto suelto un mensaje que empieza la Prestadora (utils/whatsapp.js).
  plantilla_whatsapp_id: null,
};

export function avisoDelCatalogo(evento) {
  return CATALOGO_AVISOS.find((aviso) => aviso.evento === evento) ?? null;
}

// Punto único: la ausencia del campo significa que sí se puede apagar, y esa lectura no se
// escribe dos veces.
export function sePuedeApagar(aviso) {
  return aviso?.se_puede_apagar !== false;
}

// El catálogo completo con lo que cada Prestadora haya guardado encima. Función pura, sin base
// de datos, para que se pueda probar sola (utils/__tests__/catalogoAvisos.test.js).
//
// Una fila guardada de un evento que ya no está en el catálogo se ignora: la lista de acá arriba
// manda, y una fila vieja no debe reaparecer en la pantalla.
export function mezclarAvisosConCatalogo(filasGuardadas) {
  const porEvento = new Map((filasGuardadas ?? []).map((fila) => [fila.evento, fila]));

  return CATALOGO_AVISOS.map((aviso) => {
    const fila = porEvento.get(aviso.evento);
    return {
      evento: aviso.evento,
      descripcion: aviso.descripcion,
      admite_whatsapp: aviso.admite_whatsapp,
      admite_familia: aviso.admite_familia,
      se_puede_apagar: sePuedeApagar(aviso),
      // Para que la pantalla pueda distinguir "la Prestadora eligió esto" de "todavía no eligió
      // nada y esto es lo que pasa mientras tanto".
      configurado: Boolean(fila),
      emails: fila?.emails ?? [...VALORES_POR_DEFECTO_AVISO.emails],
      // Un aviso que no se puede apagar se muestra encendido aunque una fila vieja diga que no:
      // su emisor no mira esta columna, y mostrar «apagado» sería describir algo que no pasa.
      activo: sePuedeApagar(aviso) ? (fila?.activo ?? VALORES_POR_DEFECTO_AVISO.activo) : true,
      whatsapp_activo: fila?.whatsapp_activo ?? VALORES_POR_DEFECTO_AVISO.whatsapp_activo,
      notificar_familia: fila?.notificar_familia ?? VALORES_POR_DEFECTO_AVISO.notificar_familia,
      plantilla_whatsapp_id: fila?.plantilla_whatsapp_id ?? VALORES_POR_DEFECTO_AVISO.plantilla_whatsapp_id,
    };
  });
}
