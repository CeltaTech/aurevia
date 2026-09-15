/* Ver cómo llegar a un Asistente del Marketplace: qué hace falta y qué pasa al activarlo.
   =====================================================================================

   QUÉ ES ESTO. El dato de contacto —teléfono, correo, domicilio— es justamente lo que el
   Marketplace vende (`docs/PRD_07_Modalidad_Marketplace.md:70`). Hasta acá estaban las dos
   puntas y faltaba el medio: el descuento del saldo vivía en la base y en
   `contactosMarketplace.js` sin que lo llamara nadie, y el contacto no se le abría a ninguna
   Familia por ningún camino. Este archivo es ese medio.

   DOS PREGUNTAS DISTINTAS, Y POR ESO DOS FUNCIONES. Una pantalla necesita saber **qué va a
   pasar** antes de que pase —para poder pedir la confirmación—, y después necesita **hacerlo**.
   `comoEstaElContacto` no toca nada; `abrirElContactoDeUnAsistente` cobra. Mezclarlas sería
   exactamente lo que el plan prohíbe: abrir un contacto como efecto colateral de mirar algo.

   LA CONFIRMACIÓN NO SE PIDE ACÁ. Acá se dice qué se va a cobrar, con importe y moneda, y la
   pantalla lo muestra y pregunta. El motor no confía en que lo haya preguntado: lo que lo
   protege es que abrir cuesta un pedido aparte, que ninguna pantalla manda sin que alguien
   toque el botón.

   CUÁL ACCESO PAGA. Una Familia puede tener un acceso por Paciente, y el contacto de un
   Asistente es de la Familia entera —así lo dice el candado de `contactos_vistos_marketplace`,
   que es (familia, asistente) y no lleva Paciente—. Paga el acceso vigente más antiguo que
   pueda pagarlo: primero los que tienen saldo, y recién después los que se sostienen por fecha.
   Gastar primero lo que ya se compró es lo que evita dejar paquetes con saldo colgado.

   EL PERÍODO GRATUITO TERMINA ACÁ, Y ESO ES «ACTIVAR EL COBRO».
   `docs/PRD_07_Modalidad_Marketplace.md:92-93`: si la Familia intenta ver un dato de contacto
   antes de que termine el período gratuito, el cobro se activa ahí, con confirmación. Activarlo
   es que ese acceso deje de estar en prueba: `gratis_hasta` y `proximo_cobro` pasan a hoy, y
   desde ese momento el cobro es firme. Quien no lo intenta llega al final del período gratuito
   sin haber consumido nada y decide entonces.

   Y HAY UNA ASIMETRÍA ENTRE RIELES QUE NO SE TAPA. Los rieles que cobran solos —Stripe, Mercado
   Pago, DEBIN— ya tienen el período gratuito anotado del lado del proveedor, así que el primer
   cobro sale el día que se pactó con él y no hoy; adelantarlo sería una operación del adaptador
   que hoy ninguno tiene. Los que no cobran solos miran `proximo_cobro`, así que para ellos el
   cobro queda armado en el próximo paso del trabajo diario. En los dos casos lo que cambia acá
   es lo mismo y es lo que importa: el acceso dejó de estar en prueba.

   FALLA CERRADO. Sin acceso vigente, sin saldo, o ante cualquier error de la base, no se abre
   nada y se devuelve el motivo. Nunca se muestra un contacto que no se pudo descontar. */

import { supabase } from '../db/connection.js';
import { abrirElContacto, MOTIVO_CONTACTO } from './contactosMarketplace.js';

/** Las columnas de la ficha del Asistente que son el dato que se vende. Están acá, en una sola
 *  lista, por el mismo motivo que `COLUMNAS_PERFIL_PUBLICO` tiene la suya: para que ninguna ruta
 *  nueva arme la propia y termine mostrando de más. */
export const COLUMNAS_DE_CONTACTO = 'id, nombre, telefono, email, domicilio';

/** Por qué no se pudo ver un contacto. Códigos, no frases: la frase vive en las traducciones de
 *  la aplicación, en los tres idiomas (`celtatech\CLAUDE.md` §8). */
export const MOTIVO_VER_CONTACTO = {
  /** Esta Familia no tiene ningún acceso al Marketplace. Lo da de alta la Prestadora. */
  SIN_ACCESO: 'sin_acceso_de_marketplace',
  /** Tiene acceso, pero ninguno vigente: vencido o dado de baja. */
  ACCESO_NO_VIGENTE: MOTIVO_CONTACTO.ACCESO_NO_VIGENTE,
  /** Tenía paquete y se le acabaron los contactos. */
  SALDO_AGOTADO: MOTIVO_CONTACTO.SALDO_AGOTADO,
  NO_SE_PUDO_GUARDAR: MOTIVO_CONTACTO.NO_SE_PUDO_GUARDAR,
};

