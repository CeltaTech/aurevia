import { supabase } from './supabaseClient';

// Los nombres de los asuntos: copia del original del motor, y se reexportan para que una pantalla
// importe el canal y sus asuntos del mismo lugar.
export { ASUNTOS } from './asuntosEnVivo';

/* El único canal abierto del Panel contra el motor.
   ==========================================================================

   QUÉ ES. Una conexión sola, compartida por todas las pantallas, por la que el motor avisa que
   algo cambió. El aviso no trae ningún dato: dice el asunto, y quien se suscribió vuelve a pedir
   lo que necesita por la ruta de siempre. El porqué de esa forma está del lado del motor, en
   `backend/src/avisosEnVivo/canal.js`.

   POR QUÉ NO `EventSource`. Porque no deja poner encabezados, y sin encabezado de autorización la
   única manera de que el motor sepa quién llama sería mandar el pase en la dirección. Un pase en
   la dirección queda escrito en el registro de cualquier intermediario y en el historial del
   navegador. Con `fetch` el pase viaja donde tiene que viajar, y leer el formato de los avisos
   —que es texto plano separado por renglones en blanco— son las veinte líneas de `partir()`.

   UNA SOLA CONEXIÓN, NO UNA POR PANTALLA. Quien se suscribe la abre si no estaba abierta, y la
   última que se va la cierra. Dos pantallas escuchando dos asuntos distintos comparten la misma.

   SI SE CAE, VUELVE A INTENTAR, CADA VEZ MÁS ESPACIADO. Un motor que se está reiniciando no
   tiene que recibir un intento por segundo de cada Panel abierto. Y en cuanto una conexión se
   establece, la espera vuelve al principio: lo que se está midiendo es cuánto hace que no hay
   canal, no cuántas veces se intentó en toda la sesión.

   Y QUIEN SE SUSCRIBE NO SE FÍA DE ESTO. El canal hace que el aviso llegue en el momento; que
   llegue siempre no lo garantiza —el motor puede estar corriendo en más de un proceso, o la
   conexión puede estar cayéndose sin que el navegador lo note—. Por eso quien se suscribe
   conserva su propia vuelta de respaldo, espaciada. */

const API_URL = import.meta.env.VITE_API_URL;

/** Cuánto se espera antes de volver a intentar, y hasta dónde crece. El primer reintento es casi
 *  inmediato porque la caída más común es el propio motor publicándose de nuevo. */
const ESPERA_INICIAL_MS = 1000;
const ESPERA_MAXIMA_MS = 60 * 1000;

/** Quién escucha qué. Asunto → conjunto de funciones. */
const suscriptos = new Map();

let cerrarLaConexion = null;
let esperaMs = ESPERA_INICIAL_MS;
let relojDeReintento = null;

/** Parte lo que llega en avisos. El protocolo separa un aviso del siguiente con un renglón en
 *  blanco, y lo que queda a medias entre dos lecturas se guarda para la próxima.
 *
 *  Sale afuera para poder probarla: la red entrega los pedazos donde se le ocurre, así que un
 *  aviso cortado al medio es lo normal y no un caso raro. */
export function partir(pendiente, texto) {
  const entero = pendiente + texto;
  const partes = entero.split('\n\n');
  // Lo último puede ser un aviso incompleto: se devuelve para pegarlo adelante del que viene.
  return { avisos: partes.slice(0, -1), pendiente: partes[partes.length - 1] };
}

/** De un aviso crudo, el asunto. Los renglones que empiezan con dos puntos son comentarios del
 *  protocolo —la señal de vida del motor— y no avisan de nada. */
export function asuntoDe(aviso) {
  for (const renglon of aviso.split('\n')) {
    if (renglon.startsWith('event:')) return renglon.slice('event:'.length).trim();
  }
  return null;
}

function avisar(asunto) {
  for (const escuchar of suscriptos.get(asunto) ?? []) {
    try {
      escuchar();
    } catch (err) {
      // Lo de una pantalla no puede dejar sin avisar a las otras.
      console.error('Error atendiendo un aviso en vivo:', err);
    }
  }
}

async function conectar() {
  const corte = new AbortController();
  cerrarLaConexion = () => corte.abort();

  const { data } = await supabase.auth.getSession();
  const respuesta = await fetch(`${API_URL}/api/panel/avisos-en-vivo`, {
    headers: { Authorization: `Bearer ${data.session?.access_token}` },
    signal: corte.signal,
  });
  if (!respuesta.ok || !respuesta.body) throw new Error(`El canal no abrió (${respuesta.status})`);

  // Llegó la respuesta: el canal está en pie. Lo que venga después de una caída empieza a
  // esperar de nuevo desde el principio.
  esperaMs = ESPERA_INICIAL_MS;

  const lector = respuesta.body.pipeThrough(new TextDecoderStream()).getReader();
  let pendiente = '';
  for (;;) {
    const { value, done } = await lector.read();
    if (done) break;
    const partido = partir(pendiente, value);
    pendiente = partido.pendiente;
    for (const aviso of partido.avisos) {
      const asunto = asuntoDe(aviso);
      if (asunto) avisar(asunto);
    }
  }
}

function abrirYSostener() {
  if (cerrarLaConexion || relojDeReintento) return;

  conectar()
    .catch((err) => {
      // Cerrar a propósito —porque se fue la última pantalla— no es una caída.
      if (err?.name !== 'AbortError') console.error('Canal de avisos en vivo interrumpido:', err.message);
    })
    .finally(() => {
      const habiaConexion = Boolean(cerrarLaConexion);
      cerrarLaConexion = null;
      // Sin nadie escuchando no se reconecta: la última pantalla que se fue cerró el canal.
      if (!habiaConexion || suscriptos.size === 0) return;
      relojDeReintento = setTimeout(() => {
        relojDeReintento = null;
        abrirYSostener();
      }, esperaMs);
      esperaMs = Math.min(esperaMs * 2, ESPERA_MAXIMA_MS);
    });
}

function cerrarSiNoQuedaNadie() {
  if (suscriptos.size > 0) return;
  clearTimeout(relojDeReintento);
  relojDeReintento = null;
  const cerrar = cerrarLaConexion;
  cerrarLaConexion = null;
  cerrar?.();
  esperaMs = ESPERA_INICIAL_MS;
}

/**
 * Escucha un asunto del canal. Devuelve la función que deja de escucharlo, para llamarla cuando
 * la pantalla se va.
 *
 * @param {string} asunto  Uno de los de `backend/src/avisosEnVivo/canal.js`.
 * @param {Function} escuchar  Qué hacer cuando ese asunto cambió. No recibe ningún dato: el
 *                             aviso dice qué cambió, no qué quedó.
 * @returns {Function}
 */
export function escucharEnVivo(asunto, escuchar) {
  if (!suscriptos.has(asunto)) suscriptos.set(asunto, new Set());
  suscriptos.get(asunto).add(escuchar);
  abrirYSostener();

  return () => {
    const conjunto = suscriptos.get(asunto);
    conjunto?.delete(escuchar);
    if (conjunto && conjunto.size === 0) suscriptos.delete(asunto);
    cerrarSiNoQuedaNadie();
  };
}
