import { llamadorDe } from './apiPanel';

/* Las dos fotos de la verificación de identidad van y vuelven por el motor.
   ==========================================================================

   El depósito `fotos-identidad` no tiene políticas y nadie lo alcanza con su propio pase: adentro
   hay imágenes de documentos de identidad. Lo escribe y lo lee el motor con la llave maestra,
   después de comprobar de qué Prestadora es el Asistente
   (`backend/src/routes/panelVerificacionIdentidad.js`). */

const llamarApi = llamadorDe('/verificacion-identidad');

/** Sube una de las dos fotos. Si ya había una de ese tipo, la reemplaza. */
export async function subirFotoDeIdentidad(asistenteId, tipo, archivo) {
  const cuerpo = new FormData();
  cuerpo.append('tipo', tipo);
  // El tercer argumento es el nombre con el que viaja el archivo adentro del pedido, y es el que
  // queda en el registro del servidor si algo falla: va el tipo y no el nombre que le puso quien
  // sacó la foto, que puede llevar adentro el nombre de la persona.
  cuerpo.append('archivo', archivo, tipo);

  return llamarApi(`/${asistenteId}/foto`, { method: 'POST', body: cuerpo });
}

/**
 * Las direcciones firmadas, con vencimiento, para ver las fotos que haya cargadas.
 *
 * Devuelve las dos claves siempre, con `null` en la que todavía no se subió: así la pantalla
 * distingue «no hay foto» de «no se pudo pedir», que no se muestran igual.
 */
export async function verFotosDeIdentidad(asistenteId) {
  const { fotos } = await llamarApi(`/${asistenteId}/fotos`);
  return fotos;
}
