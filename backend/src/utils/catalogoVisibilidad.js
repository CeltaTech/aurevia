// Catálogo único de lo que cada Prestadora puede prender o apagar en las dos aplicaciones de
// teléfono: la de las Familias y la de los Asistentes.
//
// ESTE ES EL ÚNICO LUGAR DONDE SE AGREGA UNA PERILLA NUEVA. La tabla
// `configuracion_visibilidad_app` guarda solamente lo que cada Prestadora decidió cambiar; la
// lista de qué se puede cambiar vive acá, porque describe lo que el producto sabe hacer —la
// escribe CeltaTech y cambia con cada versión—, no una decisión de una Prestadora. Es la misma
// forma que ya usa `catalogoAvisos.js`, y por el mismo motivo (CLAUDE.md §7 regla 12).
//
// Para agregar un interruptor: se suma una entrada acá y nada más. No hace falta migración ni
// siembra — la fila se crea sola la primera vez que la Prestadora la toca desde el Panel. Al
// revés también vale: un interruptor que se retira se saca de esta lista y desaparece de la
// pantalla, aunque queden filas viejas en la base (se ignoran).
//
// LA UNIDAD ES EL BLOQUE, NO EL CAMPO SUELTO. Se apaga "los signos vitales", no "la presión"
// aparte de "la temperatura". Cien casillas no las usa nadie: la pantalla se vuelve un
// formulario imposible y la Prestadora termina sin tocar ninguna. La excepción son los pocos
// datos que por sí solos son delicados —las patologías, el domicilio completo—, que llevan su
// propio interruptor porque la decisión sobre ellos es distinta de la del bloque donde aparecen.
//
// LA CLAVE NO SE RENOMBRA NUNCA (CLAUDE.md §7 regla 13). Nombra lo que la cosa hace, no cómo se
// llama hoy la pantalla donde aparece: queda escrita adentro de filas que ya existen, y
// cambiarla es perder la decisión que la Prestadora ya había tomado.
//
// EL VALOR DE FÁBRICA ES LO QUE PASA HOY. Todas arrancan encendidas porque hoy todas las
// aplicaciones muestran todo: así, la Prestadora que no entra nunca a esta pantalla no ve
// cambiar nada. Ninguna arranca apagada por una razón legal — eso lo prohíbe expresamente
// CLAUDE.md §3: el sistema advierte, no decide por la Prestadora.
//
// QUÉ NO ESTÁ ACÁ, A PROPÓSITO:
//   - Los avisos al teléfono. A quién le llega cada aviso ya se decide en Configuración ›
//     Avisos (`catalogoAvisos.js`). Poner acá otra casilla que decidiera lo mismo dejaría la
//     misma regla escrita en dos lugares (CLAUDE.md §7 regla 12).
//   - El consentimiento del Asistente para el seguimiento de ubicación. Eso no es una
//     preferencia de la Prestadora sino una decisión de la persona, y tiene su propio circuito
//     (`/consentimientos` en la aplicación del Asistente). Apagar acá la ubicación en vivo la
//     apaga para toda la Prestadora; el consentimiento sigue rigiendo por persona, encima.

export const APLICACIONES = ['familias', 'asistentes'];

