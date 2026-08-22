// Pendiente #159 — cómo se comprueba que un aviso de cobro vino de verdad de la pasarela.
//
// Stripe y Mercado Pago firman sus avisos de la misma forma: una cabecera con un instante y
// una o más firmas, y un HMAC-SHA256 calculado con un secreto que solo conocen ellos y la
// Prestadora. Cambian el nombre de la cabecera, el nombre del instante y qué texto se firma;
// el resto es idéntico. Por eso la comprobación vive acá una sola vez y los dos adaptadores
// la llaman (regla 12 del §7 de CLAUDE.md), en vez de repetir el mismo cálculo dos veces con
// dos criterios que se despegan con el tiempo.
//
// Tres cosas que no se negocian:
//
//   1. **Se compara con `timingSafeEqual`, nunca con `===`.** Comparar dos textos con `===`
//      corta en el primer carácter distinto, así que tarda un poquito más cuando el
//      principio coincide. Midiendo esa diferencia muchas veces se adivina la firma
//      carácter por carácter. `timingSafeEqual` tarda siempre lo mismo.
//   2. **El instante tiene que ser reciente.** Sin eso, un aviso auténtico que alguien copió
//      hace seis meses —con su firma buena— se puede volver a mandar hoy y sirve igual.
//   3. **Ante cualquier duda, se rechaza.** Falta el secreto, falta la cabecera, la cabecera
//      no se entiende: se rechaza. Nunca "se sigue igual".

import { createHmac, timingSafeEqual } from 'crypto';

/** Cuánto puede haber viajado un aviso antes de que deje de aceptarse. Cinco minutos es la
 *  tolerancia que recomiendan las dos pasarelas: alcanza para una demora de red o un reloj
 *  corrido, y no alcanza para reenviar un aviso viejo. */
export const TOLERANCIA_SEGUNDOS = 5 * 60;

/** Por qué se rechazó un aviso. Se registra del lado del servidor; al que llama se le
 *  contesta siempre lo mismo, sin decirle cuál de las comprobaciones falló. */
export const MOTIVO = {
  SECRETO_AUSENTE: 'secreto_de_firma_no_guardado',
  CABECERA_AUSENTE: 'cabecera_de_firma_ausente',
  CABECERA_ILEGIBLE: 'cabecera_de_firma_ilegible',
  INSTANTE_VENCIDO: 'instante_de_la_firma_vencido',
  FIRMA_NO_COINCIDE: 'la_firma_no_coincide',
  CUERPO_AUSENTE: 'cuerpo_crudo_ausente',
  SIN_REFERENCIA: 'aviso_sin_referencia_de_cobro',
};

/** Los motivos que dicen "este aviso no se pudo probar auténtico". Todos terminan en un
 *  rechazo con 401. Queda afuera `SIN_REFERENCIA`, que es otra cosa: el aviso venía firmado
 *  de verdad, pero adentro no traía ninguna referencia de cobro que mirar. */
const MOTIVOS_DE_AUTENTICIDAD = new Set([
  MOTIVO.SECRETO_AUSENTE,
  MOTIVO.CABECERA_AUSENTE,
  MOTIVO.CABECERA_ILEGIBLE,
  MOTIVO.INSTANTE_VENCIDO,
  MOTIVO.FIRMA_NO_COINCIDE,
  MOTIVO.CUERPO_AUSENTE,
]);

export function esRechazoDeAutenticidad(motivo) {
  return MOTIVOS_DE_AUTENTICIDAD.has(motivo);
}

/** `t=1699999999,v1=abc,v1=def` → Map { t: ['1699999999'], v1: ['abc', 'def'] }.
 *  Las dos pasarelas escriben la cabecera con esta misma forma. Puede venir más de una
 *  firma: cuando la Prestadora está rotando el secreto, la pasarela manda la vieja y la
 *  nueva juntas, y alcanza con que una coincida. */
export function partesDeLaCabecera(cabecera) {
  const partes = new Map();
  for (const trozo of String(cabecera).split(',')) {
    const corte = trozo.indexOf('=');
    if (corte < 1) continue;
    const clave = trozo.slice(0, corte).trim();
    const valor = trozo.slice(corte + 1).trim();
    if (!clave || !valor) continue;
    if (!partes.has(clave)) partes.set(clave, []);
    partes.get(clave).push(valor);
  }
  return partes;
}

/** ¿El instante que viaja en la firma cae dentro de la tolerancia? Se mira la diferencia en
 *  valor absoluto: un aviso fechado en el futuro es tan sospechoso como uno viejo, y suele
 *  ser un reloj mal puesto. */
export function instanteVigente(segundos, ahoraMs = Date.now()) {
  const instante = Number(segundos);
  if (!Number.isFinite(instante)) return false;
  return Math.abs(ahoraMs / 1000 - instante) <= TOLERANCIA_SEGUNDOS;
}

/** El HMAC-SHA256 en hexadecimal de una lista de trozos. Los trozos pueden ser texto o
 *  bytes: el cuerpo crudo del aviso llega como bytes y se firma tal cual llegó, sin pasar
 *  por ninguna conversión que pueda cambiarle una coma. */
export function hmacHex(secreto, trozos) {
  const hmac = createHmac('sha256', secreto);
  for (const trozo of trozos) hmac.update(trozo);
  return hmac.digest('hex');
}

/** Compara dos firmas en hexadecimal sin filtrar por dónde dejaron de parecerse. */
export function firmasIguales(recibida, esperada) {
  const bytesRecibidos = Buffer.from(String(recibida), 'hex');
  const bytesEsperados = Buffer.from(esperada, 'hex');
  // `timingSafeEqual` se planta si los largos no coinciden, así que eso se mira antes. No
  // filtra nada: el largo de una firma es público, siempre son 32 bytes.
  if (bytesRecibidos.length !== bytesEsperados.length) return false;
  return timingSafeEqual(bytesRecibidos, bytesEsperados);
}

/**
 * La comprobación entera, igual para las dos pasarelas.
 *
 * @param secreto             el secreto de firma guardado para esa Prestadora y ese proveedor
 * @param cabecera            el valor crudo de la cabecera de firma que mandó la pasarela
 * @param claveDelInstante    cómo se llama el instante adentro de la cabecera (`t` / `ts`)
 * @param textoFirmado        función que recibe el instante y devuelve los trozos a firmar
 * @param ahoraMs             solo para las pruebas; en producción es la hora de la máquina
 * @returns `{ valido: true, motivo: null }` o `{ valido: false, motivo }`
 */
export function comprobarFirma({ secreto, cabecera, claveDelInstante, textoFirmado, ahoraMs = Date.now() }) {
  if (!secreto) return { valido: false, motivo: MOTIVO.SECRETO_AUSENTE };
  if (!cabecera) return { valido: false, motivo: MOTIVO.CABECERA_AUSENTE };

  const partes = partesDeLaCabecera(cabecera);
  const instante = partes.get(claveDelInstante)?.[0];
  const firmas = partes.get('v1') ?? [];
  if (!instante || firmas.length === 0) return { valido: false, motivo: MOTIVO.CABECERA_ILEGIBLE };

  if (!instanteVigente(instante, ahoraMs)) return { valido: false, motivo: MOTIVO.INSTANTE_VENCIDO };

  const esperada = hmacHex(secreto, textoFirmado(instante));
  if (!firmas.some((firma) => firmasIguales(firma, esperada))) {
    return { valido: false, motivo: MOTIVO.FIRMA_NO_COINCIDE };
  }

  return { valido: true, motivo: null };
}