const COLUMNAS_DEL_ACCESO =
  'id, estado, importe, moneda, gratis_hasta, proximo_cobro, saldo_contactos, created_at, ' +
  'formas_de_cobro_marketplace(nombre, renueva_sola, periodo_cantidad, periodo_unidad, contactos_incluidos)';

/** ¿Este acceso está todavía en período gratuito? Se compara por día, que es como está guardado:
 *  el último día del período gratuito todavía es gratis. */
export function enPeriodoGratuito(acceso, hoy = new Date().toISOString().slice(0, 10)) {
  return Boolean(acceso?.gratis_hasta) && acceso.gratis_hasta >= hoy;
}

/** ¿Este acceso puede pagar un contacto más? El que se sostiene por fecha paga siempre; el de
 *  paquete, mientras le quede saldo. */
function puedePagar(acceso) {
  return acceso.saldo_contactos === null || acceso.saldo_contactos > 0;
}

/**
 * El acceso con el que esta Familia paga el próximo contacto, y nada más que eso.
 *
 * Gasta primero lo comprado: entre varios vigentes elige el más antiguo con saldo, y sólo si no
 * hay ninguno con saldo toma uno que se sostenga por fecha. Si ninguno puede pagar devuelve igual
 * un vigente agotado, para que quien llama pueda distinguir «no tiene acceso» de «se le acabó el
 * saldo», que no son lo mismo y no se arreglan igual.
 *
 * @returns {Promise<{acceso: object|null, hubo_alguno: boolean}>}
 */
export async function accesoQuePagaElContacto({ familiaId }) {
  const { data, error } = await supabase
    .from('accesos_marketplace')
    .select(COLUMNAS_DEL_ACCESO)
    .eq('familia_id', familiaId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error consultando los accesos de la Familia:', error.message);
    return { acceso: null, hubo_alguno: false };
  }

  const todos = data || [];
  const vigentes = todos.filter((a) => a.estado === 'vigente');
  const conSaldo = vigentes.find((a) => a.saldo_contactos !== null && a.saldo_contactos > 0);
  const porFecha = vigentes.find((a) => a.saldo_contactos === null);

  // El agotado va último y a propósito: devolverlo es lo que permite contestar «se le acabó» en vez
  // de «no tiene acceso». Quien llama pregunta si puede pagar antes de cobrarle.
  return { acceso: conSaldo || porFecha || vigentes[0] || null, hubo_alguno: todos.length > 0 };
}

/** El dato de contacto de un Asistente. Se pide con el identificador de la Prestadora además del
 *  de la persona: un identificador probado a mano no alcanza una ficha de otra Organización. */
export async function datosDeContacto({ prestadoraId, asistenteId }) {
  const { data, error } = await supabase
    .from('asistentes')
    .select(COLUMNAS_DE_CONTACTO)
    .eq('id', asistenteId)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();

  if (error) {
    console.error('Error consultando el contacto del Asistente:', error.message);
    return null;
  }
  return data || null;
}

/** Lo que la pantalla necesita para preguntar antes de cobrar: qué forma se va a usar, cuánto
 *  sale, y si tocar el botón termina el período gratuito. Es lo que se muestra en la
 *  confirmación, y por eso sale armado de un solo lugar. */
function avisoDeLaActivacion(acceso) {
  if (!acceso) return null;
  const forma = acceso.formas_de_cobro_marketplace || {};
  return {
    forma: forma.nombre || '',
    importe: acceso.importe,
    moneda: acceso.moneda,
    renueva_sola: Boolean(forma.renueva_sola),
    // Los dos datos que cambian lo que dice la confirmación: uno avisa que se termina la prueba,
    // el otro que se gasta un contacto de los que quedan.
    termina_el_periodo_gratuito: enPeriodoGratuito(acceso),
    saldo_contactos: acceso.saldo_contactos,
  };
}

/**
 * Cómo está el contacto de un Asistente para esta Familia. **No toca nada.**
 *
 * @param {object} argumentos
 * @param {boolean} argumentos.mira_el_dinero  Si quien pregunta tiene el acceso del círculo que
 *   deja ver la plata. Sin él se contesta si el contacto está abierto y nada sobre el cobro:
 *   cuánto sale y cuánto queda de saldo es plata, y en el círculo familiar no la mira cualquiera.
 * @returns {Promise<{abierto: boolean, contacto: object|null, activacion: object|null, motivo?: string}>}
 */