export const CATALOGO_VISIBILIDAD = [
  // ---------------------------------------------------------------- Familias
  {
    clave: 'familia_ubicacion_en_vivo',
    app: 'familias',
    descripcion: 'Ver en un mapa dónde está el Asistente mientras dura la guardia',
    ayuda: 'Es la función con más riesgo legal del producto: seguir la ubicación de un trabajador. Apagada, la Familia sigue viendo que llegó y que se fue, pero no el recorrido.',
    de_fabrica: true,
  },
  {
    clave: 'familia_signos_vitales',
    app: 'familias',
    descripcion: 'Ver presión, temperatura, saturación y glucemia en los reportes',
    ayuda: 'Una Prestadora que no hace enfermería no toma estos valores, y mostrar el casillero vacío hace creer que alguien los está controlando.',
    de_fabrica: true,
  },
  {
    clave: 'familia_patologias_del_paciente',
    app: 'familias',
    descripcion: 'Ver las patologías del Paciente en su ficha',
    ayuda: 'Dato clínico. Hay Prestadoras que prefieren que esa conversación la tenga el Coordinador por teléfono y no una pantalla.',
    de_fabrica: true,
  },
  {
    clave: 'familia_alertas_de_la_revision',
    app: 'familias',
    descripcion: 'Ver las alertas que deja la revisión automática de los reportes',
    ayuda: 'Apagada, las alertas se siguen generando y le llegan al Coordinador igual: lo que cambia es que la Familia no las lee sola, sin nadie que se las explique.',
    de_fabrica: true,
  },
  {
    clave: 'familia_califica_al_asistente',
    app: 'familias',
    descripcion: 'Poner estrellas y un comentario al Asistente, y ver las calificaciones anteriores',
    ayuda: 'Puntuar a un trabajador tiene riesgo legal conocido en varias jurisdicciones. Apagada, no se puede calificar ni se muestran las calificaciones que ya existan.',
    de_fabrica: true,
  },
  {
    clave: 'familia_verifica_con_codigo',
    app: 'familias',
    descripcion: 'Escanear el código del Asistente para confirmar que es quien tenía que venir',
    ayuda: 'Sirve donde la Familia no conoce de antes a quien se presenta. Donde va siempre la misma persona, sobra.',
    de_fabrica: true,
  },
  {
    clave: 'familia_pide_medicacion',
    app: 'familias',
    descripcion: 'Cargar una indicación de medicación para que el Panel la acepte o la rechace',
    ayuda: 'Apagada, la Familia no carga nada y las indicaciones las cargan solamente la Coordinadora o quien corresponda.',
    de_fabrica: true,
  },
  {
    clave: 'familia_medicacion_del_paciente',
    app: 'familias',
    descripcion: 'Ver la medicación vigente del Paciente',
    ayuda: 'Es la lista de qué toma y cuándo. Se puede mostrar aunque la Familia no pueda cargar ninguna.',
    de_fabrica: true,
  },
  {
    clave: 'familia_pagos_y_suscripcion',
    app: 'familias',
    descripcion: 'Ver la cuota, los cobros y el código para pagar en efectivo',
    ayuda: 'La Prestadora que factura por fuera del sistema no tiene por qué mostrarle precios a la Familia acá.',
    de_fabrica: true,
  },

  // -------------------------------------------------------------- Asistentes
  {
    clave: 'asistente_signos_vitales',
    app: 'asistentes',
    descripcion: 'Cargar presión, temperatura, saturación y glucemia en el Reporte Diario',
    ayuda: 'Tomar estos valores es un acto clínico: la Prestadora que no hace enfermería no quiere que su gente los cargue, porque cargarlos es hacerse cargo.',
    de_fabrica: true,
  },
  {
    clave: 'asistente_patologias_del_paciente',
    app: 'asistentes',
    descripcion: 'Ver las patologías del Paciente en la ficha de la guardia',
    ayuda: 'Dato clínico. Hay Prestadoras que solo lo entregan a los tipos de Asistente con matrícula, y prefieren que no viaje al teléfono de nadie.',
    de_fabrica: true,
  },
  {
    clave: 'asistente_domicilio_del_paciente',
    app: 'asistentes',
    descripcion: 'Ver la dirección completa del domicilio',
    ayuda: 'Apagada, el Asistente sigue viendo la zona y el horario, pero la dirección exacta se la da la Coordinadora al confirmar. Se usa donde la relación con el Cliente es de la Prestadora y no del Asistente.',
    de_fabrica: true,
  },
  {
    clave: 'asistente_medicacion_del_paciente',
    app: 'asistentes',
    descripcion: 'Ver las indicaciones de medicación vigentes del Paciente',
    ayuda: 'Qué toma, cuánto y a qué hora. Va junto con lo que la Prestadora habilita a administrar según el tipo de Asistente.',
    de_fabrica: true,
  },
  {
    clave: 'asistente_reportes_anteriores',
    app: 'asistentes',
    descripcion: 'Leer los reportes anteriores de ese Paciente',
    ayuda: 'Ayuda a quien entra a cubrir por primera vez. También significa entregarle el historial de salud de una persona a alguien que la atiende un solo día.',
    de_fabrica: true,
  },
  {
    clave: 'asistente_relato_con_ia',
    app: 'asistentes',
    descripcion: 'Contar la guardia hablando y que la revisión automática ordene el reporte',
    ayuda: 'Manda el relato a un tercero para que lo ordene. Apagada, el Reporte Diario se completa a mano en los mismos campos, que es la opción que ya existe al lado del botón.',
    de_fabrica: true,
  },
  {
    clave: 'asistente_foto_en_el_reporte',
    app: 'asistentes',
    descripcion: 'Adjuntar una foto al Reporte Diario',
    ayuda: 'Sirve para dejar constancia de una lesión o de una comida. También es una cámara adentro de la casa de otra persona, y no toda Prestadora la quiere.',
    de_fabrica: true,
  },
  {
    clave: 'asistente_ubicacion_en_vivo',
    app: 'asistentes',
    descripcion: 'Compartir su ubicación durante la guardia',
    ayuda: 'Es la otra cara del interruptor del mapa de la Familia: acá se decide si el teléfono la manda. Apagado, no se manda ninguna ubicación aunque la Familia tenga el mapa encendido. El check-in y el check-out no dependen de esto.',
    de_fabrica: true,
  },
  {
    clave: 'asistente_carga_su_matricula',
    app: 'asistentes',
    descripcion: 'Cargar su matrícula y el archivo desde el teléfono',
    ayuda: 'Apagada, la matrícula la carga la Prestadora desde el Panel después de verla en original. Lo que el Asistente carga queda igual pendiente de verificación.',
    de_fabrica: true,
  },
];

