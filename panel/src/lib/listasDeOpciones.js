/* Las dos reglas de las listas de opciones, escritas afuera de cualquier pantalla.
 *
 * Las dos estaban resueltas, pero adentro del archivo de una pantalla, así que sólo valían
 * mientras la carga pasara por ahí: una segunda pantalla que cargara opciones las volvía a
 * inventar, y probablemente distinto. Acá quedan en un solo lugar, y su versión que no se puede
 * esquivar vive en la base —restricciones y disparadores de la migración
 * `20261001150000_las_listas_de_opciones.sql`—. Lo de este archivo es lo que la pantalla necesita
 * para mostrar y para anticipar, nunca la garantía.
 *
 * REGLA 1 — DESDE QUÉ NÚMERO SE ORDENAN LAS OPCIONES PROPIAS. Lo que agrega una Prestadora va
 * detrás del catálogo que trae el producto, no intercalado entre sus opciones: se cuenta desde
 * 100 mirando sólo las propias, así que la primera queda en 101. Si se contara desde cero, la
 * primera opción propia caería adelante de todo el catálogo general y quien elige vería su
 * agregado antes que lo de fábrica.
 *
 * REGLA 2 — EN QUÉ IDIOMAS SE EXIGE EL TEXTO. Lo que carga una Prestadora queda en el idioma en
 * que lo escribió: la regla de i18n rige el texto que escribe el producto, no el que carga el
 * cliente. Por eso a la opción general se le piden los tres idiomas y a la propia uno solo. A una
 * Prestadora no se le puede pedir que traduzca a tres idiomas lo que escribió para su gente, y
 * traducirlo por ella sería inventarle texto.
 */

// El número desde el que se cuentan las opciones propias. Es el mismo que devuelve
// `interno.orden_desde_el_que_cuentan_las_opciones_propias()` en la base.
export const ORDEN_DESDE_EL_QUE_CUENTAN_LAS_PROPIAS = 100;

// El idioma en el que se guarda lo que carga una Prestadora.
export const IDIOMA_EN_QUE_ESCRIBE_LA_PRESTADORA = 'es-AR';

/* Regla 1. Qué número de orden le toca a la opción que se está por agregar. El número definitivo
   lo pone la base, que es la que ve todas las filas; esto es lo que la pantalla muestra mientras
   tanto. */
export function ordenSiguiente(opcionesDeLaLista) {
  return (
    (opcionesDeLaLista ?? [])
      .filter((opcion) => opcion.prestadora_id)
      .reduce(
        (mayor, opcion) => Math.max(mayor, Number(opcion.orden) || 0),
        ORDEN_DESDE_EL_QUE_CUENTAN_LAS_PROPIAS,
      ) + 1
  );
}

/* Regla 2. El texto que carga una Prestadora se guarda en el idioma en que lo escribió. */
export function comoLoEscribioLaPrestadora(texto) {
  return { [IDIOMA_EN_QUE_ESCRIBE_LA_PRESTADORA]: String(texto ?? '').trim() };
}

/* Y del otro lado, al leer: se muestra el idioma de quien mira, y si esa opción no lo tiene
   —porque la cargó una Prestadora en el suyo— se muestra el que tenga. Mostrar un renglón en
   blanco sería peor que mostrarlo en otro idioma. */
export function textoDeLaOpcion(i18n, idioma) {
  if (!i18n || typeof i18n !== 'object') return '';
  const enSuIdioma = i18n[idioma];
  if (enSuIdioma && String(enSuIdioma).trim()) return String(enSuIdioma);
  const primero = Object.values(i18n).find((valor) => valor && String(valor).trim());
  return primero ? String(primero) : '';
}

/* La misma comprobación que hacen los dos CHECK de la base, para que la pantalla pueda apagar el
   botón antes de mandar algo que va a volver rechazado. */
export function elTextoEstaCompleto(i18n) {
  return ['es-AR', 'en', 'pt-BR'].every((idioma) => String(i18n?.[idioma] ?? '').trim() !== '');
}

export function elTextoTieneAlMenosUno(i18n) {
  return String(i18n?.[IDIOMA_EN_QUE_ESCRIBE_LA_PRESTADORA] ?? '').trim() !== '';
}

/* La clave de una opción es lo que queda guardado en la ficha de quien la eligió, así que se
   escribe una vez y no se renombra. Se arma a partir del texto para que quien carga no tenga que
   pensar en dos cosas. */
export function claveDesdeElTexto(texto) {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}
