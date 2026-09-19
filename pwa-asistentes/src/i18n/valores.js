// Acá se traduce un VALOR GUARDADO EN LA BASE, que es otra cosa que una frase de pantalla: la
// clave no está escrita en ningún archivo, la arma la fila que vino. Por eso el hueco se resuelve
// acá y no con la red de `i18n/faltaLaFrase.js`, que atiende las frases que sí están escritas.
// Cuando el namespace llega desde `t` —que es lo corriente—, el aviso lo da esa red primero y por
// acá no se pasa; el reparto de qué se muestra es el mismo en las dos, a propósito.
//
// Traduce un valor de enum de negocio (estado, nivel, etc.) usando el namespace de
// traducciones correspondiente. Nunca expone el valor crudo de la base en producción:
// si falta la clave, muestra un guion (o la clave sin traducir solo en desarrollo, para
// detectar el hueco antes de desplegar).
export function traducirValor(namespace, clave) {
  const texto = namespace?.[clave];
  if (texto) return texto;
  return import.meta.env.DEV ? `[sin traducir: ${clave}]` : '—';
}
