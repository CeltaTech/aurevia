import { supabase } from './supabaseClient';

/* Cambiarle el Asistente a una guardia: un solo lugar para las tres cosas que hay que hacer.
   =========================================================================================

   POR QUÉ ESTÁ ACÁ Y NO DENTRO DE UNA PANTALLA. Asignarle un Asistente a una guardia no es
   escribir una columna: son tres cosas que van juntas y ninguna se puede olvidar.

     1. Se guarda el Asistente nuevo y la fecha.
     2. Si la guardia estaba publicada como disponible, deja de estarlo. No es prolijidad: la
        base tiene una restricción que no permite que una guardia con Asistente siga ofrecida,
        así que sin este paso la asignación entera falla.
     3. Si la guardia estaba marcada como ausente, había un incidente de relevo abierto por
        ella. Asignar a alguien la cubre de verdad, así que ese incidente se cierra acá. Si no,
        el aviso de "necesita relevo" sigue encendido aunque el Paciente ya tenga quien lo
        cuide, y alguien va a salir a resolver un problema que ya no existe.

   Dos pantallas hacen esta misma operación —la de Guardias y el mostrador—, así que las tres
   cosas se escriben una sola vez y las dos la llaman (regla 12 de CLAUDE.md §7). Si mañana
   aparece un cuarto paso, se agrega acá y las dos pantallas lo tienen sin tocarlas. */

/**
 * @param {object} guardia  La guardia entera, como está hoy — hace falta para saber si estaba
 *                          ofrecida y si estaba ausente. Con el id solo no alcanzaría.
 * @param {string} asistenteId  Quién pasa a hacerla.
 * @param {string} fecha  En qué fecha queda. Puede ser la misma que ya tenía.
 * @returns {Promise<{ error: string | null }>} El motivo si algo falló, o null si salió todo.
 */
export async function reasignarGuardia(guardia, asistenteId, fecha) {
  const estabaSinCobertura = guardia?.estado === 'ausente';

  const cambios = { asistente_id: asistenteId, fecha };
  if (estabaSinCobertura) cambios.estado = 'programada';
  if (guardia?.ofrecida_at) {
    cambios.ofrecida_at = null;
    cambios.ofrecida_por = null;
    cambios.oferta_limite_at = null;
  }

  const { error: errorUpdate } = await supabase.from('guardias').update(cambios).eq('id', guardia.id);
  if (errorUpdate) return { error: errorUpdate.message };

  if (estabaSinCobertura) {
    const { error: errorIncidente } = await supabase
      .from('incidentes_relevo')
      .update({
        resuelto_at: new Date().toISOString(),
        resuelto_por_tipo: 'suplente',
        resuelto_por_id: asistenteId,
      })
      .eq('guardia_entrante_id', guardia.id)
      .is('resuelto_at', null);
    if (errorIncidente) return { error: errorIncidente.message };
  }

  return { error: null };
}
