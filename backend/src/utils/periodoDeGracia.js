/* El período de gracia de un cobro que no entró, y la suspensión cuando se termina.
   =================================================================================

   QUÉ RESUELVE. El §3.2 del `docs/PRD_07_Modalidad_Marketplace.md` pide «período de gracia con
   reintentos antes de suspender el acceso. Ni corte en el acto ni reintentos indefinidos sin
   avisar». Hasta acá el aviso de un cobro fallido dejaba el acceso `vencida` en el acto: una
   tarjeta vencida, un saldo que entraba un día tarde o un aviso repetido del proveedor apagaban el
   acceso el mismo día, sin avisarle a nadie y sin un solo reintento.

   SON DOS MOMENTOS Y ESTÁN LOS DOS ACÁ. Abrir la gracia es un instante —llega el aviso de que el
   cobro falló— y la suspensión es el paso del tiempo, días después, sin que nadie toque nada. Viven
   juntos porque los dos contestan la misma pregunta —qué le pasa a un acceso cuyo cobro no entra— y
   separarlos haría que la fecha la escribiera uno y la leyera otro.

   QUÉ SON LOS REINTENTOS, POR RIEL. Ninguno se agrega acá, porque los dos ya existen y lo único que
   les faltaba era que el acceso siguiera en pie mientras tanto:

     * Los rieles que cobran solos reintentan de su lado y mandan un aviso nuevo por cada intento.
     * Los que hay que armarles el cobro de cada período lo vuelven a armar todos los días mientras
       el cobro de ese período esté fallido y el acceso siga `vigente` (`cobrosMarketplace.js`).

   Y por eso la gracia no se estira con cada aviso: se abre una vez, con la primera falla, y la
   fecha no se mueve. Estirarla a cada reintento sería el «reintentos indefinidos» que el §3.2
   prohíbe — un proveedor que reintenta cada tres días no suspendería nunca.

   SE AVISA AL ABRIRLA, UNA VEZ. La Familia se entera de que el cobro no entró, de hasta cuándo
   tiene para resolverlo y de que después el acceso se suspende. Sale una sola vez sin necesidad de
   marca aparte: el aviso viaja con la apertura, y la apertura sólo ocurre cuando no había ninguna
   gracia abierta.

   LA GRACIA SE CIERRA CUANDO ENTRA LA PLATA, y eso lo hace `registrarCobroExitoso`, que es el único
   lugar que decide qué le pasa a un acceso cuando se cobra (`cobrosMarketplace.js`).

   Y UNA SUSPENSIÓN QUE FALLA NO SUSPENDE A LAS DEMÁS. Mismo criterio que el corte y que el aviso
   previo: se anota y se sigue; lo que no se suspendió hoy se suspende mañana. */

import { supabase } from '../db/connection.js';
import { enviarPushFamilia } from './push.js';
import { sumarDias } from './fechas.js';
import { enDia, importeConMoneda } from './comoSeDiceEnUnAviso.js';

/** Cuántos días dura la gracia. Lo decide este producto y no la Prestadora: es el resguardo del
 *  §3.2, o sea un piso, no una preferencia de cómo trabaja cada una. Siete días cubren el fin de
 *  semana largo y el cambio de tarjeta, y son pocos como para que el acceso no quede meses sin
 *  pagar. Mismo criterio que `DIAS_DE_AVISO_PREVIO` en `avisoPrevioAlCobro.js`. */
const DIAS_DE_GRACIA = 7;

/**
 * Un cobro no entró. Abre la gracia si no había ninguna abierta, y le avisa a la Familia. No
 * suspende nada: de eso se encarga `suspenderLosQueAgotaronLaGracia` cuando llegue la fecha.
 *
 * @param {object} argumentos
 * @param {string} argumentos.accesoId
 * @param {Function} [argumentos.avisar]  Por dónde sale el aviso, por el mismo motivo que en
 *                                        `avisoPrevioAlCobro.js`: `web-push` sólo entrega contra
 *                                        una dirección segura y la prueba necesita poder mirarlo.
 * @returns {Promise<{abierta: boolean, gracia_hasta: string|null}>}
 */
