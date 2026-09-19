/* Los idiomas del producto.
   ========================

   El producto habla tres idiomas desde el primer día, y hasta acá eso valía para las pantallas y
   no para lo que sale del motor: el aviso que llega por correo, por WhatsApp o al celular estaba
   escrito en castellano adentro del código, archivo por archivo. Este es el punto único donde se
   dice cuáles son los tres, cuál es el de por defecto y cómo se decide el de un aviso.

   ESTE ARCHIVO ES UN ORIGINAL CON COPIAS DECLARADAS en `scripts/copias_entre_apps.mjs`: el
   original es `backend/src/i18n/idiomas.js` y hay una copia idéntica en el Panel y en las dos
   aplicaciones. Está copiado y no importado porque cada unidad se despliega sola, sin acceso al
   código de las otras — el mismo motivo por el que `identidadProducto.js` existe cinco veces. Se
   edita siempre el original y después se corre `node scripts/sincronizar_copias.mjs`.

   DEL LADO DE LAS PANTALLAS lo consumen dos piezas: `i18n/translations.js`, que de acá saca la
   lista de idiomas y el de por defecto en vez de escribirlos otra vez, y `i18n/idiomaInicial.js`,
   que elige el idioma de quien entra por primera vez.

   LA LISTA ESTABA ESCRITA DOS VECES —en la ruta de los consentimientos y en la de la postulación
   pública— y las dos copias decían lo mismo por suerte, no por construcción. Ahora sale de acá.

   EL IDIOMA SE RESUELVE POR PAÍS cuando nadie lo eligió. No hay ninguna columna donde una persona
   guarde el idioma en el que quiere que le hablen, salvo la Postulante, que lo dejó escrito al
   completar el formulario público. Para todos los demás, lo que se sabe es el país de la
   Prestadora, y eso es lo que se usa. El día que exista un idioma elegido por persona, entra por
   `idiomaDelDestinatario` y no hay que tocar ningún emisor. */

export const IDIOMA_POR_DEFECTO = 'es-AR';

export const IDIOMAS_SOPORTADOS = ['es-AR', 'en', 'pt-BR'];

/* Qué se habla en cada país donde el producto puede estar. Sólo los que no hablan castellano
   hacen falta nombrarlos: todo lo demás cae en el idioma de por defecto, que es el del resto de
   la región. Un país que no está en esta lista no es un error, es un país hispanohablante o uno
   que todavía no se vendió; en los dos casos el castellano es la respuesta menos equivocada. */
const IDIOMA_DEL_PAIS = {
  BR: 'pt-BR',
  PT: 'pt-BR',
  AO: 'pt-BR',
  MZ: 'pt-BR',
  US: 'en',
  GB: 'en',
  CA: 'en',
  AU: 'en',
  NZ: 'en',
  IE: 'en',
  ZA: 'en',
};

/**
 * El idioma pedido, si es uno de los tres; si no, el de por defecto.
 *
 * Nunca devuelve nulo ni el valor que entró: quien llama arma un texto con lo que salga de acá, y
 * un idioma desconocido que pasara de largo terminaría en un aviso vacío.
 *
 * @param {string|null|undefined} valor
 * @returns {string}
 */
export function normalizarIdioma(valor) {
  return IDIOMAS_SOPORTADOS.includes(valor) ? valor : IDIOMA_POR_DEFECTO;
}

/**
 * El idioma que se habla en un país, o nulo si de ese país no se sabe nada.
 *
 * La diferencia con `idiomaDePais` es toda la respuesta cuando el país no está en la lista: acá
 * nulo, allá castellano. Las dos hacen falta y no son intercambiables. Quien tiene que armar un
 * aviso ya mismo necesita un idioma sí o sí, y el castellano es la respuesta menos equivocada;
 * quien todavía tiene otra señal para mirar —el idioma del navegador, por ejemplo— necesita
 * saber que acá no había respuesta, para ir a buscarla a la otra.
 *
 * @param {string|null|undefined} pais  código ISO de dos letras
 * @returns {string|null}
 */
export function idiomaDePaisSiSeSabe(pais) {
  if (!pais) return null;
  return IDIOMA_DEL_PAIS[String(pais).trim().toUpperCase()] ?? null;
}

/**
 * El idioma que se habla en un país, por su código ISO de dos letras.
 *
 * @param {string|null|undefined} pais
 * @returns {string}
 */
export function idiomaDePais(pais) {
  return idiomaDePaisSiSeSabe(pais) ?? IDIOMA_POR_DEFECTO;
}

/**
 * En qué idioma se le habla a una persona: en el que eligió, si lo eligió, y si no en el del
 * lugar donde trabaja la Prestadora que le escribe.
 *
 * Los dos valores pueden llegar vacíos y eso no es una falla: la mayoría de las personas nunca
 * eligió idioma, y una Prestadora sin país configurado todavía existe.
 *
 * @param {string|null|undefined} idiomaElegido  el que la persona dejó guardado, si hay alguno
 * @param {string|null|undefined} idiomaDelLugar  el que resolvió `idiomaDePais`
 * @returns {string}
 */
export function idiomaDelDestinatario(idiomaElegido, idiomaDelLugar) {
  if (IDIOMAS_SOPORTADOS.includes(idiomaElegido)) return idiomaElegido;
  return normalizarIdioma(idiomaDelLugar);
}
