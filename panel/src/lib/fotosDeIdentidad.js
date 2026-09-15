/* Las dos fotos con las que se verifica la identidad de un Asistente.
   ==========================================================================

   QUÉ SON. La etapa de verificación de identidad del Proceso de Incorporación de Asistentes
   compara la foto del documento con la foto de la persona (`docs/PRD_03_Reclutamiento.md`). Hasta
   ahora no había ningún lado donde guardarlas: quien revisaba las recibía por fuera del producto
   —por correo, por mensaje— y marcaba la etapa a mano.

   POR QUÉ NO CUELGAN DE UNA ETAPA. Cada Prestadora define las etapas de su propio proceso y
   elige sus claves (`etapas_incorporacion_asistente`, Configuración > El cuidado), así que
   ninguna clave de etapa es la misma en dos Prestadoras y no hay ninguna que el código pueda
   nombrar. Las dos fotos son de la persona, no de una etapa: cuelgan del Asistente.

   POR QUÉ TAMPOCO SON UN DOCUMENTO DEL LEGAJO. `documentos_asistente` lleva los que vencen y hay
   que renovar —monotributo, seguro, antecedentes—, con un catálogo de tipos que también arma cada
   Prestadora. Estas dos no vencen ni se renuevan: se sacan una vez, al incorporarse.

   ESTE ARCHIVO SE COPIA AL MOTOR (`scripts/copias_entre_apps.mjs`) y no importa nada. La pantalla
   necesita saber qué formatos ofrecer y qué fotos mostrar; el motor, qué acepta y dónde lo guarda.
   Escrito de los dos lados, alcanza una letra de diferencia para que la foto se guarde en un lado
   y se busque en otro. */

/* Las dos, nombradas de a una: son a la vez el nombre del archivo adentro del depósito y lo que
   la pantalla le manda al motor. Se nombran por lo que son y no se renombran (`CLAUDE.md` §8). */
export const TIPO_DOCUMENTO = 'documento';
export const TIPO_PERFIL = 'perfil';

export const FOTOS_DE_IDENTIDAD = [TIPO_DOCUMENTO, TIPO_PERFIL];

/** ¿Este tipo es una de las dos? Falla cerrado: lo que no está en la lista, no entra. */
export function esFotoDeIdentidad(tipo) {
  return FOTOS_DE_IDENTIDAD.includes(tipo);
}

/* Qué se acepta subir. Dos formatos de imagen y nada más: un PDF o un documento de texto no se
   pueden poner uno al lado del otro para compararlos, que es lo único que estas fotos sirven
   para hacer. El tope es el mismo que el de los documentos del cese; una foto sacada con un
   teléfono de hoy entra holgada. */
export const FORMATOS_DE_FOTO = ['image/jpeg', 'image/png'];
export const TAMANO_MAXIMO_DE_FOTO = 5 * 1024 * 1024;

/**
 * Dónde vive la foto adentro del depósito `fotos-identidad`.
 *
 * Empieza por la Prestadora, como la ruta de todos los depósitos (`CLAUDE.md` §6), y no lleva
 * adentro el nombre de nadie ni su documento: eso es dato del legajo y no tiene por qué quedar
 * escrito en la ruta de un archivo.
 *
 * Va sin extensión a propósito. La ruta se arma con estos tres datos cada vez que hay que buscar
 * una foto, así que tiene que dar siempre lo mismo; con extensión habría que guardar aparte cuál
 * le tocó a cada una, y una foto subida como JPEG y buscada como PNG no aparece. El formato viaja
 * en el tipo de contenido, que es donde la plataforma lo espera.
 */
export function rutaEnElDeposito(prestadoraId, asistenteId, tipo) {
  return `${prestadoraId}/${asistenteId}/${tipo}`;
}
