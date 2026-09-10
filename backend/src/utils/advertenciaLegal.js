import { supabase } from '../db/connection.js';

// ---------------------------------------------------------------------------------------
// El aviso legal: un solo lugar que lo resuelve y un solo lugar que lo registra
//
// CÓMO FUNCIONA UN AVISO (CLAUDE.md §7, y `docs/legal/<país>.md` para los textos):
//
//   * El producto no prohíbe ni bloquea nada por razones legales. Avisa.
//   * El texto sale del documento legal de esa jurisdicción, nunca de una analogía con otro
//     país. Si el país no tiene documento, no hay aviso: `advertenciaVigente` devuelve null
//     y quien llamó sigue adelante igual.
//   * Queda registrado que se avisó: quién, cuándo, qué función y qué texto se mostró.
//
// POR QUÉ ESTO VIVE EN EL MOTOR Y NO EN LA PANTALLA. Hasta acá el registro lo escribía el
// Panel desde el navegador, en el mismo momento en que la persona cerraba el cartel. Eso
// hacía que el registro dependiera de que la pantalla se acordara de escribirlo: cualquier
// otro camino hasta la misma acción —otra pantalla, la dirección escrita a mano— encendía la
// función sin dejar rastro de que se avisó, y un registro que se puede saltear no sirve como
// registro. Ahora el aviso se anota en el mismo pedido que hace la cosa, así que no hay
// forma de hacer la cosa sin anotarlo. La pantalla sigue mostrando el cartel antes, que es
// lo que le corresponde: que la persona decida sabiendo.
//
// ESTO NUNCA HACE FALLAR A QUIEN LO LLAMA. Un aviso que no se pudo resolver no puede
// convertirse en una acción que no se pudo hacer: sería el producto bloqueando por razón
// legal, que es exactamente lo que la regla prohíbe. Los errores se registran en la consola
// del servidor y la acción sigue.
// ---------------------------------------------------------------------------------------

/**
 * Las advertencias escritas para esas funciones en la jurisdicción de esa Prestadora.
 *
 * @returns un `Map` de `funcionClave` a `{ jurisdiccion, texto }`. Las funciones cuya
 *          jurisdicción no tiene documento legal no aparecen en el mapa.
 */
export async function advertenciasVigentes(prestadoraId, funcionClaves) {
  const claves = (funcionClaves || []).filter(Boolean);
  if (!prestadoraId || !claves.length) return new Map();

  const { data: prestadora, error: errorPrestadora } = await supabase
    .from('prestadoras')
    .select('pais')
    .eq('id', prestadoraId)
    .maybeSingle();
  if (errorPrestadora || !prestadora?.pais) return new Map();

  const { data, error } = await supabase
    .from('advertencias_legales')
    .select('funcion_clave, texto_advertencia')
    .eq('jurisdiccion', prestadora.pais)
    .in('funcion_clave', claves);
  if (error) return new Map();

  return new Map(
    (data || []).map((fila) => [
      fila.funcion_clave,
      { jurisdiccion: prestadora.pais, texto: fila.texto_advertencia },
    ])
  );
}

/**
 * La advertencia escrita para esa función en la jurisdicción de esa Prestadora.
 *
 * @returns `{ jurisdiccion, texto }`, o `null` si esa jurisdicción no tiene documento legal
 *          para esa función — que es el caso en el que no hay nada que avisar.
 */
export async function advertenciaVigente(prestadoraId, funcionClave) {
  const mapa = await advertenciasVigentes(prestadoraId, [funcionClave]);
  return mapa.get(funcionClave) ?? null;
}

/**
 * Deja registrado que se avisó: quién, cuándo, qué función y qué texto se mostró.
 *
 * Se usa cuando quien llama ya resolvió la advertencia —porque la necesitaba para guardar
 * junto con la cosa que activó— y no tiene sentido volver a preguntársela a la base.
 */
export async function registrarAviso({ prestadoraId, usuarioId, funcionClave, advertencia }) {
  if (!advertencia) return null;

  const { error } = await supabase.from('auditoria_advertencias_legales').insert({
    prestadora_id: prestadoraId,
    usuario_id: usuarioId,
    funcion_clave: funcionClave,
    jurisdiccion: advertencia.jurisdiccion,
    texto_mostrado: advertencia.texto,
  });
  // El texto crudo de la base nombra tablas y columnas, así que no sale de acá (CLAUDE.md §6).
  if (error) console.error('No se pudo registrar el aviso legal:', funcionClave, error.message);

  return advertencia;
}

/**
 * Resuelve el aviso que corresponde y lo deja registrado, todo junto.
 *
 * Se llama en el mismo pedido que activa la función. Si la jurisdicción no tiene documento
 * para esa función no registra nada y devuelve `null`: no hubo aviso que dar.
 *
 * @returns `{ jurisdiccion, texto }` si se avisó, `null` si no había nada que avisar.
 */
export async function registrarAvisoAlActivar({ prestadoraId, usuarioId, funcionClave }) {
  const advertencia = await advertenciaVigente(prestadoraId, funcionClave);
  return registrarAviso({ prestadoraId, usuarioId, funcionClave, advertencia });
}
