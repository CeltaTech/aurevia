import { supabase } from './supabaseClient';

/* Mover una guardia de la fila de un Paciente a la de otro, en la vista por Paciente.
   =========================================================================================

   POR QUÉ ESTO NECESITA SU PROPIO ARCHIVO. Antes una guardia tenía un solo Paciente, así que
   arrastrarla de una fila a otra era escribir una columna: `paciente_id = el nuevo`. Ahora una
   guardia puede cubrir a varios, y "moverla" ya no quiere decir eso.

   Lo que quiere decir es preciso: en ESA fila deja de aparecer y en la otra empieza a
   aparecer. Los demás Pacientes del turno no se tocan. Si un turno cubre a Alberto y a Elena y
   alguien arrastra el turno de la fila de Elena a la de Héctor, queda cubriendo a Alberto y a
   Héctor — Alberto se queda donde estaba, porque nadie lo movió.

   Y hay una trampa que hace falta esquivar. La columna vieja `guardias.paciente_id` guarda a
   UNO solo de los Pacientes, y un disparador de la base la mantiene sincronizada con la lista.
   Si se escribiera esa columna sin mirar a quién se está moviendo, el disparador sacaría de la
   lista al Paciente que figura ahí, que casi nunca es el que se arrastró. Por eso acá se
   distingue el caso: si el que se mueve es justo el de la columna vieja, se cambia la columna y
   el disparador hace el resto; si es cualquier otro, se toca la lista y la columna no.

   Ver `lib/pacientesDeGuardia.js` y la migración
   20260807190000_una_guardia_puede_cubrir_varios_pacientes.sql. */

/**
 * @param {object} guardia  La guardia entera, ya enriquecida por `conPacientes` — hacen falta
 *                          `paciente_id` (el de la columna vieja) y `prestadora_id`.
 * @param {string} pacienteOrigen  De qué fila se la sacó. Puede no ser un Paciente real: si se
 *                          arrastra desde la fila de "sin Paciente", acá llega esa marca y no
 *                          hay nada que sacar.
 * @param {string} pacienteDestino  A qué fila se la llevó.
 * @returns {Promise<{ error: string | null }>} El motivo si algo falló, o null si salió todo.
 */
export async function cambiarPacienteDeGuardia(guardia, pacienteOrigen, pacienteDestino) {
  if (!guardia?.id || !pacienteDestino) return { error: null };
  if (pacienteOrigen === pacienteDestino) return { error: null };

  const esElDeLaColumnaVieja = !guardia.paciente_id || guardia.paciente_id === pacienteOrigen;

  if (esElDeLaColumnaVieja) {
    const { error } = await supabase
      .from('guardias')
      .update({ paciente_id: pacienteDestino })
      .eq('id', guardia.id);
    return { error: error ? error.message : null };
  }

  // Primero se agrega y después se saca. Al revés, un corte de conexión en el medio dejaría la
  // guardia con un Paciente menos y ninguno nuevo; así, en el peor caso queda con los dos, que
  // se ve raro pero no pierde a nadie.
  const { error: errorAlta } = await supabase
    .from('guardia_pacientes')
    .upsert(
      { guardia_id: guardia.id, paciente_id: pacienteDestino, prestadora_id: guardia.prestadora_id },
      { onConflict: 'guardia_id,paciente_id', ignoreDuplicates: true }
    );
  if (errorAlta) return { error: errorAlta.message };

  const { error: errorBaja } = await supabase
    .from('guardia_pacientes')
    .delete()
    .eq('guardia_id', guardia.id)
    .eq('paciente_id', pacienteOrigen);
  if (errorBaja) return { error: errorBaja.message };

  return { error: null };
}