export async function comoEstaElContacto({ prestadoraId, familiaId, asistenteId, mira_el_dinero = false }) {
  const { data: yaVisto, error } = await supabase
    .from('contactos_vistos_marketplace')
    .select('id')
    .eq('familia_id', familiaId)
    .eq('asistente_id', asistenteId)
    .maybeSingle();

  // Falla cerrado: ante un error se contesta que no está abierto. Contestar que sí destaparía un
  // dato que quizá nadie pagó.
  if (error) {
    console.error('Error consultando contactos_vistos_marketplace:', error.message);
    return { abierto: false, contacto: null, activacion: null, motivo: MOTIVO_VER_CONTACTO.NO_SE_PUDO_GUARDAR };
  }

  if (yaVisto) {
    return {
      abierto: true,
      contacto: await datosDeContacto({ prestadoraId, asistenteId }),
      activacion: null,
    };
  }

  if (!mira_el_dinero) {
    return { abierto: false, contacto: null, activacion: null };
  }

  const { acceso, hubo_alguno: huboAlguno } = await accesoQuePagaElContacto({ familiaId });
  if (!acceso) {
    return {
      abierto: false,
      contacto: null,
      activacion: null,
      motivo: huboAlguno ? MOTIVO_VER_CONTACTO.ACCESO_NO_VIGENTE : MOTIVO_VER_CONTACTO.SIN_ACCESO,
    };
  }
  if (!puedePagar(acceso)) {
    return { abierto: false, contacto: null, activacion: null, motivo: MOTIVO_VER_CONTACTO.SALDO_AGOTADO };
  }

  return { abierto: false, contacto: null, activacion: avisoDeLaActivacion(acceso) };
}

/**
 * Abre el contacto de un Asistente: termina el período gratuito si estaba corriendo, descuenta
 * el contacto y devuelve el dato. Es lo que hace el botón, y sólo el botón.
 *
 * Un contacto ya abierto contesta lo mismo sin cobrar nada: se paga una vez por Familia y por
 * Asistente.
 *
 * @returns {Promise<{ok: boolean, contacto?: object, ya_estaba?: boolean, saldo_contactos?: number, motivo?: string}>}
 */
export async function abrirElContactoDeUnAsistente({ prestadoraId, familiaId, asistenteId }) {
  const { acceso, hubo_alguno: huboAlguno } = await accesoQuePagaElContacto({ familiaId });
  if (!acceso) {
    return { ok: false, motivo: huboAlguno ? MOTIVO_VER_CONTACTO.ACCESO_NO_VIGENTE : MOTIVO_VER_CONTACTO.SIN_ACCESO };
  }

  // Primero se cobra y recién después se muestra. Al revés, un descuento que falla dejaría el
  // dato ya visto, que es lo único que no se puede deshacer.
  const abierto = await abrirElContacto({ accesoId: acceso.id, asistenteId });
  if (!abierto.ok) {
    return { ok: false, motivo: abierto.motivo, saldo_contactos: abierto.saldo_contactos };
  }

  // Se termina la prueba sólo cuando se abrió un contacto nuevo. Volver a mirar uno que ya estaba
  // abierto no consume nada, así que tampoco activa nada.
  if (!abierto.ya_estaba) {
    await terminarElPeriodoGratuito(acceso);
  }

  const contacto = await datosDeContacto({ prestadoraId, asistenteId });
  return {
    ok: true,
    contacto,
    ya_estaba: abierto.ya_estaba,
    saldo_contactos: abierto.saldo_contactos,
  };
}

/** Deja el acceso fuera del período gratuito. Lo que se cobró ya se consumió, así que la prueba
 *  terminó: el primer cobro pasa a ser el de hoy. No se toca nada del lado del proveedor —el
 *  riel que cobra solo tiene el período anotado allá— y por eso tampoco se adelanta una fecha
 *  que ya pasó: `proximo_cobro` anterior a hoy se respeta como está. */
async function terminarElPeriodoGratuito(acceso) {
  if (!enPeriodoGratuito(acceso)) return;

  const hoy = new Date().toISOString().slice(0, 10);
  const cambios = { gratis_hasta: hoy, updated_at: new Date().toISOString() };
  if (!acceso.proximo_cobro || acceso.proximo_cobro > hoy) cambios.proximo_cobro = hoy;

  const { error } = await supabase.from('accesos_marketplace').update(cambios).eq('id', acceso.id);
  // El contacto ya está abierto y anotado: si esto falla, lo que queda es un período gratuito que
  // dura un día de más, no un dato regalado. Se registra y no se tira abajo lo que ya salió bien.
  if (error) console.error('Error terminando el período gratuito del acceso:', error.message);
}
