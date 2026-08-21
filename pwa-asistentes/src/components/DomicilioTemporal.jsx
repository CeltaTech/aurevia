// Cuando el Paciente no está en el domicilio de su ficha.
//
// El Paciente tiene una sola dirección cargada, la de su ficha, y hay temporadas en que no
// está ahí: el verano en la casa de un hijo, una internación, una mudanza mientras arreglan el
// departamento. El motor resuelve eso solo — en `domicilio`, `lat` y `lng` manda la dirección
// del día de esa guardia, la temporal si hay una vigente y si no la de la ficha — y agrega dos
// campos para poder decirlo:
//
//   domicilio_es_temporal   sí o no
//   domicilio_motivo        lo que escribió el Panel, o vacío
//
// Sin la marca, la dirección temporal se lee igual que la de siempre y nadie tiene por qué
// dudar de ella. Con la marca, quien la lee sabe que hoy no es la casa de siempre — que es lo
// que evita que el Asistente toque el timbre equivocado.
//
// CUANDO NO HAY NADA QUE DECIR NO SE DIBUJA NADA. Si la Prestadora tiene apagado el
// interruptor `asistente_domicilio_del_paciente`, el Paciente llega sin `domicilio` y por lo
// tanto sin estos dos campos; lo mismo pasa con una ficha sin dirección cargada. En los dos
// casos acá no hay dirección, y la pantalla queda como estaba en vez de mostrar un cartel
// vacío.
//
// PUNTO ÚNICO DE VERDAD. Cómo se describe una dirección temporal se decide únicamente acá, y
// este archivo es idéntico en las dos aplicaciones (CLAUDE.md §7 regla 12). Las dos se
// despliegan por separado y no pueden importarse entre sí, así que el original vive en
// `pwa-asistentes/` y la copia se mantiene sola: `scripts/sincronizar_copias.mjs` la vuelve a
// copiar y `scripts/verificar_identidad.mjs` corta la publicación si se despegó. Nunca se
// edita la copia.
//
// Los textos salen de `t.domicilio`, que existe con las mismas claves en las dos aplicaciones.

/* La dirección tal como se va a leer, o cadena vacía si no hay ninguna. Un espacio en blanco
   no es una dirección: se lee como un renglón que se olvidaron de completar. */
function textoDelDomicilio(paciente) {
  return typeof paciente?.domicilio === 'string' ? paciente.domicilio.trim() : '';
}

/* La pregunta entera, en un solo lugar: hay dirección para mostrar Y el motor la marcó como
   temporal. El orden importa — sin dirección no hay nada que marcar. */
export function domicilioEsTemporal(paciente) {
  return Boolean(textoDelDomicilio(paciente)) && paciente?.domicilio_es_temporal === true;
}

/* El motivo escrito por el Panel, listo para mostrar. Vacío cuando no lo escribieron, y
   también cuando la dirección no es temporal: un motivo suelto sin su marca confunde. */
export function motivoDelDomicilio(paciente) {
  if (!domicilioEsTemporal(paciente)) return '';
  return typeof paciente.domicilio_motivo === 'string' ? paciente.domicilio_motivo.trim() : '';
}

/* Para una tarjeta de la lista, que no muestra direcciones y sí tiene que avisar que algo
   cambió: ¿alguna de las personas de esta guardia está en otro lado? */
export function hayDomicilioTemporal(pacientes) {
  return (pacientes ?? []).some(domicilioEsTemporal);
}

/* Las direcciones distintas de una guardia, sin repetir. Un turno que cubre a un matrimonio
   trae dos Pacientes con la misma dirección, y escribirla dos veces no informa nada.
   Devuelve objetos con los mismos tres campos que trae un Paciente, así el resultado se le
   pasa a este componente igual que un Paciente.
   Cuando dos personas comparten dirección y solo una la tiene marcada como temporal, gana la
   marca, y entre dos marcadas gana la que trae motivo escrito: callarlo sería mandar a alguien
   a la casa equivocada por redondear. */
export function domiciliosDeLaGuardia(pacientes) {
  const porDireccion = new Map();
  for (const paciente of pacientes ?? []) {
    const texto = textoDelDomicilio(paciente);
    if (!texto) continue;
    const actual = {
      domicilio: texto,
      domicilio_es_temporal: domicilioEsTemporal(paciente),
      domicilio_motivo: motivoDelDomicilio(paciente),
    };
    const anterior = porDireccion.get(texto);
    if (!anterior) porDireccion.set(texto, actual);
    else if (!actual.domicilio_es_temporal) continue;
    else if (!anterior.domicilio_es_temporal) porDireccion.set(texto, actual);
    else if (!anterior.domicilio_motivo && actual.domicilio_motivo) porDireccion.set(texto, actual);
  }
  return [...porDireccion.values()];
}

/**
 * El renglón que se pone abajo de una dirección cuando esa dirección es temporal.
 *
 * `paciente` es un Paciente, o cualquier objeto que traiga los tres campos del domicilio —lo
 * que devuelve `domiciliosDeLaGuardia` sirve tal cual. Devuelve null cuando no hay nada que
 * avisar, así que se puede poner en cualquier pantalla sin preguntar antes.
 */
export default function DomicilioTemporal({ paciente, t }) {
  if (!domicilioEsTemporal(paciente)) return null;
  const motivo = motivoDelDomicilio(paciente);
  return (
    <p className="guardia-card-detalle">
      <span className="badge badge-alerta">{t.domicilio.temporal}</span>{' '}
      {motivo || t.domicilio.sin_motivo}
    </p>
  );
}
