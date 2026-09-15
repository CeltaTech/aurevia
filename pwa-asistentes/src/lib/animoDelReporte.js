// Cómo se dice el ánimo del día en las dos aplicaciones.
//
// El Asistente lo elige al escribir el reporte y la Familia lo lee después, en la lista de
// reportes y adentro de cada uno. Son tres pantallas de dos aplicaciones distintas mostrando la
// misma escala: si cada una escribe su propia lista de caras, alcanza con que alguien agregue un
// escalón en una para que la misma jornada se lea distinta según dónde se la mire.
//
// EL ORDEN ES EL DE LA ESCALA, de mejor a peor, y es el que se dibuja en el reporte. No se
// ordena alfabéticamente ni se reordena por gusto: quien elige un ánimo lo hace de memoria, por
// la posición.
//
// LAS CARAS SON UN APOYO, NO EL DATO. El texto sale de las traducciones, en los tres idiomas, y
// la cara va siempre con `aria-hidden` al lado de ese texto: un emoji lo lee cada lector de
// pantalla a su manera, y "cara sonriente con ojos sonrientes" no es lo que se quiso decir.

export const ESTADOS_ANIMO = ['muy_bien', 'bien', 'regular', 'mal', 'muy_mal'];

const CARAS = {
  muy_bien: '😄',
  bien: '🙂',
  regular: '😐',
  mal: '🙁',
  muy_mal: '😣',
};

/** La cara de este ánimo, o cadena vacía si el valor guardado no es uno de la escala. */
export function caraDelAnimo(estado) {
  return CARAS[estado] ?? '';
}
