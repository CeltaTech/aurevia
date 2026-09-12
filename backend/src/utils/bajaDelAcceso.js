/* El único lugar por donde un acceso del Marketplace se da de baja.
   =================================================================

   QUÉ RESUELVE. Hasta acá un acceso se daba de alta y se cobraba, y darlo de baja no existía en
   ninguna parte: la columna `cancelada_en` estaba en la tabla y no la escribía nadie. Quien quería
   dejar de pagar tenía que pedírselo a la Prestadora. Eso es exactamente lo que el §3.2 del
   `docs/PRD_07_Modalidad_Marketplace.md` no admite: la baja la hace quien paga, sola, en un clic.

   DARSE DE BAJA NO ES QUEDARSE SIN ACCESO. Son dos cosas distintas y acá pasa una sola. Lo que la
   baja apaga es la renovación: `proximo_cobro` queda en nulo y el riel deja de cobrar. Lo que ya
   está pagado se conserva hasta el final —«quien cancela conserva el acceso hasta el fin del
   período ya pagado. No hay corte inmediato»—, así que `estado` sigue en `vigente` y
   `vigente_hasta` no se toca. Cortar al llegar esa fecha es de otro archivo: nadie cobra dos veces
   por la misma decisión.

   PRIMERO EL RIEL, DESPUÉS LA BASE. Si se anotara la baja de este lado y la llamada al proveedor
   fallara, quedaría alguien dado de baja acá y cobrado allá todos los meses. Al revés no: si el
   proveedor cancela y la base no llega a guardar, el peor caso es un acceso que ya no se cobra y
   que todavía se ve activo, y el próximo intento lo arregla. Por eso el orden es ése y por eso una
   falla del proveedor corta sin escribir nada.

   SÓLO SE DA DE BAJA LO QUE SE RENUEVA SOLO. Los cuatro resguardos del §3.2 valen para las formas
   de cobro que se renuevan solas, y son las únicas que tienen algo que apagar. Un paquete se pagó
   una vez y lo que lo sostiene es su saldo: no hay renovación que cancelar, y ofrecer una baja que
   no hace nada sería peor que no ofrecerla.

   NO SE DA DE BAJA DOS VECES. `cancelada_en` es la marca. Con esa fecha puesta se contesta lo
   guardado y no se llama al proveedor: un segundo clic sobre el mismo botón —o sobre el botón que
   quedó en una pantalla vieja— no tiene que volver a salir hacia afuera. */

import { supabase } from '../db/connection.js';
import { obtenerAdaptador } from '../pasarelas/index.js';

/** Los motivos por los que una baja no se puede hacer. Son códigos, no frases: la frase que lee la
 *  persona vive en las traducciones, en los tres idiomas
 *  (`celtatech\CLAUDE.md` §8, «un mensaje de error es texto visible»). */
export const MOTIVO_BAJA = {
  ACCESO_INEXISTENTE: 'acceso_inexistente',
  FORMA_QUE_NO_SE_RENUEVA: 'forma_que_no_se_renueva',
  PROVEEDOR_DESCONOCIDO: 'proveedor_desconocido',
  SIN_CREDENCIAL: 'sin_credencial',
  PROVEEDOR_RECHAZO: 'proveedor_rechazo',
  NO_SE_PUDO_GUARDAR: 'no_se_pudo_guardar',
};

/**
 * Da de baja un acceso del Marketplace: apaga la renovación y deja el período pagado en pie.
 *
 * @param {object} argumentos
 * @param {string} argumentos.accesoId      Cuál acceso.
 * @param {string} [argumentos.familiaId]   Quién lo da de baja, cuando lo hace la Familia desde su
 *                                          aplicación. Se comprueba contra la fila.
 * @param {string} [argumentos.prestadoraId] De qué Prestadora, cuando la baja entra por el Panel.
 * @returns {Promise<{ok: boolean, motivo?: string, detalle?: string, baja?: object,
 *                    yaEstaba?: boolean}>}
 */
