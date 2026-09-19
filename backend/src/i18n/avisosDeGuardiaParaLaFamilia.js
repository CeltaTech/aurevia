// LOS AVISOS QUE LE LLEGAN A LA FAMILIA CUANDO UNA JORNADA QUEDA ABIERTA O UNA SALIDA NO TIENE
// ENTRADA. Son el aviso de la Familia, no el de quien coordina: dicen cuál es la guardia y qué
// pasó, y nada de adentro —ni el escalón de la alarma, ni los minutos de la cuenta interna, ni
// ningún identificador, ni el nombre de quien estaba asignado—.
//
// POR QUÉ ESTÁN ACÁ Y NO EN `i18n/avisos.js`, que es donde viven todos los demás: ese archivo lo
// está reescribiendo otro trabajo en este mismo momento y no se toca. Este módulo tiene la misma
// forma —una función por evento y por idioma, que recibe los datos de la guardia y devuelve título
// y cuerpo—, así que el día que aquel archivo quede libre estas tres entradas se mudan tal cual y
// este archivo se borra. Queda dicho en el informe del paso.
//
// Las tres claves terminan en `_familia` por lo mismo que `incidente_relevo_familia`: el aviso de
// la Familia y el de quien coordina son dos textos distintos sobre el mismo hecho, y tenerlos
// separados es lo que impide que a la Familia le llegue el de adentro.

const SIN_NOMBRE = {
  'es-AR': 'Paciente sin nombre cargado',
  en: 'patient with no name on file',
  'pt-BR': 'Paciente sem nome cadastrado',
};

function nombres(guardia, idioma) {
  const lista = (guardia?.pacientes ?? []).filter(Boolean);
  if (lista.length === 0) return SIN_NOMBRE[idioma] ?? SIN_NOMBRE['es-AR'];
  return lista.join(', ');
}

export const AVISOS_DE_GUARDIA_PARA_LA_FAMILIA = {
  'es-AR': {
    guardia_sin_cerrar_familia: (d) => ({
      titulo: 'Guardia sin cerrar',
      cuerpo: `La guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${nombres(d, 'es-AR')} pasó su hora de cierre y todavía figura abierta. Ante cualquier duda, puede comunicarse con el Coordinador.`,
    }),
    guardia_sin_cerrar_grave_familia: (d) => ({
      titulo: 'Guardia sin cerrar',
      cuerpo: `La guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${nombres(d, 'es-AR')} sigue figurando abierta varias horas después de su hora de cierre. Ante cualquier duda, puede comunicarse con el Coordinador.`,
    }),
    alerta_temprana_guardia_familia: (d) => ({
      titulo: 'Guardia con un aviso pendiente',
      cuerpo: `La guardia del ${d.fecha}, de ${d.horaInicio} a ${d.horaFin}, para ${nombres(d, 'es-AR')} tiene un aviso pendiente de resolver. Ante cualquier duda, puede comunicarse con el Coordinador.`,
    }),
  },
  en: {
    guardia_sin_cerrar_familia: (d) => ({
      titulo: 'Shift not closed',
      cuerpo: `The shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${nombres(d, 'en')} is past its closing time and is still open. If you have any questions, you can contact the coordinator.`,
    }),
    guardia_sin_cerrar_grave_familia: (d) => ({
      titulo: 'Shift not closed',
      cuerpo: `The shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${nombres(d, 'en')} is still open several hours after its closing time. If you have any questions, you can contact the coordinator.`,
    }),
    alerta_temprana_guardia_familia: (d) => ({
      titulo: 'Shift with an open alert',
      cuerpo: `The shift on ${d.fecha}, from ${d.horaInicio} to ${d.horaFin}, for ${nombres(d, 'en')} has an alert that is still open. If you have any questions, you can contact the coordinator.`,
    }),
  },
  'pt-BR': {
    guardia_sin_cerrar_familia: (d) => ({
      titulo: 'Plantão sem encerrar',
      cuerpo: `O plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${nombres(d, 'pt-BR')} passou da hora de encerramento e ainda consta aberto. Em caso de dúvida, pode entrar em contato com o Coordenador.`,
    }),
    guardia_sin_cerrar_grave_familia: (d) => ({
      titulo: 'Plantão sem encerrar',
      cuerpo: `O plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${nombres(d, 'pt-BR')} continua aberto várias horas depois da hora de encerramento. Em caso de dúvida, pode entrar em contato com o Coordenador.`,
    }),
    alerta_temprana_guardia_familia: (d) => ({
      titulo: 'Plantão com um aviso pendente',
      cuerpo: `O plantão de ${d.fecha}, das ${d.horaInicio} às ${d.horaFin}, para ${nombres(d, 'pt-BR')} tem um aviso pendente de resolver. Em caso de dúvida, pode entrar em contato com o Coordenador.`,
    }),
  },
};

/**
 * El título y el cuerpo del aviso, en el idioma que la Prestadora tenga configurado.
 *
 * Un idioma que no está cae a `es-AR`, y una clave que no está devuelve `null`: quien llama no
 * manda nada antes que mandar un aviso vacío.
 */
export function avisoDeGuardiaParaLaFamilia(clave, idioma, datos = {}) {
  const enSuIdioma = AVISOS_DE_GUARDIA_PARA_LA_FAMILIA[idioma] ?? AVISOS_DE_GUARDIA_PARA_LA_FAMILIA['es-AR'];
  const armar = enSuIdioma[clave] ?? AVISOS_DE_GUARDIA_PARA_LA_FAMILIA['es-AR'][clave];
  if (!armar) return null;
  return armar(datos);
}
