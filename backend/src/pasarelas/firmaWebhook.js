// Pendiente #159 — cómo se comprueba que un aviso de cobro vino de verdad de la pasarela.
//
// Stripe y Mercado Pago firman sus avisos de la misma forma: una cabecera con un instante y
// una o más firmas, y un HMAC-SHA256 calculado con un secreto que solo conocen ellos y la
// Prestadora. Cambian el nombre de la cabecera, el nombre del instante y qué texto se firma;
// el resto es idéntico. Por eso la comprobación vive acá una sola vez y todos los adaptadores
// la llaman (regla 12 del §7 de CLAUDE.md), en vez de repetir el mismo cálculo una vez por
// proveedor con criterios que se despegan con el tiempo.
//
// Modo y el PSP que tramita el DEBIN no publican ningún esquema de firma. Cómo se los trata
// —y por qué no se les inventa uno— está más abajo, en `comprobarFirmaSinEsquemaPublicado`.
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

import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

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

/** Compara dos secretos de texto —no dos firmas en hexadecimal— sin filtrar por dónde dejaron
 *  de parecerse ni cuánto mide el guardado. Lo usa la entrada de WhatsApp para el token de
 *  verificación del saludo de Meta (pendiente #165), que es un texto que elige la Prestadora y
 *  no tiene largo fijo.
 *
 *  Por qué no se comparan los bytes derechos, como en `firmasIguales`: ahí el largo es público
 *  —una firma son siempre 32 bytes— y cortar por largo distinto no dice nada. Acá sí diría, y
 *  con el largo del token guardado se empieza a adivinarlo. Entonces se comparan los resúmenes:
 *  se calcula el HMAC de los dos con una llave nueva de cada vez —nueva para que el resumen no
 *  sirva para nada afuera de esta comparación— y los dos resúmenes miden siempre lo mismo. */
export function secretosIguales(recibido, esperado) {
  if (!recibido || !esperado) return false;
  const llave = randomBytes(32);
  const resumenRecibido = createHmac('sha256', llave).update(String(recibido), 'utf8').digest();
  const resumenEsperado = createHmac('sha256', llave).update(String(esperado), 'utf8').digest();
  return timingSafeEqual(resumenRecibido, resumenEsperado);
}

// ---------------------------------------------------------------------------
// Los proveedores que no publican cómo firman (pendiente #9 del plan)
//
// Stripe y Mercado Pago publican su esquema de firma, y por eso los dos adaptadores de más
// arriba pueden reproducirlo exactamente. **Modo y el PSP que tramita el DEBIN no publican
// ninguno**: se buscó en la documentación abierta de los dos —el sitio de integraciones de
// Modo (`merchants.modo.com.ar/docs`, cuyo índice entero es Introducción, Botón de Pago,
// Plugins, Plugins externos, APK de prueba, UX del flujo de pago, preguntas frecuentes y
// soporte) y la documentación de PSP de DEBIN, que documenta consultar el estado y no notificar—
// y en ninguna de las dos hay cabecera de firma, algoritmo ni texto firmado.
//
// **No se inventa un algoritmo y se le pone el nombre del proveedor.** Escribir «Modo firma
// así» sin haberlo leído en ningún lado es peor que no comprobar nada: el que viene detrás lo
// lee como un hecho. Entonces lo que se hace es lo único honesto:
//
//   - **Sin secreto configurado, se rechaza todo aviso.** Es el estado en el que salen las dos
//     hoy, y es a propósito: prefiero que no entre ninguno a que entre cualquiera.
//   - **Con secreto configurado, se comprueba contra la convención que declara este producto**
//     —la de acá abajo—, que no sale de la documentación de ningún proveedor y por eso no se
//     escribe con el nombre de ninguno. Es la misma cuenta que ya hacen Stripe y Mercado Pago,
//     reutilizada, no una segunda.
//
// Consecuencia, escrita para que no sorprenda: mientras no se confirme con el proveedor cómo
// firma de verdad, **un aviso auténtico de Modo o del PSP también se va a rechazar**. Eso es el
// control fallando cerrado, no un defecto. El día que se confirme el esquema real, el adaptador
// de ese proveedor deja de llamar a esta función y reproduce el suyo, igual que Stripe.
// ---------------------------------------------------------------------------

/** La cabecera y la forma que este producto le exige a un proveedor que no publica ninguna:
 *  `ts=<instante>,v1=<hmac-sha256 en hexadecimal>`, calculado sobre `<instante>.<cuerpo crudo>`.
 *  El nombre de la cabecera es el de uso corriente en el mercado local; el instante se llama
 *  `ts` por lo mismo. */
export const CABECERA_CONVENCION_PROPIA = 'x-signature';

/**
 * La comprobación para un proveedor cuyo esquema de firma no está publicado.
 *
 * @param secretoFirma      el secreto guardado para esa Prestadora y ese proveedor (Vault)
 * @param secretoDeAmbiente el secreto del ambiente, para el despliegue que todavía no cargó
 *                          uno por Prestadora. Se usa **sólo si no hay el de la Prestadora**:
 *                          un secreto compartido prueba quién firmó, no para qué Prestadora,
 *                          así que el de la Prestadora siempre gana.
 * @returns `{ valido, motivo }`, con los mismos motivos que el resto del archivo
 */
export function comprobarFirmaSinEsquemaPublicado({
  secretoFirma,
  secretoDeAmbiente,
  headers,
  cuerpoCrudo,
  ahoraMs,
}) {
  // Sin los bytes tal cual llegaron no hay nada que firmar. No se rearma el cuerpo a partir del
  // objeto leído: eso da un texto parecido y una firma distinta.
  if (!Buffer.isBuffer(cuerpoCrudo)) return { valido: false, motivo: MOTIVO.CUERPO_AUSENTE };

  const secreto = secretoFirma || secretoDeAmbiente;
  if (!secreto) return { valido: false, motivo: MOTIVO.SECRETO_AUSENTE };

  return comprobarFirma({
    secreto,
    cabecera: headers?.[CABECERA_CONVENCION_PROPIA],
    claveDelInstante: 'ts',
    textoFirmado: (instante) => [`${instante}.`, cuerpoCrudo],
    ahoraMs,
  });
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
