import crypto from 'node:crypto';
import { supabase } from '../db/connection.js';
import { correoComparable } from '../config/correoDeAcceso.js';

// EL TOPE DE PEDIDOS DE CLAVE NUEVA.
//
// QUÉ RESUELVE. Pedir una clave nueva no exige sesión —quien llega ahí perdió justamente la forma
// de tener una—, así que la puerta la abre cualquiera desde afuera. Sin tope, cualquiera le llena
// la casilla de correo a una persona repitiendo el pedido, y cada mensaje lo paga la Prestadora.
// El tope del motor (`middleware/topeDePedidos.js`) no sirve acá: cuenta por persona con sesión.
//
// SE CUENTA POR HUELLA DEL CORREO Y POR PRESTADORA. La huella, y no el correo, porque para contar
// alcanza con reconocer que es el mismo, y así el renglón que queda no dice a quién se le mandó
// nada. Por Prestadora, porque cada Prestadora donde esa persona trabaja es una cuenta distinta y
// el tope de una no puede dejar sin recuperar la clave de la otra.
//
// SE CUENTA ANTES DE BUSCAR LA CUENTA, y el pedido se anota exista el correo o no. Si sólo
// contaran los correos con cuenta, quedarse sin pedidos sería la señal de que ese correo existe, y
// esta puerta volvería a ser una forma de averiguar quién trabaja en qué Prestadora.
//
// Es el mismo molde que `codigoAlTelefono.js` usa para el código al teléfono, con la misma forma de
// fallar: cerrado.

const TOPE_POR_HORA_POR_OMISION = 5;

/**
 * Cuántos pedidos de clave nueva se le aceptan como mucho a un mismo correo en una hora, dentro de
 * una misma Prestadora.
 *
 * Se lee en cada pedido y no una sola vez al arrancar, para que cambiarlo no obligue a reiniciar y
 * para que las pruebas puedan moverlo. Un valor vacío, no entero o menor que uno se trata como si
 * no estuviera: es el caso corriente del renglón puesto y sin completar.
 */
export function topeDePedidosDeClavePorHora() {
  const texto = String(process.env.TOPE_PEDIDOS_DE_CLAVE_POR_HORA ?? '').trim();
  if (!texto) return TOPE_POR_HORA_POR_OMISION;

  const numero = Number(texto);
  if (!Number.isInteger(numero) || numero < 1) {
    console.warn(
      'topeDePedidosDeClave: TOPE_PEDIDOS_DE_CLAVE_POR_HORA no es un entero mayor que cero; se usa el valor de fábrica',
    );
    return TOPE_POR_HORA_POR_OMISION;
  }
  return numero;
}

/**
 * La huella del correo.
 *
 * Se toma sobre el correo ya comparable —el mismo que usa la búsqueda de la cuenta—, para que
 * `Marta@Ejemplo.com` y `marta@ejemplo.com` cuenten como uno solo.
 */
export function huellaDelCorreo(email) {
  return crypto.createHash('sha256').update(correoComparable(email) ?? '').digest('hex');
}

async function pedidosEnLaUltimaHora(prestadoraId, huella) {
  const desde = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('pedidos_de_clave_nueva')
    .select('id', { count: 'exact', head: true })
    .eq('prestadora_id', prestadoraId)
    .eq('correo_huella', huella)
    .gte('pedido_en', desde);

  if (error) {
    // Falla cerrado: un tope que se saltea cuando la base no contesta no es un tope.
    console.error('topeDePedidosDeClave: no se pudieron contar los pedidos:', error.message);
    return Number.POSITIVE_INFINITY;
  }
  return Number.isFinite(count) ? count : Number.POSITIVE_INFINITY;
}

/**
 * ¿Este correo ya pidió de más en esta Prestadora, durante la última hora?
 *
 * @returns {Promise<boolean>} verdadero cuando no corresponde mandar nada.
 */
export async function seAgotaronLosPedidosDeClave(prestadoraId, email) {
  if (!prestadoraId) return true;
  const cuantos = await pedidosEnLaUltimaHora(prestadoraId, huellaDelCorreo(email));
  return cuantos >= topeDePedidosDeClavePorHora();
}

/**
 * Anota el pedido, para que el próximo lo cuente.
 *
 * Se anota antes de mandar nada y exista o no la cuenta. Un envío que falló ya gastó el intento, y
 * un correo sin cuenta que no contara dejaría la puerta abierta para probar de a un correo por vez.
 */
export async function anotarPedidoDeClave(prestadoraId, email) {
  if (!prestadoraId) return;
  const { error } = await supabase
    .from('pedidos_de_clave_nueva')
    .insert({ prestadora_id: prestadoraId, correo_huella: huellaDelCorreo(email) });
  if (error) {
    console.error('topeDePedidosDeClave: no se pudo anotar el pedido:', error.message);
  }
}