// Lo que rige mientras la Prestadora no haya tocado nada. Es exactamente lo que hacen hoy las
// dos aplicaciones, para que quien no entre a esta pantalla no note ningún cambio.
export function visibilidadDeFabrica() {
  return Object.fromEntries(CATALOGO_VISIBILIDAD.map((cosa) => [cosa.clave, cosa.de_fabrica]));
}

export function cosaDelCatalogo(clave) {
  return CATALOGO_VISIBILIDAD.find((cosa) => cosa.clave === clave) ?? null;
}

// Lo que las dos aplicaciones consultan en cada pedido: un objeto plano clave → prendido.
// Función pura, sin base de datos, para poder probarla sola
// (utils/__tests__/catalogoVisibilidad.test.js).
//
// Una fila guardada de una clave que ya no está en el catálogo se ignora: la lista de arriba
// manda, y un interruptor retirado no debe reaparecer.
export function visibilidadEfectiva(filasGuardadas) {
  const efectiva = visibilidadDeFabrica();
  for (const fila of filasGuardadas ?? []) {
    if (Object.hasOwn(efectiva, fila.clave)) {
      efectiva[fila.clave] = Boolean(fila.visible);
    }
  }
  return efectiva;
}

// Arma la lista de columnas de una consulta dejando afuera las que están apagadas.
//
// ACÁ ESTÁ EL SENTIDO DE TODA LA TAREA: lo que no se puede ver, no se manda. Si el filtro
// estuviera en el maquetado, el dato viajaría igual hasta el teléfono y cualquiera que sepa
// mirar el tráfico lo leería. Apagar una cosa tiene que sacarla de la consulta.
//
// `columnas` es una lista de textos; los que llevan condición se escriben como
// `['patologias', 'familia_patologias_del_paciente']` y solo entran si ese interruptor está
// prendida. Una clave que no esté en la lista se toma como prendida: mientras conviven una
// versión vieja del motor con una nueva del catálogo, es preferible seguir mostrando lo que
// ya se mostraba antes que dejar la pantalla en blanco.
export function columnasSegunVisibilidad(columnas, visibilidad) {
  return columnas
    .filter((columna) => (Array.isArray(columna) ? visibilidad[columna[1]] !== false : true))
    .map((columna) => (Array.isArray(columna) ? columna[0] : columna))
    .join(', ');
}

// El catálogo completo con lo que la Prestadora haya guardado encima. Es lo que dibuja la
// pantalla del Panel: muestra siempre las dieciocho, tenga o no fila guardada cada una.
export function mezclarVisibilidadConCatalogo(filasGuardadas) {
  const porClave = new Map((filasGuardadas ?? []).map((fila) => [fila.clave, fila]));

  return CATALOGO_VISIBILIDAD.map((cosa) => {
    const fila = porClave.get(cosa.clave);
    return {
      clave: cosa.clave,
      app: cosa.app,
      descripcion: cosa.descripcion,
      ayuda: cosa.ayuda,
      de_fabrica: cosa.de_fabrica,
      // Para que la pantalla pueda distinguir "la Prestadora eligió esto" de "todavía no
      // eligió nada y esto es lo que pasa mientras tanto".
      configurado: Boolean(fila),
      visible: fila ? Boolean(fila.visible) : cosa.de_fabrica,
    };
  });
}
