/* El canal único por el que el motor le avisa al Panel que algo cambió.
   ==========================================================================

   QUÉ RESUELVE. Hasta acá el Panel no tenía ningún canal abierto contra el motor: la única
   pantalla que necesitaba enterarse de algo en el momento —el pase de guardia, con alguien
   parado en una puerta esperando el código— preguntaba cada doce segundos, y así estaba escrito
   en su propio archivo, como solución de mientras tanto. Preguntar cada tanto tiene dos
   defectos que no se arreglan bajando el número: lo que se ve llega siempre tarde, y el costo
   lo paga el motor en cada vuelta aunque no haya pasado nada.

   ES UNO SOLO, Y POR ESO ESTÁ ACÁ. La segunda pantalla que necesite avisos en vivo no abre su
   propio canal: se cuelga de éste con un asunto nuevo. Un canal por pantalla serían tantas
   conexiones abiertas por persona como pantallas mirando, y cada una con su forma propia de
   reconectar.

   POR EL CANAL NO VIAJA NINGÚN DATO, SOLAMENTE EL ASUNTO. El aviso dice «los pedidos de código
   cambiaron» y nada más; la pantalla vuelve a pedir la lista por la ruta de siempre, que
   comprueba la sesión y filtra por la Organización. Eso mantiene una sola puerta hacia los datos
   —la que ya está escrita y probada— y hace que una conexión que quedó abierta de más no pueda
   mostrar nada: el permiso se vuelve a comprobar en cada consulta, no una sola vez al abrir.

   POR QUÉ SSE Y NO UN SOCKET. El aviso va en un solo sentido, del motor a la pantalla; el Panel
   le habla al motor por las rutas que ya tiene. Un socket bidireccional agregaría una biblioteca,
   un protocolo propio y una segunda forma de entrar al motor para conseguir lo mismo. Esto es
   HTTP corriente y lo atraviesa cualquier intermediario.

   LO QUE ESTE CANAL NO GARANTIZA, Y CÓMO SE CUBRE. Las conexiones abiertas viven en la memoria
   del proceso que las atiende, así que un aviso nacido en un proceso no llega a una pantalla
   conectada a otro. Mientras el motor corra en un solo proceso no hay diferencia; el día que
   corra en varios, lo que se pierde es la inmediatez y no el dato, porque del otro lado la
   pantalla igual vuelve a preguntar cada tanto —espaciado, no cada doce segundos—. Ese respaldo
   es parte del diseño y no una precaución sobrante: un canal en vivo que se cae sin que nadie se
   entere deja la pantalla quieta para siempre.

   UNA CONEXIÓN NO DURA PARA SIEMPRE, A PROPÓSITO. Se cierra sola al cabo de un rato y la
   pantalla la vuelve a abrir. Así el token se comprueba de nuevo cada tanto —una sesión de
   soporte que venció no se queda con un canal abierto—, y de paso se limpian las conexiones que
   quedaron colgadas de un intermediario que ya no está del otro lado. */

// Los nombres de los asuntos están en su propio archivo porque los necesitan los dos lados. Se
// reexportan desde acá para que quien empuja un aviso importe de un solo lugar.
export { ASUNTOS } from './asuntos.js';

/** Cada cuánto se manda una señal de vida. Sin nada escrito, un intermediario que no ve tráfico
 *  corta la conexión y la pantalla se queda esperando un aviso que no va a llegar. Veinte
 *  segundos están cómodamente por debajo del minuto que suele usar cualquiera de ellos. */
const CADA_CUANTO_LA_SEÑAL_DE_VIDA_MS = 20 * 1000;

/** Cuánto vive una conexión antes de que el motor la cierre para que la pantalla la reabra.
 *  Quince minutos: bastante como para que reabrir no sea un costo, y bastante poco como para
 *  que el permiso se vuelva a comprobar dentro de la hora que dura como mucho una sesión de
 *  soporte (`celtatech/CLAUDE.md` §6). */
const CUANTO_VIVE_UNA_CONEXION_MS = 15 * 60 * 1000;

/** Quiénes están escuchando, por Organización. El valor es el conjunto de respuestas HTTP
 *  abiertas: una persona con el Panel abierto en dos pestañas cuenta dos. */
const escuchando = new Map();

/**
 * Deja una conexión abierta escuchando los avisos de una Organización. La ruta que llama a esto
 * ya comprobó la sesión y resolvió cuál es la Organización activa.
 *
 * @param {object} res  La respuesta de Express, que a partir de acá no se cierra.
 * @param {string} prestadoraId  La Organización cuyos avisos va a recibir esta conexión.
 */
export function escuchar(res, prestadoraId) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    // Algunos intermediarios juntan la respuesta antes de entregarla, y con eso el aviso llega
    // recién cuando la conexión se cierra, o sea nunca.
    'X-Accel-Buffering': 'no',
  });
  // Un primer envío deja la conexión establecida de verdad: hasta que no se escribe algo, del
  // otro lado el `fetch` sigue esperando los encabezados.
  res.write(': conectado\n\n');
  res.flushHeaders?.();

  if (!escuchando.has(prestadoraId)) escuchando.set(prestadoraId, new Set());
  escuchando.get(prestadoraId).add(res);

  const señalDeVida = setInterval(() => {
    // Un comentario del protocolo: mantiene la conexión con tráfico sin que la pantalla lo vea
    // como un aviso.
    res.write(': sigo acá\n\n');
  }, CADA_CUANTO_LA_SEÑAL_DE_VIDA_MS);

  const relojDeVida = setTimeout(() => res.end(), CUANTO_VIVE_UNA_CONEXION_MS);

  const soltar = () => {
    clearInterval(señalDeVida);
    clearTimeout(relojDeVida);
    const conjunto = escuchando.get(prestadoraId);
    conjunto?.delete(res);
    // Sin esto el mapa acumularía una entrada vacía por cada Organización que alguna vez
    // escuchó, y no se vaciarían nunca.
    if (conjunto && conjunto.size === 0) escuchando.delete(prestadoraId);
  };

  res.on('close', soltar);
  res.on('error', soltar);
}

/**
 * Le avisa a quien esté mirando el Panel de esa Organización que algo de ese asunto cambió. No
 * manda ningún dato: quien recibe el aviso vuelve a pedir lo que necesita.
 *
 * Nunca falla ni demora a quien la llama: un aviso que no sale no puede tumbar la operación que
 * lo produjo, y lo que se pierde lo recupera la pantalla en su próxima vuelta.
 *
 * @param {string} prestadoraId
 * @param {string} asunto  Uno de `ASUNTOS`.
 */
export function empujar(prestadoraId, asunto) {
  const conexiones = escuchando.get(prestadoraId);
  if (!conexiones?.size) return;

  const mensaje = `event: ${asunto}\ndata: {}\n\n`;
  for (const res of conexiones) {
    try {
      res.write(mensaje);
    } catch {
      // La conexión se cayó entre el `size` y el `write`. El `close` la saca del conjunto sola;
      // acá lo único que hace falta es no cortar el aviso a las demás.
    }
  }
}

/** Cuántas conexiones hay abiertas, por Organización. Existe para las pruebas: sin esto, que el
 *  canal suelte lo que ya no sirve sólo se podría comprobar mirándolo por dentro. */
export function cuantosEscuchan(prestadoraId) {
  return escuchando.get(prestadoraId)?.size ?? 0;
}
