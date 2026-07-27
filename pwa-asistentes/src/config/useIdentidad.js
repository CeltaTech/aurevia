import { IDENTIDAD } from './identidadProducto.js';

// Punto de consumo de la identidad del producto desde un componente.
//
// Hoy devuelve una constante y podría no existir — se importa IDENTIDAD y listo. Existe
// igual porque a partir de la Etapa 3 la identidad deja de ser local: la manda CeltaTech por
// el mismo canal que los entitlements y pasa a ser estado reactivo. Cuando eso ocurra, lo
// único que cambia es el cuerpo de esta función; ningún componente que la use se toca.
//
// Regla de uso: los textos visibles NO llaman a este hook — escriben {{producto}} en el
// archivo de traducciones y LocaleProvider lo resuelve. Este hook es para lo que no pasa
// por i18n: el encabezado de marca, un logotipo, un color.
export function useIdentidad() {
  return IDENTIDAD;
}