export async function darDeBajaElAcceso({ accesoId, familiaId = null, prestadoraId = null }) {
  let consulta = supabase
    .from('accesos_marketplace')
    .select(
      'id, prestadora_id, familia_id, estado, proveedor, referencia_externa, alta_en_pasarela, ' +
        'cancelada_en, vigente_hasta, proximo_cobro, gratis_hasta, ' +
        'formas_de_cobro_marketplace(renueva_sola)'
    )
    .eq('id', accesoId);

  // El alcance lo pone quien llama y no se resuelve acá: una Familia sólo puede dar de baja lo
  // suyo, y el Panel sólo lo de su Prestadora. Sin ninguno de los dos no se sigue: una baja sin
  // alcance daría de baja el acceso de cualquiera con sólo saber su identificador.
  if (familiaId) consulta = consulta.eq('familia_id', familiaId);
  if (prestadoraId) consulta = consulta.eq('prestadora_id', prestadoraId);
  if (!familiaId && !prestadoraId) {
    return { ok: false, motivo: MOTIVO_BAJA.ACCESO_INEXISTENTE };
  }

  const { data: acceso, error: errorAcceso } = await consulta.maybeSingle();

  if (errorAcceso) {
    return { ok: false, motivo: MOTIVO_BAJA.NO_SE_PUDO_GUARDAR, detalle: errorAcceso.message };
  }
  if (!acceso) {
    return { ok: false, motivo: MOTIVO_BAJA.ACCESO_INEXISTENTE };
  }

  // Ya estaba dada de baja. Se contesta lo guardado y no se llama al proveedor.
  if (acceso.cancelada_en) {
    return { ok: true, baja: resumenDeLaBaja(acceso), yaEstaba: true };
  }

  // Una forma que no se renueva sola no tiene renovación que apagar.
  if (!acceso.formas_de_cobro_marketplace?.renueva_sola) {
    return { ok: false, motivo: MOTIVO_BAJA.FORMA_QUE_NO_SE_RENUEVA };
  }

  // Contra el riel sólo se sale si hay algo dado de alta allá. Un acceso que nunca llegó a la
  // pasarela —o que se cobra en mano— se da de baja acá y nada más.
  const hayQueAvisarleAlProveedor =
    Boolean(acceso.alta_en_pasarela) && Boolean(acceso.proveedor) && Boolean(acceso.referencia_externa);

  if (hayQueAvisarleAlProveedor) {
    const corte = await cancelarEnElRiel(acceso);
    if (!corte.ok) return corte;
  }

  const { error: errorGuardar } = await supabase
    .from('accesos_marketplace')
    .update({
      cancelada_en: new Date().toISOString(),
      // Lo único que apaga la baja: no vuelve a cobrarse. El estado y la fecha hasta la que
      // alcanza lo pagado quedan como estaban.
      proximo_cobro: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', acceso.id);

  if (errorGuardar) {
    // Acá la renovación ya quedó apagada del lado del proveedor y sin anotar de este lado. No se
    // cobra de más a nadie, que es lo que importa; lo que queda es un acceso que se ve activo y
    // no se cobra, y el próximo intento lo anota. Se avisa fuerte porque es plata.
    console.error(
      'Acceso cancelado en la pasarela y no guardado en la base:',
      acceso.proveedor,
      acceso.id,
      errorGuardar.message
    );
    return { ok: false, motivo: MOTIVO_BAJA.NO_SE_PUDO_GUARDAR, detalle: errorGuardar.message };
  }

  return { ok: true, baja: resumenDeLaBaja({ ...acceso, cancelada_en: new Date().toISOString() }) };
}

/** Le dice al proveedor que deje de cobrar. Ante cualquier falla no se escribe nada: mejor un
 *  acceso que sigue como estaba y una baja que se puede volver a intentar, que uno dado de baja de
 *  este lado y cobrándose del otro. */
async function cancelarEnElRiel(acceso) {
  let adaptador;
  try {
    adaptador = obtenerAdaptador(acceso.proveedor);
  } catch {
    return { ok: false, motivo: MOTIVO_BAJA.PROVEEDOR_DESCONOCIDO };
  }

  // La credencial sale de la caja fuerte y no sobrevive a esta función. `efectivo_manual` no tiene
  // ninguna, y no la necesita.
  let credencial = null;
  if (acceso.proveedor !== 'efectivo_manual') {
    const { data, error } = await supabase.rpc('leer_credencial_pasarela_pago', {
      p_prestadora_id: acceso.prestadora_id,
      p_proveedor: acceso.proveedor,
    });
    if (error || !data) {
      return { ok: false, motivo: MOTIVO_BAJA.SIN_CREDENCIAL, detalle: error?.message };
    }
    credencial = data;
  }

  try {
    await adaptador.cancelarSuscripcion({ credencial, referenciaExterna: acceso.referencia_externa });
  } catch (falla) {
    // El texto crudo del proveedor queda del lado del servidor: puede nombrar la cuenta, el
    // comercio o la credencial (`celtatech\CLAUDE.md` §6).
    console.error('La pasarela rechazó la baja de un acceso:', acceso.proveedor, falla.message);
    return { ok: false, motivo: MOTIVO_BAJA.PROVEEDOR_RECHAZO };
  }

  return { ok: true };
}

/** Lo que se le devuelve a quien llamó: cuándo se dio de baja y hasta cuándo sigue alcanzando lo
 *  que ya pagó. Nunca la credencial ni nada que venga de la caja fuerte. */
function resumenDeLaBaja(acceso) {
  return {
    cancelada_en: acceso.cancelada_en,
    // Hasta cuándo conserva el acceso. Mientras no se cobró ningún período, lo que lo sostiene es
    // el período gratuito, y esa es la fecha que hay que mostrar.
    vigente_hasta: acceso.vigente_hasta || acceso.gratis_hasta || null,
    estado: acceso.estado,
  };
}
