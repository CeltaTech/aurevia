/* Hablar en vez de escribir.
   ==========================================================================

   QUIÉN LO USA. Alguien que está de pie en la casa de otra persona, muchas veces con guantes,
   con poca luz y con una mano ocupada. Escribir en un teclado de teléfono es lo que hace que un
   reporte quede en dos renglones.

   LO DICTA EL PROPIO TELÉFONO. Se usa el reconocimiento de voz que ya trae el navegador
   (`SpeechRecognition`), que en Android y en iPhone es el mismo que usa el teclado. No se manda
   el audio a ningún servicio nuestro, no se graba ningún archivo y no hace falta ninguna
   credencial nueva: por eso no hay acá ninguna decisión de proveedor que consultar, y por eso el
   audio de adentro de una casa no viaja hasta nuestro servidor.

   DONDE NO EXISTE, NO SE MUESTRA. Un navegador sin reconocimiento de voz simplemente no ve el
   botón, y la caja de texto sigue estando: quien quiera dictar igual tiene el micrófono de su
   propio teclado. Nada de lo que se puede hacer hoy deja de poderse.

   Y LO DICTADO SE CORRIGE. El texto entra en la misma caja donde se escribe a mano, no en una
   ventana aparte: lo que reconoció mal se arregla ahí mismo antes de mandarlo. */

/**
 * Qué reconocedor tiene este navegador, si tiene alguno.
 *
 * Los dos nombres son el mismo motor: `webkitSpeechRecognition` es como lo publicaron Chrome y
 * Safari antes de que el nombre sin prefijo se estandarizara, y es el único que existe en varias
 * versiones de iPhone que hoy están en la mano de alguien.
 */
function claseDeReconocedor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null;
}

/** Si esto es `false`, el botón de dictar no se dibuja. */
export function hayDictado() {
  return claseDeReconocedor() !== null;
}

/**
 * Por qué se cortó. La lista de motivos la fija el navegador; acá se la reduce a los tres casos
 * que quien está trabajando puede resolver, y todo lo demás cae en uno solo.
 *
 * `no-speech` no es un error: el teléfono estuvo escuchando y no oyó nada. Se avisa distinto
 * porque la respuesta es otra —hablar más cerca— y porque tratarlo como falla haría creer que el
 * dictado no anda.
 */
export function motivoDelCorte(codigo) {
  if (codigo === 'not-allowed' || codigo === 'service-not-allowed') return 'sin_permiso';
  if (codigo === 'no-speech') return 'sin_voz';
  if (codigo === 'network') return 'sin_conexion';
  if (codigo === 'aborted') return null; // Lo cortó la propia persona: no hay nada que decirle.
  return 'falla';
}

/**
 * Arranca un dictado y devuelve cómo pararlo.
 *
 * @param {object} opciones
 * @param {string} opciones.idioma        En qué idioma escuchar, el de la pantalla (`es-AR`).
 * @param {(texto: string) => void} opciones.alReconocer  Lo que quedó firme, de a un pedazo.
 * @param {(texto: string) => void} opciones.alEscuchar   Lo que va oyendo, todavía sin confirmar.
 * @param {(motivo: string | null) => void} opciones.alTerminar  Al cortarse, con el motivo o sin ninguno.
 * @returns {() => void} La función que lo corta.
 */
export function dictar({ idioma, alReconocer, alEscuchar, alTerminar }) {
  const Reconocedor = claseDeReconocedor();
  if (!Reconocedor) {
    alTerminar('falla');
    return () => {};
  }

  const reconocedor = new Reconocedor();
  reconocedor.lang = idioma;
  // Sigue escuchando entre frase y frase: quien cuenta cómo pasó el día hace pausas, y cortar en
  // la primera obligaría a apretar el botón diez veces.
  reconocedor.continuous = true;
  // Y muestra lo que va oyendo antes de darlo por firme, que es lo que hace que se vea que está
  // escuchando de verdad.
  reconocedor.interimResults = true;

  let motivo = null;

  reconocedor.onresult = (evento) => {
    let firme = '';
    let provisorio = '';
    for (let i = evento.resultIndex; i < evento.results.length; i += 1) {
      const pedazo = evento.results[i][0]?.transcript ?? '';
      if (evento.results[i].isFinal) firme += pedazo;
      else provisorio += pedazo;
    }
    if (firme.trim()) alReconocer(firme.trim());
    alEscuchar(provisorio.trim());
  };

  reconocedor.onerror = (evento) => {
    motivo = motivoDelCorte(evento.error);
  };

  // Siempre termina acá, se haya cortado solo, por un error o porque lo pararon. Es el único
  // lugar que apaga el estado de la pantalla, así que no puede quedar encendido.
  reconocedor.onend = () => {
    alEscuchar('');
    alTerminar(motivo);
  };

  reconocedor.start();

  return () => {
    motivo = null;
    reconocedor.stop();
  };
}
