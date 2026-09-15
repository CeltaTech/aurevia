import { llamadorDe } from './apiPanel';
import { nombreDeArchivo } from './documentosDeCese';

/* Lo que se generó queda guardado, no sólo bajado.
   ==========================================================================

   El PDF lo arma el navegador y se lo lleva quien apretó el botón. Eso solo no alcanza: un mes
   después nadie puede decir qué documento se le entregó a esa persona, y volver a apretar el botón
   no devuelve el mismo papel, porque el cálculo se rehace con las escalas vigentes hoy. Entonces
   el mismo archivo que se baja sube al motor, que lo guarda en un depósito privado y lo anota en
   `ceses.documentos_generados` (`backend/src/routes/panelCeses.js`).

   POR QUÉ NO SUBE DERECHO AL DEPÓSITO. Ese depósito no tiene políticas y nadie lo alcanza con su
   propio pase: adentro hay documentos de baja con nombre, documento y montos. Lo escribe y lo lee
   el motor con la llave maestra, después de comprobar de qué Prestadora es el cese. */

const llamarApiCeses = llamadorDe('/ceses');

/**
 * Baja el documento y lo deja guardado, en ese orden.
 *
 * Primero la descarga, porque es lo que la persona está esperando y no depende de la red; recién
 * después la copia. Si la copia falla se levanta el error, y la pantalla lo dice: el documento ya
 * está en la máquina de quien lo pidió, pero no quedó guardado, y eso no se puede tapar.
 *
 * @param {object} doc  El documento de jsPDF ya armado.
 * @param {{ceseId: string, tipo: string, persona?: string, fecha?: string}} datos
 */
export async function bajarYGuardarDocumentoDeCese(doc, { ceseId, tipo, persona, fecha }) {
  doc.save(nombreDeArchivo(tipo, { persona, fecha }));

  const cuerpo = new FormData();
  cuerpo.append('tipo', tipo);
  // El tercer argumento es el nombre con el que viaja el archivo adentro del pedido. Es el que va
  // a quedar en el registro del servidor si algo falla, así que no lleva el nombre de nadie: lo
  // guardado se nombra por su función (`../../../CLAUDE.md` §8).
  cuerpo.append('archivo', doc.output('blob'), `${tipo}.pdf`);

  return llamarApiCeses(`/${ceseId}/documento`, { method: 'POST', body: cuerpo });
}

/** La dirección firmada, con vencimiento, para volver a ver el documento que quedó guardado. */
export async function verDocumentoGuardado(ceseId, tipo) {
  const { url } = await llamarApiCeses(`/${ceseId}/documento-url?tipo=${encodeURIComponent(tipo)}`);
  return url;
}
