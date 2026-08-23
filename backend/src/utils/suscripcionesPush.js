import { supabase } from '../db/connection.js';

// Guarda la suscripción de avisos de un aparato, y deja rastro si esa suscripción cambia de dueño.
//
// Escrito una sola vez porque lo usan las dos aplicaciones —la del Asistente y la de la Familia—
// con el mismo contrato y la misma tabla (regla 12 de CLAUDE.md §7). Tenerlo dos veces es cómo se
// arregla una sola de las dos.
//
// **Por qué existe el rastro.** La dirección de entrega que emite el navegador es
// única en toda la tabla, sin condición de Prestadora: quien la mande con sus propias claves se
// queda con la fila, y el aparato de la otra persona deja de mostrar sus avisos —el motor le sigue
// mandando mensajes, cifrados con claves que ese navegador no tiene—. No se prohíbe porque el caso
// legítimo es idéntico: cuando dos personas comparten un teléfono, la dirección es la misma y
// pisarla es lo correcto. Lo que se hace es anotarlo, para poder explicar después por qué alguien
// dejó de recibir avisos. El porqué completo está en la migración
// supabase/migrations/20260823020000_un_cambio_de_dueno_de_una_suscripcion_de_avisos_queda_anotado.sql
//
// `rol` es 'asistente' o 'familia'. Devuelve `{ error }`: el llamador decide qué contestar.
export async function guardarSuscripcionPush({ prestadoraId, rol, usuarioId, endpoint, keys, userAgent }) {
  const columna = rol === 'asistente' ? 'asistente_id' : 'familia_id';

  const { data: anterior, error: errorAnterior } = await supabase
    .from('push_subscriptions')
    .select('id, prestadora_id, asistente_id, familia_id')
    .eq('endpoint', endpoint)
    .maybeSingle();
  if (errorAnterior) return { error: errorAnterior };

  // Se manda solamente la columna de la audiencia propia, nunca la otra en nulo. Es a propósito:
  // dejando la otra como está, un intento de quedarse con la suscripción de la audiencia contraria
  // choca contra el CHECK `push_subscriptions_una_audiencia` y no llega a escribirse. Mandarla en
  // nulo "para dejar la fila prolija" abriría un camino que hoy la base cierra sola.
  const fila = {
    prestadora_id: prestadoraId,
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: userAgent || null,
  };
  fila[columna] = usuarioId;

  const { data: guardada, error } = await supabase
    .from('push_subscriptions')
    .upsert(fila, { onConflict: 'endpoint' })
    .select('id')
    .single();
  if (error) return { error };

  const duenoAnterior = anterior?.asistente_id ?? anterior?.familia_id ?? null;
  if (duenoAnterior && duenoAnterior !== usuarioId) {
    const { error: errorRastro } = await supabase.from('auditoria_cambio_dueno_push').insert({
      suscripcion_id: guardada.id,
      prestadora_anterior: anterior.prestadora_id,
      prestadora_nueva: prestadoraId,
      usuario_anterior: duenoAnterior,
      usuario_nuevo: usuarioId,
      rol_anterior: anterior.asistente_id ? 'asistente' : 'familia',
      rol_nuevo: rol,
      user_agent: userAgent || null,
    });
    // Si falla la anotación, la suscripción ya quedó guardada y el aparato va a recibir avisos: no
    // se le devuelve un error a quien acaba de suscribirse por algo que no puede resolver. Queda en
    // el registro del servidor, que es donde alguien lo va a ir a buscar. Se anotan identificadores,
    // nunca la dirección de entrega ni el correo de nadie (CLAUDE.md §6).
    if (errorRastro) {
      console.error(
        'No se pudo anotar el cambio de dueño de una suscripción de avisos',
        guardada.id,
        errorRastro.message,
      );
    }
  }

  return { error: null };
}
