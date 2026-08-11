// El catálogo de tipos de Asistente, visto desde el Panel.
//
// Cómo se llama un tipo —los generales se traducen, los propios de cada
// Prestadora no— vive en `tipoDeAsistente.js`, que es el mismo archivo en las
// tres aplicaciones. Acá quedan solamente las cosas que solo existen en el
// Panel: las tareas, la matrícula y la correspondencia con el texto viejo.

import { esTipoGeneral, nombreTipo } from './tipoDeAsistente';

export { esTipoGeneral, nombreTipo };

// Las dos listas de tareas: lo que le toca hacer y lo que no. Los mismos dos
// valores que acepta la base en `tareas_tipo_asistente.clase`.
export const CLASES_TAREA = ['corresponde', 'no_corresponde'];

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

// ---------------------------------------------------------------------------
// La correspondencia con lo que estaba escrito a mano
//
// Hasta ahora el tipo se escribía a mano, con lo cual una misma cosa quedó
// guardada de varias formas: "Enfermera", "enfermería", "Enf.". Eso ya no se
// escribe más, pero lo cargado no se borra: se ofrece la correspondencia una
// vez y la mira una persona antes de guardarla.
//
// Lo que sigue es una SUGERENCIA, no una conversión automática. Si duda, no
// sugiere nada: es preferible una casilla vacía que un tipo equivocado, porque
// el tipo es lo que decide si a esa persona se le exige matrícula.
// ---------------------------------------------------------------------------

// Deja el texto comparable: sin mayúsculas, sin tildes, sin nada que no sea
// letra. "Enfermería" y "ENFERMERIA" tienen que dar lo mismo.
//
// `normalize('NFD')` separa la letra de su tilde —la "é" pasa a ser "e" más un
// signito aparte—; el último paso, que se queda solo con la a a la z, tira ese
// signito junto con espacios, puntos y números.
function comparable(texto) {
  return (texto || '')
    .normalize('NFD')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

// La raíz de la palabra, sin las vocales del final. Es lo que hace que
// "enfermero", "enfermera" y "enfermería" se reconozcan como la misma cosa sin
// tener que enumerar cada variante a mano.
function raiz(texto) {
  return comparable(texto).replace(/[aeiou]+$/, '');
}

const LARGO_MINIMO_PARA_ARRIESGAR = 5;

function parecenLaMismaPalabra(unTexto, otroTexto) {
  const a = raiz(unTexto);
  const b = raiz(otroTexto);
  if (a.length < LARGO_MINIMO_PARA_ARRIESGAR || b.length < LARGO_MINIMO_PARA_ARRIESGAR) return false;
  return a.startsWith(b) || b.startsWith(a);
}

/**
 * Qué tipo del catálogo se parece a lo que había escrito a mano.
 *
 * `textos` son los valores viejos de ese Asistente. `tipos` es el catálogo que
 * ve esa Prestadora. Devuelve el id del tipo, o cadena vacía si no encuentra
 * ninguno o si encuentra más de uno.
 */
export function sugerirTipo(textos, tipos, t) {
  const escritos = (textos || []).filter(Boolean);
  if (escritos.length === 0) return '';

  const candidatos = (tipos || []).filter((tipo) =>
    escritos.some((texto) =>
      parecenLaMismaPalabra(texto, nombreTipo(tipo, t)) ||
      (esTipoGeneral(tipo) && parecenLaMismaPalabra(texto, tipo.clave)),
    ),
  );

  return candidatos.length === 1 ? candidatos[0].id : '';
}
