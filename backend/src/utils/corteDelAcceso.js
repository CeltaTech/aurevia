/* El corte de un acceso del Marketplace al que se le terminó el período pagado.
   =============================================================================

   QUÉ RESUELVE. Darse de baja apaga la renovación y nada más: el acceso sigue `vigente` y
   `vigente_hasta` dice hasta cuándo alcanza lo que ya se pagó (`bajaDelAcceso.js`). Eso deja algo
   sin hacer, y hasta acá no lo hacía nadie: llegada esa fecha, el acceso tenía que apagarse. Sin
   este trabajo, quien se dio de baja en enero seguía figurando `vigente` para siempre —sin pagar—,
   y la Prestadora no podía ni apagar la modalidad, porque lo que se lo impide es justamente que
   queden accesos vigentes (`routes/panelConfiguracion.js`).

   POR QUÉ EL CORTE VIVE APARTE DE LA BAJA. Son dos momentos, no dos partes de uno. La baja es una
   decisión de una persona, en un instante; el corte es el paso del tiempo, y ocurre meses después
   sin que nadie toque nada. Escribirlo adentro de la baja obligaría a que la baja adivinara el
   futuro, o a cortar en el acto, que es exactamente lo que el §3.2 del
   `docs/PRD_07_Modalidad_Marketplace.md` no admite: «quien cancela conserva el acceso hasta el fin
   del período ya pagado. No hay corte inmediato».

   ACÁ SÓLO SE CORTA LO QUE SE DIO DE BAJA. Un acceso que no se dio de baja y al que se le pasó la
   fecha no está terminado: está esperando que entre un cobro. De ése se ocupa `periodoDeGracia.js`,
   que le da unos días y lo suspende recién si para entonces el cobro no entró. Son dos finales
   distintos —uno lo pidió una persona y el otro es una deuda— y por eso no dejan el acceso en el
   mismo estado.

   CUÁNDO SE CORTA. `vigente_hasta` es la fecha del cobro que no se va a hacer, o sea el primer día
   que ya no está pagado: se corta cuando llega, no al día siguiente. Si no hay ninguna fecha
   —alguien que se dio de baja antes de que se le cobrara una sola vez— no hay período pagado que
   conservar, y el corte es inmediato.

   Y UN CORTE QUE FALLA NO CORTA A LOS DEMÁS. Se recorre acceso por acceso y una falla se anota y
   sigue: lo de una Prestadora no puede dejar sin cortar a las otras, que es el mismo criterio de
   `revisarVencimientos` y del armado de cobros. Lo que no se cortó hoy se corta mañana, porque la
   condición que lo elige no se apaga sola. */

import { supabase } from '../db/connection.js';

/**
 * Apaga los accesos dados de baja a los que ya se les terminó el período pagado. Corre una vez por
 * día (`backend/src/server.js`): la fecha se mide en días, no en horas.
 *
 * @returns {Promise<{ cortados: number }>} Cuántos se apagaron. Lo usa la prueba; el trabajo diario
 *   no mira el número.
 */
export async function cortarLosAccesosDadosDeBaja() {
  const hoy = new Date().toISOString().slice(0, 10);

  const { data: accesos, error } = await supabase
    .from('accesos_marketplace')
    .select('id, vigente_hasta, gratis_hasta')
    .eq('estado', 'vigente')
    .not('cancelada_en', 'is', null);

  if (error) {
    console.error('Error consultando los accesos dados de baja:', error.message);
    return { cortados: 0 };
  }

  // La fecha sale de una de dos columnas, así que la comparación se hace acá y no en la consulta.
  // Es barato: lo que se trae son los accesos dados de baja que todavía no se cortaron, que son
  // los que se dieron de baja desde el último corte y ni uno más.
  const vencidos = (accesos ?? []).filter((acceso) => {
    const hasta = acceso.vigente_hasta || acceso.gratis_hasta;
    return !hasta || hasta <= hoy;
  });

  let cortados = 0;
  for (const acceso of vencidos) {
    const { error: errorCorte } = await supabase
      .from('accesos_marketplace')
      .update({ estado: 'cancelada', updated_at: new Date().toISOString() })
      .eq('id', acceso.id)
      // Nadie más lo tocó mientras tanto. Si entre la consulta y el guardado entró un cobro, el
      // acceso ya no está dado de baja y cortarlo le sacaría un período que alguien pagó.
      .eq('estado', 'vigente')
      .not('cancelada_en', 'is', null);

    if (errorCorte) {
      // Sin el identificador de la Familia ni el texto crudo de la base (`celtatech\CLAUDE.md` §6).
      console.error('No se pudo cortar un acceso dado de baja:', errorCorte.message);
      continue;
    }
    cortados += 1;
  }

  return { cortados };
}
