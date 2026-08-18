// Punto único de verdad para leer lo que devuelve el modelo (CLAUDE.md §7 regla 12).
//
// Por qué existe: los cinco lugares que llaman a la IA le piden un JSON "sin texto adicional"
// y hasta ahora hacían `JSON.parse` del texto crudo. Dos cosas hacen que eso falle, y las dos
// se comprobaron contra la API real el 2026-08-18:
//
//   1. El modelo suele envolver el JSON en un bloque de código (```json ... ```). El pedido
//      del prompt no alcanza para evitarlo, y `JSON.parse` de eso rompe siempre.
//   2. La respuesta puede traer primero un bloque de razonamiento y el texto después. Mirar
//      solo `content[0]` devolvía vacío en ese caso.
//
// Con cualquiera de las dos, la función que llamaba caía en su respuesta de emergencia: el
// reporte se guardaba sin estructurar, la alerta no se generaba, el mensaje de WhatsApp se
// escalaba al Coordinador. Fallaba en silencio, sin error visible.

// Junta el texto de la respuesta: todos los bloques de texto, salteando los de razonamiento.
export function textoDeRespuestaIA(respuesta) {
  const bloques = Array.isArray(respuesta?.content) ? respuesta.content : [];
  return bloques
    .filter((b) => b?.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

// Devuelve el objeto JSON que mandó el modelo, o null si no se pudo interpretar.
// Tolera el bloque de código y cualquier texto suelto antes o después del JSON.
export function jsonDeRespuestaIA(respuesta) {
  const texto = textoDeRespuestaIA(respuesta);
  if (!texto) return null;

  const candidatos = [texto];

  const enBloque = texto.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (enBloque) candidatos.push(enBloque[1]);

  const desde = texto.indexOf('{');
  const hasta = texto.lastIndexOf('}');
  if (desde !== -1 && hasta > desde) candidatos.push(texto.slice(desde, hasta + 1));

  for (const candidato of candidatos) {
    try {
      const parseado = JSON.parse(candidato.trim());
      if (parseado && typeof parseado === 'object') return parseado;
    } catch {
      // se prueba el siguiente candidato
    }
  }

  // Tercera causa de falla, también comprobada contra la API real: la respuesta se cortó por
  // llegar al tope de tokens y el JSON quedó por la mitad. Se deja constancia del motivo —
  // solo el motivo, nunca el contenido (regla 7 CLAUDE.md: dato de salud del paciente).
  if (respuesta?.stop_reason === 'max_tokens') {
    console.error('respuestaIA: la respuesta se cortó por llegar al tope de tokens (max_tokens)');
  }
  return null;
}
