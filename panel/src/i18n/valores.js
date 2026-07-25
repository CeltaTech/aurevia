// Traduce un valor de enum de negocio (estado, nivel, etc.) usando el namespace de
// traducciones correspondiente. Nunca expone el valor crudo de la base en producción:
// si falta la clave, muestra un guion (o la clave sin traducir solo en desarrollo, para
// detectar el hueco antes de desplegar).
export function traducirValor(namespace, clave) {
  const texto = namespace?.[clave];
  if (texto) return texto;
  return import.meta.env.DEV ? `[sin traducir: ${clave}]` : '—';
}
