/* Tapar el dato de contacto adentro de un texto escrito por una persona.
   =====================================================================

   QUÉ RESUELVE. En la modalidad marketplace el chat entre la Familia y el Asistente es libre, y
   lo que se vende es llegar a la persona por afuera: el teléfono, el correo, la dirección
   (`docs/PRD_07_Modalidad_Marketplace.md:69`). Un chat libre donde se puede escribir un teléfono
   es esa misma venta regalada por otra puerta. Mientras el contacto de esa pareja no esté
   abierto, lo que sale hacia las dos pantallas sale tapado.

   ES UN PUNTO ÚNICO DE VERDAD, Y POR ESO ESTÁ ACÁ. La decisión de qué es un dato de contacto
   aparece en más de una ruta —el hilo de la Familia y el del Asistente—, así que existe una sola
   función y no la misma expresión copiada en dos lados.

   SE TAPA PARA LOS DOS LADOS. La pareja es la unidad. Tapando nada más lo que escribe el
   Asistente, la Familia pondría su propio número y la llamada saldría igual.

   NO SE TAPA AL GUARDAR. El texto se guarda entero y se tapa al salir. El día que esa Familia
   abre el contacto de ese Asistente, se abre también lo que ya se dijeron, porque es exactamente
   el dato que se pagó. Tapar al guardar lo perdería para siempre.

   QUÉ NO ALCANZA, Y SE DICE. Se tapa lo que se puede reconocer: números de teléfono, correos,
   direcciones web y nombres de usuario. Una dirección de una casa escrita en palabras no se
   reconoce, y el producto no finge que sí: la pantalla avisa que el chat tapa los datos de
   contacto y que lo que se escriba de más queda a la vista de la otra persona
   (`celtatech/CLAUDE.md` §7: el producto avisa, no bloquea).

   Y NO BLOQUEA EL ENVÍO. El mensaje sale igual, con lo demás entero. Rechazarlo le devolvería a
   quien escribe un cartel que le enseña qué forma probar la próxima vez, y encima le trabaría
   una conversación que es libre.

   POR QUÉ LA MARCA NO SE TRADUCE. Lo que queda en el lugar del dato es un signo, no una frase:
   una frase adentro del texto de otra persona se lee como si la hubiera escrito ella. La
   explicación va una sola vez en la pantalla, traducida, y sale de las traducciones. */

/** Lo que queda en el lugar del dato tapado. */
export const MARCA_TAPADO = '•••';

/* Cada forma, con su nombre, para que el que lee esto sepa qué reconoce cada expresión. El orden
   importa: el correo se busca antes que el teléfono, porque un correo puede tener números y si
   pasara primero el teléfono quedaría partido por la mitad. */
const FORMAS = [
  // alguien@algo.algo — sin espacios, con al menos un punto después de la arroba.
  { nombre: 'correo', expresion: /[^\s@]+@[^\s@]+\.[^\s@.]+/g },
  // Direcciones web escritas enteras, y las que arrancan en www.
  { nombre: 'direccion_web', expresion: /\b(?:https?:\/\/|www\.)\S+/gi },
  // Nombres de usuario de una red: @alguien. Después del correo, o se comería la cola de uno.
  { nombre: 'usuario_de_red', expresion: /(?<![\w@.])@[A-Za-z0-9._]{3,}/g },
  // Números de teléfono. Se aceptan espacios, guiones, puntos y paréntesis en el medio, que es
  // como los escribe la gente, y después se cuentan los dígitos de verdad.
  { nombre: 'telefono', expresion: /\+?\d[\d\s().\-]{5,}\d/g },
];

/** Desde cuántos dígitos un número deja de ser una cantidad y empieza a ser un teléfono. Siete
 *  es el número local más corto que se usa todavía; con seis entrarían los años y los importes. */
const DIGITOS_QUE_HACEN_UN_TELEFONO = 7;

function pareceTelefono(trozo) {
  return (trozo.match(/\d/g) || []).length >= DIGITOS_QUE_HACEN_UN_TELEFONO;
}

/**
 * Tapa los datos de contacto de un texto.
 *
 * @param {string} texto  Lo que escribió la persona.
 * @returns {{texto: string, tapado: boolean}}  El texto con las marcas puestas, y si se tapó algo.
 */
export function taparContacto(texto) {
  // Falla cerrado: lo que no se entiende no se muestra. Un texto que no es un texto no se
  // devuelve «tal cual por las dudas», porque las dudas son justamente lo que hay que tapar.
  if (typeof texto !== 'string') return { texto: '', tapado: false };

  let resultado = texto;
  let tapado = false;

  for (const forma of FORMAS) {
    resultado = resultado.replace(forma.expresion, (trozo) => {
      if (forma.nombre === 'telefono' && !pareceTelefono(trozo)) return trozo;
      tapado = true;
      // El teléfono puede haber arrastrado un espacio de adelante o de atrás al aceptar espacios
      // en el medio. Se devuelven, o dos palabras quedarían pegadas.
      const adelante = /^\s/.test(trozo) ? ' ' : '';
      const atras = /\s$/.test(trozo) ? ' ' : '';
      return `${adelante}${MARCA_TAPADO}${atras}`;
    });
  }

  return { texto: resultado, tapado };
}

/**
 * Prepara un mensaje para salir hacia una pantalla.
 *
 * Es la única puerta por la que un mensaje del chat sale del motor. Con el contacto abierto sale
 * entero; sin abrir, tapado. Quien llama no decide qué es un dato de contacto: decide una sola
 * cosa, si esa pareja ya pagó el contacto o no.
 *
 * @param {object} mensaje  La fila tal como está en la base.
 * @param {boolean} contactoAbierto
 */
export function mensajeHaciaAfuera(mensaje, contactoAbierto) {
  const base = {
    id: mensaje.id,
    lado: mensaje.lado,
    automatico: mensaje.automatico === true,
    created_at: mensaje.created_at,
    leido_at: mensaje.leido_at ?? null,
  };

  // Un mensaje automático no lo escribió nadie: su cuerpo es una clave de traducción y no hay
  // nada que tapar. Pasarlo por el tapado sería buscarle un teléfono a una clave.
  if (base.automatico) return { ...base, cuerpo: mensaje.cuerpo, tapado: false };

  if (contactoAbierto === true) return { ...base, cuerpo: mensaje.cuerpo, tapado: false };

  const { texto, tapado } = taparContacto(mensaje.cuerpo);
  return { ...base, cuerpo: texto, tapado };
}
