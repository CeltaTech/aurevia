import { llamarApiPanel } from './apiPanel.js';

// Punto único del lado del Panel para avisar que una o varias guardias cambiaron de Asistente.
//
// El Panel no puede mandar el aviso: escribe la guardia contra la base, pero no tiene push, ni
// WhatsApp, ni correo. Los tres viven en el motor, así que acá sólo se le pide.
//
// **El aviso nunca voltea la operación.** Cuando se llega a esta función la guardia ya cambió de
// manos: contestar un error haría que la pantalla muestre como fallido algo que salió bien. Si el
// pedido no sale, queda en la consola y la reasignación sigue en pie.
//
// Se llama desde los tres lugares donde una guardia cambia de Asistente: `reasignarGuardia.js`,
// `moverGuardia.js` en la vista por Asistente, y la asignación de cobertura de una ausencia.
export async function avisarCambioDeAsistente({ guardiaIds, asistenteNuevoId, asistenteAnteriorId = null }) {
  if (!guardiaIds?.length || !asistenteNuevoId) return;

  try {
    await llamarApiPanel('/guardias/aviso-cambio-asistente', {
      method: 'POST',
      body: JSON.stringify({
        guardia_ids: guardiaIds,
        asistente_nuevo_id: asistenteNuevoId,
        asistente_anterior_id: asistenteAnteriorId,
      }),
    });
  } catch (e) {
    console.error('No se pudo avisar el cambio de Asistente:', e);
  }
}
