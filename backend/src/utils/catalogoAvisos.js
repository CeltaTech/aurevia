// Catálogo único de los avisos que emite Careonys.
//
// ESTE ES EL ÚNICO LUGAR DONDE SE AGREGA UN AVISO NUEVO. Antes, un aviso existía solamente
// si alguien se había acordado de sembrarle una fila en `configuracion_notificaciones`: si la
// fila faltaba, la pantalla de Avisos del Panel no lo mostraba y la Prestadora no lo podía
// apagar ni redirigir a otro correo — aunque el aviso se siguiera mandando igual. Así quedó
// `alerta_ia_nivel2`, que nunca se sembró en ningún esquema y por eso no se pudo configurar
// nunca (tarea 64b). La lista de acá abajo es la fuente de verdad (CLAUDE.md §7 regla 12): la
// pantalla la muestra completa y las filas guardadas solo aportan lo que la Prestadora eligió.
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
//                     que dibujarles la casilla sería ofrecer algo que no ocurre.
//   admite_familia  — si el aviso, además de al Coordinador, le puede llegar a la Familia.
//
// Verificado contra el código que los emite (2026-08-11):
//   guardia_sin_cubrir             → utils/revisarGuardiasSinCubrir.js:100 (notificarCoordinador)
//   guardia_sin_cerrar             → utils/revisarNotificacionesCoordinador.js (notificarCoordinador)
//   guardia_sin_cerrar_grave       → utils/revisarNotificacionesCoordinador.js (notificarCoordinador)
//   alerta_temprana_guardia        → utils/revisarNotificacionesCoordinador.js:65 (notificarCoordinador)
//   incidente_relevo_sin_resolver  → utils/revisarNotificacionesCoordinador.js:113, 143, 213
//                                    (notificarCoordinador) + :160 aviso a la Familia
//   alerta_ia_nivel2               → utils/revisarAlertasIA.js:114 (notificarCoordinador)
//   vencimiento_documento_asistente→ utils/vencimientos.js:64 (enviarEmailCoordinador, solo correo)
//   aviso_rutina_asistente         → utils/revisarRecordatoriosPush.js:24 (push, con respaldo WhatsApp)
//   nueva_postulacion_asistente    → routes/postulacionAsistente.js:40 (enviarEmailCoordinador)
//   nueva_solicitud_servicio       → routes/solicitudServicio.js:32 (enviarEmailCoordinador)
// No hay ningún otro evento emitido, y los tres de vencimiento viejos (`vencimiento_monotributo`,
// `vencimiento_art`, `vencimiento_seguro`) ya no se emiten: los reemplazó el genérico
// `vencimiento_documento_asistente` cuando el catálogo de documentos pasó a ser por Prestadora.

export const CATALOGO_AVISOS = [
  {
    evento: 'guardia_sin_cubrir',
    descripcion: 'Una guardia próxima sigue sin Asistente asignado',
    admite_whatsapp: true,
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
    admite_whatsapp: false,
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
};

export function avisoDelCatalogo(evento) {
  return CATALOGO_AVISOS.find((aviso) => aviso.evento === evento) ?? null;
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
      // Para que la pantalla pueda distinguir "la Prestadora eligió esto" de "todavía no eligió
      // nada y esto es lo que pasa mientras tanto".
      configurado: Boolean(fila),
      emails: fila?.emails ?? [...VALORES_POR_DEFECTO_AVISO.emails],
      activo: fila?.activo ?? VALORES_POR_DEFECTO_AVISO.activo,
      whatsapp_activo: fila?.whatsapp_activo ?? VALORES_POR_DEFECTO_AVISO.whatsapp_activo,
      notificar_familia: fila?.notificar_familia ?? VALORES_POR_DEFECTO_AVISO.notificar_familia,
    };
  });
}
