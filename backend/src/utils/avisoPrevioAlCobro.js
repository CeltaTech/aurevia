/* El aviso previo al primer cobro, cuando se está por terminar el período gratuito.
   =================================================================================

   QUÉ RESUELVE. El §3.2 del `docs/PRD_07_Modalidad_Marketplace.md` pide un aviso antes de cualquier
   cobro por vencimiento del período gratuito: nunca un cobro silencioso. Hasta acá no había
   ninguno, y tampoco había período gratuito: `formas_de_cobro_marketplace.dias_gratis` era un dato
   que la Prestadora cargaba y que no leía nadie. Ahora el alta lo escribe en
   `accesos_marketplace.gratis_hasta` (`altaEnPasarela.js`) y este trabajo es el que avisa.

   POR QUÉ NO PASA POR EL CATÁLOGO DE AVISOS. `catalogoAvisos.js` junta los avisos que la Prestadora
   enciende y apaga según cómo trabaja. Éste no es de ésos: lo exige el §3.2 y es lo que separa un
   cobro anunciado de uno silencioso. Un aviso obligatorio que se pueda apagar no es obligatorio.

   CUÁNDO AVISA. Unos días antes de la fecha del primer cobro, y también el mismo día si hasta
   entonces no se pudo. Después de esa fecha no avisa: el cobro ya salió, y decirle a alguien que
   «va a cobrarse» algo que ya se cobró no es un aviso previo, es ruido.

   A QUIÉN NO LE AVISA. A quien ya se dio de baja durante el período gratuito. Ahí no viene ningún
   cobro, que es justamente lo que la baja consigue, y avisarle uno lo asustaría sin motivo.

   UNA VEZ SOLA, Y ANOTADA. `aviso_previo_en` guarda cuándo se avisó. Sin esa marca el aviso saldría
   todos los días de la ventana, y a la quinta vez deja de leerse. Se anota **después** de que el
   envío salió: si no había a qué dispositivo mandarlo, el día siguiente se vuelve a intentar
   mientras la ventana dure, en vez de quedar anotado un aviso que nadie recibió.

   UN AVISO QUE FALLA NO FRENA A LOS DEMÁS. Es el mismo criterio de `revisarVencimientos` y de
   `cortarLosAccesosDadosDeBaja`: lo de una Familia no puede dejar sin avisar a las otras. */

import { supabase } from '../db/connection.js';
import { enviarPushFamilia } from './push.js';
import { sumarDias } from './fechas.js';
import { enDia, importeConMoneda } from './comoSeDiceEnUnAviso.js';

/** Con cuántos días de anticipación se avisa. Lo decide este producto, no la Prestadora: es el
 *  resguardo del §3.2 y no una preferencia de cómo trabaja cada una. Tres días alcanzan para darse
 *  de baja sin apuro —la baja es de un clic— y son pocos como para que el aviso llegue cuando el
 *  cobro todavía se recuerda. Mismo criterio que `DIAS_DE_VENCIMIENTO_DEL_CUPON` en
 *  `cobrosMarketplace.js`. */
const DIAS_DE_AVISO_PREVIO = 3;

/**
 * Avisa a las Familias cuyo período gratuito está por terminar. Corre una vez por día
 * (`backend/src/server.js`).
 *
 * @param {object} [argumentos]
 * @param {Function} [argumentos.avisar]  Por dónde sale el aviso. Es el push a la Familia, y está
 *                                        como parámetro porque `web-push` sólo entrega contra una
 *                                        dirección segura: la prueba no puede levantar un servicio
 *                                        de push de mentira y necesita poder decir «salió» y «no
 *                                        salió», que es de lo que depende todo lo demás.
 * @returns {Promise<{avisados: number}>}
 */
export async function avisarElPrimerCobroQueViene({ avisar = enviarPushFamilia } = {}) {
  const hoy = new Date().toISOString().slice(0, 10);
  const hastaCuando = sumarDias(hoy, DIAS_DE_AVISO_PREVIO);

  const { data: accesos, error } = await supabase
    .from('accesos_marketplace')
    .select('id, familia_id, paciente_id, importe, moneda, gratis_hasta')
    .eq('estado', 'vigente')
    .is('cancelada_en', null)
    .is('aviso_previo_en', null)
    .not('gratis_hasta', 'is', null)
    .gte('gratis_hasta', hoy)
    .lte('gratis_hasta', hastaCuando);

  if (error) {
    console.error('Error consultando los accesos por avisar del primer cobro:', error.message);
    return { avisados: 0 };
  }

  let avisados = 0;
  for (const acceso of accesos ?? []) {
    let salio = false;
    try {
      salio = await avisar(acceso.familia_id, textoDelAviso(acceso));
    } catch (falla) {
      console.error('No se pudo avisar del primer cobro a una Familia:', falla.message);
      continue;
    }
    // Sin dispositivo al que mandarlo no hay nada que anotar: mañana se vuelve a intentar.
    if (!salio) continue;

    const { error: errorAnotar } = await supabase
      .from('accesos_marketplace')
      .update({ aviso_previo_en: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', acceso.id)
      .is('aviso_previo_en', null);

    if (errorAnotar) {
      // El aviso salió y la marca no se guardó. Se anota fuerte porque el próximo día lo va a
      // mandar de nuevo: es preferible a no avisar, pero no es lo que tiene que pasar.
      console.error('Aviso del primer cobro enviado y no anotado:', acceso.id, errorAnotar.message);
      continue;
    }
    avisados += 1;
  }

  return { avisados };
}

/** Qué lee la Familia. Corto y neutro: qué día empieza a cobrarse, cuánto, y que puede darse de
 *  baja antes. El enlace lleva a la pantalla del acceso, que es donde está el botón de la baja.
 *  Se exporta porque el cuerpo del push viaja cifrado: es la única forma de comprobar qué dice. */
export function textoDelAviso(acceso) {
  return {
    titulo: 'Termina el período sin cargo',
    cuerpo:
      `El ${enDia(acceso.gratis_hasta)} empieza a cobrarse ${importeConMoneda(acceso)}. ` +
      'Si prefiere no continuar, puede darse de baja antes desde la aplicación.',
    url: acceso.paciente_id ? `/pacientes/${acceso.paciente_id}/acceso` : '/',
  };
}