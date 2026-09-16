// Cómo se llama un motivo que sale de un catálogo de la Prestadora, y qué se guarda cuando se
// elige uno.
//
// Un motivo puede venir de dos lugares y no se muestran igual: los que trae el producto guardan
// una clave, y su texto sale de los archivos de traducción, para que el Panel en inglés no diga
// «fallecimiento»; los que agrega la Prestadora guardan el nombre que escribió ella, que es
// información suya y no se traduce.
//
// Esta decisión es la misma en todos los catálogos de motivos —el cierre de la atención de un
// Paciente, la causa de una sustitución, y los que vengan—, y por eso vive acá una sola vez. Cada
// catálogo la usa diciendo dónde están sus traducciones: la sección del archivo de idioma y el
// prefijo de sus claves.

import { traducirValor } from '../i18n/valores';

export function esMotivoDeFabrica(motivo) {
  return Boolean(motivo?.clave);
}

// El nombre para mostrar de una fila del catálogo. No devuelve nunca la clave cruda:
// `traducirValor` pone un guion si falta la traducción, y avisa en desarrollo.
export function nombreDeMotivo(motivo, seccion, prefijo) {
  if (!motivo) return '—';
  if (esMotivoDeFabrica(motivo)) return traducirValor(seccion, `${prefijo}${motivo.clave}`);
  return motivo.nombre || '—';
}

// Lo que queda escrito. Se guarda el texto y no el identificador de la fila a propósito, igual que
// hace la Guardia con su motivo de aviso previo: lo que se anotó dice para siempre lo que decía el
// día que se hizo, aunque la Prestadora borre o renombre el motivo después.
export function valorGuardado(motivo) {
  return motivo?.clave ?? motivo?.nombre ?? '';
}

// Y al revés, para mostrar algo que ya está guardado. No se lo busca en el catálogo, porque puede
// haber desaparecido de ahí: si el texto guardado es una de las claves de fábrica se traduce, y si
// no, se muestra tal cual, que es como lo escribió la Prestadora.
export function nombreDeMotivoGuardado(valor, seccion, prefijo) {
  if (!valor) return '—';
  return seccion?.[`${prefijo}${valor}`] || valor;
}
