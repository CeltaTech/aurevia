// Cómo se llama un motivo de cierre y qué se guarda cuando se cierra la atención de un Paciente.
//
// Un motivo puede venir de dos lugares y no se muestran igual: los siete que trae el producto
// guardan una clave, y su texto sale de los archivos de traducción, para que el Panel en inglés
// no diga «fallecimiento»; los que agrega la Prestadora guardan el nombre que escribió ella, que
// es información suya y no se traduce.
//
// Está en un archivo aparte porque la misma decisión la toman tres pantallas —el cierre, la lista
// de cierres avisados y la administración del catálogo—, y repetida en tres lugares se despega en
// el cuarto.

import { traducirValor } from '../i18n/valores';

export function esMotivoDeFabrica(motivo) {
  return Boolean(motivo?.clave);
}

// El nombre para mostrar de una fila del catálogo. No devuelve nunca la clave cruda:
// `traducirValor` pone un guion si falta la traducción, y avisa en desarrollo.
export function nombreMotivo(motivo, t) {
  if (!motivo) return '—';
  if (esMotivoDeFabrica(motivo)) return traducirValor(t.prestaciones, `cierre_servicio_motivo_${motivo.clave}`);
  return motivo.nombre || '—';
}

// Lo que queda escrito en el cierre. Se guarda el texto y no el identificador de la fila a
// propósito, igual que hace la Guardia con su motivo de aviso previo: un cierre dice para siempre
// lo que decía el día que se hizo, aunque la Prestadora borre o renombre el motivo después.
export function valorGuardado(motivo) {
  return motivo?.clave ?? motivo?.nombre ?? '';
}

// Y al revés, para mostrar un cierre que ya está guardado. No se lo busca en el catálogo, porque
// puede haber desaparecido de ahí: si el texto guardado es una de las claves de fábrica se
// traduce, y si no, se muestra tal cual, que es como lo escribió la Prestadora.
export function nombreMotivoGuardado(valor, t) {
  if (!valor) return '—';
  return t.prestaciones?.[`cierre_servicio_motivo_${valor}`] || valor;
}
