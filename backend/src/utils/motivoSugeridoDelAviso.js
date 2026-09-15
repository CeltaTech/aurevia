import Anthropic from '@anthropic-ai/sdk';
import { registrarUsoIA } from './registrarUsoIA.js';
import { jsonDeRespuestaIA } from './respuestaIA.js';
import { MODELO_IA } from '../config/modeloIA.js';

/* El aviso llega hablado, y el catálogo pide una opción de la lista.
   ==========================================================================

   QUÉ RESUELVE. Cuando alguien llama para avisar que no va a poder ir, lo que dice es una
   frase: «me desperté con fiebre», «se cortó el tren en Constitución», «tuve que llevar a mi
   hijo al hospital». Quien atiende el teléfono tiene delante una lista de motivos —la que armó
   su Prestadora en `motivos_aviso_previo_guardia`— y tiene que elegir uno mientras sostiene la
   conversación. Lo que se elige mal ahí no se nota nunca más: la Prestadora termina con la
   mitad de sus avisos en «Otro», y entonces no puede saber cuántas ausencias le causa el
   transporte y cuántas la salud, que es justamente para lo que armó la lista.

   Acá se lee esa frase y se sugiere cuál de sus motivos es. Se sugiere: la elige la persona.

   EL CATÁLOGO ES EL DE ESA PRESTADORA, Y ES EL LÍMITE. El modelo no propone categorías: elige
   entre las que la Prestadora tiene activas, y lo que devuelva se comprueba contra esa misma
   lista antes de contestar. Un motivo inventado —o uno que la Prestadora dio de baja— no sale
   de acá, porque después la pantalla no podría guardarlo y el Coordinador vería una sugerencia
   que no puede aceptar.

   Y NO ELIGE EL MÁS PARECIDO. Cuando ninguno encaja, la respuesta es que no hay sugerencia.
   Una lista de motivos sirve para contar, y un motivo puesto a la fuerza ensucia la cuenta
   peor que no poner ninguno: el que falta se ve, el que está mal no.

   LO QUE SE DICE NO SE GUARDA NI SE REGISTRA. La frase puede traer el diagnóstico de quien
   llama o el de un familiar suyo, que es dato de salud de una persona que no es Paciente de
   nadie. Viaja al modelo para esta pregunta y no queda escrito en ningún lado: ni en la base
   —lo que se guarda es el motivo elegido, como siempre— ni en el registro del motor, ni
   siquiera cuando algo falla (`celtatech/CLAUDE.md` §6).

   SIN EL TRATO, Y A PROPÓSITO. Los demás pedidos al modelo le suman `TRATO_IA` porque lo que
   contestan lo lee una persona. Acá no sale prosa: sale un nombre copiado del catálogo, o nada.
   Un párrafo sobre cómo hablarle a quien lee sería texto de más en el pedido y no cambiaría una
   sola letra de la respuesta. El día que esto devuelva algo escrito, el trato entra.

   SIN IA SE SIGUE TRABAJANDO IGUAL. Sin clave de API, con el modelo caído o con una respuesta
   ilegible, esto devuelve «ninguna sugerencia» y nadie se entera de que faltó: la pantalla es
   la misma que era antes, con su lista y su persona eligiendo. Ésta es la mitad que agrega
   comodidad, nunca la que decide. */

const INSTRUCCION = `Este asistente ayuda a quien atiende el teléfono en una empresa de cuidado
domiciliario. Alguien que tenía que ir a trabajar avisa que no va a poder, o que va a llegar
tarde, y cuenta por qué con sus palabras. La tarea es decir cuál de los motivos de la lista
corresponde a lo que contó.

Reglas de la elección:
- Se elige uno de los motivos de la lista, escrito exactamente como está en la lista. No se
  proponen motivos nuevos ni se reescribe el nombre de uno de la lista.
- Si ninguno corresponde con claridad, se devuelve null. No se elige el más parecido: una
  elección forzada vale menos que ninguna.
- Si lo que se contó no alcanza para decidir entre dos motivos, también se devuelve null.

Se responde únicamente con un JSON de esta forma, sin texto adicional:
{"motivo": "nombre exacto de la lista"} o {"motivo": null}`;

let cliente = null;
function obtenerCliente() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!cliente) cliente = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return cliente;
}

/**
 * Los motivos que se le pueden ofrecer a quien atiende, por nombre.
 *
 * Los de baja quedan afuera: el catálogo de hoy es el que está activo hoy, y los avisos viejos
 * que nombran un motivo retirado siguen diciendo lo que decían porque lo que se guarda es el
 * texto (ver `20260910230000_los_motivos_de_cierre_los_arma_cada_prestadora.sql`).
 */
export function nombresElegibles(motivos) {
  return (Array.isArray(motivos) ? motivos : [])
    .filter((m) => m?.activo && typeof m.nombre === 'string' && m.nombre.trim())
    .map((m) => m.nombre);
}

/**
 * Lee lo que se contó y sugiere uno de los motivos de la Prestadora.
 *
 * `motivos` son las filas de `motivos_aviso_previo_guardia` de esa Prestadora, tal como salen
 * de la base; quien llama ya las acotó a la Organización activa.
 *
 * Devuelve siempre `{ motivo }`, con el nombre exacto de uno de los activos o `null`. Nunca
 * lanza: la pantalla que la usa tiene que seguir funcionando sin sugerencia.
 */
export async function sugerirMotivoDelAviso({ texto, motivos, prestadoraId }) {
  const elegibles = nombresElegibles(motivos);
  const contado = typeof texto === 'string' ? texto.trim() : '';
  if (!contado || elegibles.length === 0) return { motivo: null };

  const anthropic = obtenerCliente();
  if (!anthropic) return { motivo: null };

  try {
    const respuesta = await anthropic.messages.create({
      model: MODELO_IA,
      max_tokens: 200,
      system: INSTRUCCION,
      messages: [
        {
          role: 'user',
          content: `Motivos de la lista: ${elegibles.map((n) => JSON.stringify(n)).join(', ')}
Lo que se contó: ${contado}`,
        },
      ],
    });

    registrarUsoIA({ prestadoraId, modulo: 'motivo_aviso_previo', modelo: MODELO_IA, respuestaAnthropic: respuesta });

    const parseado = jsonDeRespuestaIA(respuesta);
    const sugerido = parseado?.motivo;
    // La comprobación contra la lista no es una formalidad: sin ella, un nombre parecido pero
    // no idéntico llegaría a la pantalla como una opción que el select no tiene, y quien atiende
    // vería una sugerencia que no puede aceptar.
    return { motivo: elegibles.includes(sugerido) ? sugerido : null };
  } catch (err) {
    // El motivo de la falla y nada más. Lo que se contó no entra en ningún registro, ni siquiera
    // acá: es lo único que esta función tiene en la mano que puede ser dato de salud.
    console.error('sugerirMotivoDelAviso: no se pudo consultar al modelo:', err.message);
    return { motivo: null };
  }
}
