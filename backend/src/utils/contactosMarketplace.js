/* El saldo de contactos de un paquete del Marketplace.
   ====================================================

   QUÉ ES UN PAQUETE. Una de las formas de cobro que puede armar una Prestadora: un importe, sin
   período, y tantos contactos incluidos (`docs/PRD_07_Modalidad_Marketplace.md` §3.3). Se paga una
   vez, no se renueva sola y no vence por calendario: lo que la sostiene es el saldo, y el saldo
   baja de a un Asistente.

   DE A UN ASISTENTE, NO DE A UNA MIRADA. Abierto el contacto de alguien, volver a mirarlo no
   descuenta otro. Quién ya está abierto lo dice `contactos_vistos_marketplace`, y es lo que hace
   que cinco contactos alcancen para cinco Asistentes y no para tres mirados dos veces.

   LAS CUENTAS NO SE HACEN ACÁ. Sumar al saldo y restarle uno son dos funciones de la base
   (`supabase/migrations/20260912100000_…`), y este archivo no hace más que llamarlas. No es una
   preferencia de estilo: leer el saldo, restarle uno y volver a escribirlo son dos viajes, y dos
   ventanas abiertas a la vez descuentan una sola vez. Del lado de la base el descuento y la
   anotación pasan juntos, con la fila del acceso tomada.

   QUIÉN LLAMA A CADA UNA. La carga del saldo la llama el cobro, que es el único lugar por donde
   entra la plata (`cobrosMarketplace.js`). El descuento lo va a llamar la pantalla que le abre el
   contacto a la Familia —el paso «La activación al intentar ver el contacto» del plan—, que
   todavía no existe: hasta entonces el Panel puede ver el saldo y nadie lo gasta. */

import { supabase } from '../db/connection.js';

/** Por qué no se pudo abrir un contacto. Son códigos, no frases: la frase que lee la persona vive
 *  en las traducciones, en los tres idiomas (`celtatech\CLAUDE.md` §8, «un mensaje de error es
 *  texto visible»). */
export const MOTIVO_CONTACTO = {
  ACCESO_INEXISTENTE: 'acceso_inexistente',
  ACCESO_NO_VIGENTE: 'acceso_no_vigente',
  /** Ese acceso no se sostiene por saldo sino por una fecha. No se resuelve comprando un paquete. */
  ACCESO_SIN_SALDO: 'acceso_sin_saldo',
  SALDO_AGOTADO: 'saldo_agotado',
  NO_SE_PUDO_GUARDAR: 'no_se_pudo_guardar',
};

/**
 * Le carga contactos al saldo de un acceso. Se llama cuando entra la plata de un paquete.
 *
 * Suma, no pisa: el paquete no vence por calendario, así que lo que quedó sin abrir de una compra
 * anterior sigue estando. Pisarlo sería vencerlo.
 *
 * @param {object} argumentos
 * @param {string} argumentos.accesoId
 * @param {number} argumentos.cuantos  Cuántos contactos trae lo que se acaba de pagar.
 * @returns {Promise<{ok: boolean, saldo_contactos?: number, motivo?: string, detalle?: string}>}
 */
export async function cargarContactosEnElSaldo({ accesoId, cuantos }) {
  if (!Number.isInteger(cuantos) || cuantos <= 0) {
    return { ok: false, motivo: MOTIVO_CONTACTO.NO_SE_PUDO_GUARDAR, detalle: `cuantos: ${cuantos}` };
  }

  const { data, error } = await supabase.rpc('sumar_contactos_al_saldo', {
    p_acceso_id: accesoId,
    p_cuantos: cuantos,
  });

  if (error) {
    return { ok: false, motivo: MOTIVO_CONTACTO.NO_SE_PUDO_GUARDAR, detalle: error.message };
  }
  // Sin fila que cargar, la base contesta vacío. No se trata como un saldo en cero: es que ese
  // acceso no está, y decir que quedó en cero taparía el problema.
  if (data === null || data === undefined) {
    return { ok: false, motivo: MOTIVO_CONTACTO.ACCESO_INEXISTENTE };
  }

  return { ok: true, saldo_contactos: data };
}

/**
 * Abre el contacto de un Asistente contra el saldo de un acceso, y lo deja anotado.
 *
 * Un Asistente ya abierto contesta que sí y no descuenta nada: el contacto de cada persona se paga
 * una sola vez. `ya_estaba` dice cuál de los dos casos fue, para que quien llama pueda avisar que
 * se gastó un contacto sólo cuando se gastó de verdad.
 *
 * @param {object} argumentos
 * @param {string} argumentos.accesoId
 * @param {string} argumentos.asistenteId
 * @returns {Promise<{ok: boolean, ya_estaba?: boolean, saldo_contactos?: number, motivo?: string, detalle?: string}>}
 */
export async function abrirElContacto({ accesoId, asistenteId }) {
  const { data, error } = await supabase.rpc('consumir_contacto_marketplace', {
    p_acceso_id: accesoId,
    p_asistente_id: asistenteId,
  });

  if (error) {
    return { ok: false, motivo: MOTIVO_CONTACTO.NO_SE_PUDO_GUARDAR, detalle: error.message };
  }
  // Falla cerrado: sin respuesta no se abre nada. Contestar que sí ante lo que no se entendió
  // sería regalar el contacto sin descontarlo.
  if (!data || typeof data !== 'object') {
    return { ok: false, motivo: MOTIVO_CONTACTO.NO_SE_PUDO_GUARDAR, detalle: 'respuesta vacía' };
  }
  if (!data.ok) {
    return { ok: false, motivo: data.motivo, saldo_contactos: data.saldo_contactos };
  }

  return { ok: true, ya_estaba: data.ya_estaba === true, saldo_contactos: data.saldo_contactos };
}
