// El catálogo de tipos de Asistente, visto desde el Panel.
//
// Un tipo puede venir de dos lados y eso cambia de dónde sale su nombre:
//
//   prestadora_id vacío  → tipo general de CeltaTech. En la base guarda una
//                          clave (`enfermero`) y el nombre visible sale de los
//                          archivos de traducción, en el idioma de quien mira.
//   prestadora_id cargado → tipo que creó esa Prestadora. Guarda el nombre como
//                          dato, escrito por ella, y no se traduce.
//
// Esa distinción se necesita en la pantalla de configuración, en la ficha del
// Asistente y en lo que ve la Familia. Vive acá una sola vez para que las tres
// muestren lo mismo (`CLAUDE.md` §7, regla 12).

import { traducirValor } from '../i18n/valores';

// Las dos listas de tareas: lo que le toca hacer y lo que no. Los mismos dos
// valores que acepta la base en `tareas_tipo_asistente.clase`.
export const CLASES_TAREA = ['corresponde', 'no_corresponde'];

export function esTipoGeneral(tipo) {
  return !tipo?.prestadora_id;
}

// El nombre para mostrar. No devuelve nunca la clave cruda en producción:
// `traducirValor` pone un guion si falta la traducción, y avisa en desarrollo.
export function nombreTipo(tipo, t) {
  if (!tipo) return '—';
  if (esTipoGeneral(tipo)) return traducirValor(t.tipos_asistente, tipo.clave);
  return tipo.nombre || '—';
}

// El nombre de la matrícula que exige un tipo. Las tres de fábrica están
// traducidas; una Prestadora puede escribir cualquier otra, y en ese caso se
// muestra tal cual la escribió.
export function nombreMatricula(tipoMatricula, t) {
  if (!tipoMatricula) return null;
  return t.tipos_asistente?.[`matricula_${tipoMatricula}`] || tipoMatricula;
}

// Las vías de medicación que este tipo NO puede administrar, según la
// configuración de la Prestadora.
//
// Esto no se guarda en ningún lado: se calcula cada vez que hace falta
// mostrarlo. Si se guardara como una tarea más, el día que la Prestadora
// cambie qué matrícula pide cada vía, la fila guardada seguiría diciendo lo de
// antes y la pantalla mostraría lo viejo sin que nadie se entere.
//
// `configuracionVias` son las filas de `configuracion_matricula_via_medicacion`
// de esa Prestadora.
export function viasVedadasPorMatricula(tipo, configuracionVias) {
  if (!tipo || !Array.isArray(configuracionVias)) return [];
  return configuracionVias
    .filter((via) => via.tipo_matricula_requerida)
    .filter((via) => via.tipo_matricula_requerida !== tipo.tipo_matricula)
    .map((via) => via.via_administracion);
}
