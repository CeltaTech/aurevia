import { supabase } from '../db/connection.js';

/* Cubrir una guardia con un sustituto: el turno pasa a nombre de quien lo hace
   ==========================================================================

   QUÉ HACE Y POR QUÉ ACÁ. Cuando quien tenía la guardia falta y se manda a otro, el turno sigue
   siendo uno solo y con una sola persona: la que lo hace. La guardia pasa a nombre del sustituto,
   y con ella sus entradas y salidas, que son las suyas. Lo que queda escrito aparte es a quién le
   tocaba y por qué lo terminó haciendo otro: eso es la fila de `guardias_cobertura`.

   QUE EL TITULAR FALTÓ NO SE ESCRIBE ACÁ. Eso es su ausencia, que ya está cargada en `ausencias`
   con su justificación y su certificado, y es lo que se ve en su legajo.

   Antes el Panel anotaba al sustituto en `guardias_cobertura` y dejaba la guardia a nombre del que
   faltó. La aplicación del Asistente lista por `guardias.asistente_id`, así que el sustituto no la
   veía y no la podía fichar, y el ausente la seguía viendo como suya.

   POR QUÉ ESTO DEJA BIEN LO QUE SE PAGA. La liquidación agrupa por Asistente y paga con el valor
   de cada uno —`routes/panelLiquidaciones.js`—. Con la guardia a nombre del sustituto, la cobra
   él, con su propio valor, que puede no ser el del titular; y al titular ese turno no le suma
   nada. Lo que se informa al financiador tampoco cambia: sigue siendo un turno, contado una vez.

   POR QUÉ ESTO NO ABRE UN INCIDENTE DE RELEVO, y `marcarAusente.js` sí. Ese incidente existe para
   avisar que alguien quedó esperando que lo releven. Acá no quedó nadie esperando: la guardia se
   está cubriendo en el mismo acto. Marcar la ausencia sin sustituto sigue siendo trabajo de
   `marcarAusenteYCrearIncidente`, y no se toca.

   Usa la llave de servicio, que se saltea la protección por fila. El aislamiento lo pone quien
   llama: la ruta busca la guardia acotada a la Organización activa antes de pedir esto. */

/**
 * Anota la sustitución y pasa la guardia a nombre del sustituto.
 *
 * `guardia` tiene que traer la fila entera de la guardia a cubrir.
 *
 * Devuelve `{ ok: true }`, o `{ ok: false, motivo }` con un texto para registrar. No levanta
 * excepciones.
 */
export async function cubrirGuardiaConSustituto({
  guardia,
  asistenteSustitutoId,
  ausenciaId = null,
  motivo = null,
  motivoDetalle = null,
  costoAdicional = null,
}) {
  const prestadoraId = guardia.prestadora_id;

  // La constancia se escribe antes de mover la guardia. Si fallara, el turno queda como estaba y
  // no se perdió nada. Al revés —la guardia ya a nombre del sustituto y sin nadie anotado— se
  // perdería para siempre a quién le tocaba, que es justamente lo que hay que conservar.
  const { error: errorCobertura } = await supabase.from('guardias_cobertura').insert({
    prestadora_id: prestadoraId,
    ausencia_id: ausenciaId,
    guardia_original_id: guardia.id,
    asistente_titular_id: guardia.asistente_id,
    asistente_sustituto_id: asistenteSustitutoId,
    motivo,
    motivo_detalle: motivoDetalle,
    costo_adicional: costoAdicional,
  });
  if (errorCobertura) return { ok: false, motivo: errorCobertura.message };

  // El turno no cambia en nada más: mismo Paciente, mismo día, mismo horario, misma modalidad.
  // Cambia quién lo hace.
  const { error: errorReasignar } = await supabase
    .from('guardias')
    .update({ asistente_id: asistenteSustitutoId })
    .eq('id', guardia.id);
  if (errorReasignar) return { ok: false, motivo: errorReasignar.message };

  return { ok: true };
}
