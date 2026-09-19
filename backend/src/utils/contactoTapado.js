/* Un mensaje del chat, listo para salir hacia una pantalla.
   =========================================================

   QUÉ CAMBIÓ ACÁ, Y POR QUÉ. Este archivo tapaba. Tenía cuatro expresiones escritas adentro
   —correo, dirección web, nombre de usuario y teléfono—, guardaba el texto entero y lo tapaba
   recién al salir. Las tres cosas iban contra la regla que comparten este producto y su hermano
   —la de datos y marca, §4—: qué se tapa es dato y no código, y se tapa antes de guardar, del
   lado de la base. Con el texto guardado entero, quien llegara al dato por
   cualquier otra vía —otra ruta del motor, una consulta directa, un respaldo— lo veía completo.

   DÓNDE SE TAPA AHORA. En la base, antes de escribir, con el cuerpo de reglas de
   `public.reglas_de_los_mensajes` y el disparador de
   `supabase/migrations/20261001120000_reglas_de_los_mensajes.sql`. Lo que llega acá ya viene
   tapado, venga por donde venga.

   QUÉ QUEDA ACÁ. Lo único que nunca fue del tapado: darle forma a la fila para la pantalla, y
   decirle a quien escribió por qué su mensaje tiene marcas. El motivo sale del catálogo, en los
   tres idiomas, y lo elige la pantalla según el idioma de quien mira.

   Y NO SE BLOQUEA NADA. El mensaje salió y llegó, con lo demás entero. */

/**
 * Prepara un mensaje para salir hacia una pantalla.
 *
 * Es la única puerta por la que un mensaje del chat sale del motor.
 *
 * @param {object} mensaje  La fila tal como está en la base, ya tapada.
 * @param {Record<string, object>} motivos  Por clave de regla, el motivo en los tres idiomas.
 */
export function mensajeHaciaAfuera(mensaje, motivos = {}) {
  const regla = mensaje.regla_tapada ?? null;

  return {
    id: mensaje.id,
    lado: mensaje.lado,
    automatico: mensaje.automatico === true,
    created_at: mensaje.created_at,
    leido_at: mensaje.leido_at ?? null,
    cuerpo: mensaje.cuerpo,
    tapado: regla !== null,
    // El motivo viaja en los tres idiomas y la pantalla elige el suyo. Traducirlo acá ataría el
    // texto del catálogo al idioma que adivinó el motor.
    motivo_tapado: regla === null ? null : motivos[regla] ?? null,
  };
}
