import { llamadorDe } from './apiPanel';

/* Las referencias laborales van y vuelven por el motor.
   ==========================================================================

   No porque la tabla esté cerrada —tiene su política y el Panel la alcanzaría con el pase de la
   persona—, sino porque quién verificó y cuándo no los puede escribir la pantalla: son la firma de
   esa verificación, y el servidor es el único que sabe con certeza quién está del otro lado
   (`backend/src/routes/panelReferenciasLaborales.js`). Lo mismo vale para el mínimo, que sale de
   la configuración de la Prestadora y se cuenta del lado del motor. */

const llamarApi = llamadorDe('/referencias-laborales');

/**
 * Las referencias de este Asistente, y cómo están respecto de lo que su Prestadora espera.
 *
 * Vuelve siempre la lista más la cuenta: cuántas verificadas hay, cuántas se exigen y cuántas
 * faltan. La pantalla no rehace esa cuenta.
 */
export async function verReferenciasLaborales(asistenteId) {
  return llamarApi(`/${asistenteId}`);
}

/** Una referencia cargada a mano, para quien entró sin postulación. */
export async function agregarReferenciaLaboral(asistenteId, { nombre, telefono, vinculo }) {
  return llamarApi(`/${asistenteId}`, {
    method: 'POST',
    body: JSON.stringify({ nombre, telefono, vinculo }),
  });
}

/** Lo que quedó de haber llamado: qué contestaron y qué se anotó. */
export async function anotarResultadoDeReferencia(asistenteId, referenciaId, { resultado, notas }) {
  return llamarApi(`/${asistenteId}/${referenciaId}`, {
    method: 'PATCH',
    body: JSON.stringify({ resultado, notas }),
  });
}