export async function abrirElPeriodoDeGracia({ accesoId, avisar = enviarPushFamilia }) {
  const { data: acceso, error } = await supabase
    .from('accesos_marketplace')
    .select('id, estado, familia_id, paciente_id, importe, moneda, gracia_hasta')
    .eq('id', accesoId)
    .maybeSingle();

  if (error || !acceso) {
    console.error('No se pudo abrir el período de gracia:', error?.message || 'acceso no encontrado');
    return { abierta: false, gracia_hasta: null };
  }

  // Un acceso que ya está suspendido o dado de baja no tiene gracia que abrir: lo que falló no le
  // saca nada que todavía tenga.
  if (acceso.estado !== 'vigente') return { abierta: false, gracia_hasta: null };
  // Ya hay una gracia corriendo. El aviso de este reintento no la mueve ni vuelve a avisar.
  if (acceso.gracia_hasta) return { abierta: false, gracia_hasta: acceso.gracia_hasta };

  const graciaHasta = sumarDias(new Date().toISOString().slice(0, 10), DIAS_DE_GRACIA);

  const { data: guardados, error: errorGuardar } = await supabase
    .from('accesos_marketplace')
    .update({ gracia_hasta: graciaHasta, updated_at: new Date().toISOString() })
    .eq('id', accesoId)
    .eq('estado', 'vigente')
    // Nadie abrió una gracia mientras tanto. Dos avisos de falla que llegan juntos abren una sola,
    // y el que pierde no vuelve a avisar.
    .is('gracia_hasta', null)
    .select('id');

  if (errorGuardar) {
    console.error('No se pudo abrir el período de gracia:', errorGuardar.message);
    return { abierta: false, gracia_hasta: null };
  }
  if (!guardados?.length) return { abierta: false, gracia_hasta: null };

  try {
    await avisar(acceso.familia_id, textoDelAvisoDeGracia({ ...acceso, gracia_hasta: graciaHasta }));
  } catch (falla) {
    // La gracia ya está abierta, que es lo que sostiene el acceso. Que el aviso no haya salido se
    // registra y no deshace nada: deshacerlo suspendería antes de tiempo.
    console.error('No se pudo avisar del cobro que no entró:', falla.message);
  }

  return { abierta: true, gracia_hasta: graciaHasta };
}

/**
 * Suspende los accesos a los que se les terminó la gracia sin que el cobro entrara. Corre una vez
 * por día (`backend/src/server.js`): la gracia se mide en días, no en horas.
 *
 * @returns {Promise<{suspendidos: number}>}
 */
export async function suspenderLosQueAgotaronLaGracia() {
  const hoy = new Date().toISOString().slice(0, 10);

  const { data: accesos, error } = await supabase
    .from('accesos_marketplace')
    .select('id')
    .eq('estado', 'vigente')
    .not('gracia_hasta', 'is', null)
    .lte('gracia_hasta', hoy);

  if (error) {
    console.error('Error consultando los accesos con la gracia terminada:', error.message);
    return { suspendidos: 0 };
  }

  let suspendidos = 0;
  for (const acceso of accesos ?? []) {
    const { error: errorSuspender } = await supabase
      .from('accesos_marketplace')
      .update({ estado: 'vencida', updated_at: new Date().toISOString() })
      .eq('id', acceso.id)
      // Que no haya entrado un cobro entre la consulta y el guardado: si entró, la gracia se cerró
      // y suspender ahora apagaría un acceso que alguien acaba de pagar.
      .eq('estado', 'vigente')
      .not('gracia_hasta', 'is', null)
      .lte('gracia_hasta', hoy);

    if (errorSuspender) {
      // Sin el identificador de la Familia ni el texto crudo de la base (`celtatech\CLAUDE.md` §6).
      console.error('No se pudo suspender un acceso con la gracia terminada:', errorSuspender.message);
      continue;
    }
    suspendidos += 1;
  }

  return { suspendidos };
}

/** Qué lee la Familia cuando el cobro no entró. Corto y neutro: qué pasó, hasta cuándo hay tiempo y
 *  qué ocurre si no se resuelve. El enlace lleva a la pantalla del acceso, que es donde se paga.
 *  Se exporta porque el cuerpo del push viaja cifrado: es la única forma de comprobar qué dice. */
export function textoDelAvisoDeGracia(acceso) {
  return {
    titulo: 'El cobro no se pudo hacer',
    cuerpo:
      `No se pudo cobrar ${importeConMoneda(acceso)}. El acceso sigue funcionando hasta el ` +
      `${enDia(acceso.gracia_hasta)}; si para entonces el cobro no entró, queda suspendido.`,
    url: acceso.paciente_id ? `/pacientes/${acceso.paciente_id}/acceso` : '/',
  };
}