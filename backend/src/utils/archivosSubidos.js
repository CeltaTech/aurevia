/* Cómo se nombra y dónde se guarda un archivo que sube alguien.
   ==========================================================================

   POR QUÉ EXISTE ESTE ARCHIVO. Las seis rutas del motor que reciben un archivo armaban su ruta
   del depósito a mano, y la misma línea que traduce el tipo de archivo a una extensión estaba
   escrita cinco veces. Peor todavía en la Matrícula: la ruta se armaba igual en dos rutas
   distintas —la del teléfono del Asistente y la del Panel— y una tercera la comprobaba con otra
   forma. Que la comprobación y la construcción vivan separadas es cómo se cuelan los agujeros:
   alcanza con que una de las dos cambie.

   La regla de dónde va cada archivo la fija CLAUDE.md §6: la ruta empieza por la Organización, y
   la política del depósito lo exige. Acá vive escrita una sola vez la parte que se repetía. */

/** Los tres tipos que aceptan todas las rutas que reciben archivos. */
const EXTENSIONES = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg' };

/**
 * La extensión que le corresponde a un archivo por su tipo.
 *
 * Cae en `jpg` ante cualquier tipo que no conozca, que es lo que hacían las cinco copias: quién
 * entra y quién no ya lo decidió el filtro de la subida, así que acá no vuelve a decidirse.
 */
export function extensionDeArchivo(mimetype) {
  return EXTENSIONES[mimetype] ?? 'jpg';
}

/** La carpeta donde viven las Matrículas de un Asistente. Termina en barra a propósito. */
export function carpetaDeMatriculas(prestadoraId, asistenteId) {
  return `${prestadoraId}/matriculas/${asistenteId}/`;
}

/** El nombre completo con el que se guarda una Matrícula nueva. */
export function rutaDeMatriculaNueva(prestadoraId, asistenteId, extension) {
  return `${carpetaDeMatriculas(prestadoraId, asistenteId)}matricula-${Date.now()}.${extension}`;
}

/**
 * ¿Esta ruta es la de una Matrícula de este Asistente, de esta Prestadora?
 *
 * Es lo que decide si se firma o no el enlace para ver el archivo, así que **falla cerrado**: si
 * falta cualquiera de los dos identificadores, la respuesta es que no. Sin ese corte, un
 * identificador vacío arma la carpeta `undefined/matriculas/undefined/` y la comparación pasaría
 * a depender de que nadie guarde nunca un archivo con ese nombre.
 *
 * Se compara el comienzo entero —Prestadora incluida— y se exige que lo que sigue sea un nombre
 * de archivo y nada más. Hasta el 2026-09-05 esto se comprobaba buscando `/matriculas/<id>/` en
 * cualquier parte del texto: la Prestadora no entraba en la cuenta y lo que venía después
 * tampoco, así que la forma de la ruta la terminaba de decidir quien mandaba el pedido.
 */
export function esRutaDeMatriculaDe(ruta, prestadoraId, asistenteId) {
  if (typeof ruta !== 'string' || !prestadoraId || !asistenteId) return false;

  const carpeta = carpetaDeMatriculas(prestadoraId, asistenteId);
  if (!ruta.startsWith(carpeta)) return false;

  const nombre = ruta.slice(carpeta.length);
  return nombre.length > 0 && !nombre.includes('/') && nombre !== '.' && nombre !== '..';
}
