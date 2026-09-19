import { supabase } from './supabaseClient';

/**
 * Los papeles del legajo del Asistente: dónde se guardan y cómo se vuelven a mirar.
 *
 * LA RUTA EMPIEZA POR LA PRESTADORA. Es `<prestadora>/<asistente>/<identificador>.<extensión>`, y
 * la política del depósito exige la primera carpeta. Empezando por la cuenta, el día que una misma
 * cuenta tenga legajo en dos Prestadoras las dos verían la misma carpeta.
 *
 * EL IDENTIFICADOR ES ÚNICO POR ARCHIVO, y por eso volver a presentar un papel no pisa el anterior.
 * El renglón de `documentos_asistente` apunta al último con su columna `ruta_archivo`; adivinando
 * el nombre no se llega a ninguno.
 *
 * LA DIRECCIÓN PARA MIRARLO SE FIRMA Y VENCE. El depósito es privado: no hay dirección pública, y
 * la firmada dura lo que dura una mirada.
 */

export const DEPOSITO = 'documentos-asistente';

// El mismo par que acota el depósito en la base. Acá está para avisar antes de que el archivo
// viaje; quien decide es la base.
export const TIPOS_ACEPTADOS = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic'];
export const TAMANO_MAXIMO = 10 * 1024 * 1024;

const SEGUNDOS_DE_LA_DIRECCION_FIRMADA = 60;

function extensionDe(nombre) {
  const punto = String(nombre ?? '').lastIndexOf('.');
  if (punto <= 0) return '';
  const extension = nombre.slice(punto + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(extension) ? `.${extension}` : '';
}

export function rutaDelPapel({ prestadoraId, asistenteId, nombreOriginal }) {
  return `${prestadoraId}/${asistenteId}/${crypto.randomUUID()}${extensionDe(nombreOriginal)}`;
}

/** Sube el papel y devuelve la ruta donde quedó, o `null` si no se pudo. */
export async function subirPapel({ prestadoraId, asistenteId, archivo }) {
  const ruta = rutaDelPapel({ prestadoraId, asistenteId, nombreOriginal: archivo.name });
  const { error } = await supabase.storage.from(DEPOSITO).upload(ruta, archivo, {
    contentType: archivo.type,
    upsert: false,
  });
  return error ? null : ruta;
}

/** Devuelve una dirección firmada para mirar el papel, o `null` si no se pudo. */
export async function direccionParaMirar(ruta) {
  if (!ruta) return null;
  const { data, error } = await supabase.storage
    .from(DEPOSITO)
    .createSignedUrl(ruta, SEGUNDOS_DE_LA_DIRECCION_FIRMADA);
  return error ? null : data.signedUrl;
}
