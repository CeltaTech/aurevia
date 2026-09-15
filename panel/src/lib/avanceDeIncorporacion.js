// Cuánto le falta a un aspirante para terminar su incorporación.
//
// POR QUÉ EXISTE. La pestaña de verificación mostraba las etapas una debajo de la otra y nada
// más: para saber cómo venía la persona había que contarlas con el dedo. Acá se cuentan solas.
//
// QUÉ CUENTA COMO AVANCE. Las etapas aprobadas, y nada más. Una etapa rechazada está resuelta
// pero no acerca a nadie a trabajar, así que no suma; se dice aparte cuántas hay, porque una
// incorporación con una etapa rechazada no es lo mismo que una a medio hacer.
//
// EL CATÁLOGO MANDA. Cada Prestadora arma sus propias etapas y las cambia cuando quiere, así que
// el total sale del catálogo de hoy y no de las filas guardadas. Una etapa que se sacó del
// catálogo deja de contar aunque su fila siga ahí, y una que se agregó cuenta como pendiente
// aunque todavía no tenga fila.

export const ETAPA_APROBADA = 'aprobada';
export const ETAPA_RECHAZADA = 'rechazada';

export function avanceDeIncorporacion(etapas, verificaciones) {
  const delCatalogo = Array.isArray(etapas) ? etapas : [];
  const filas = Array.isArray(verificaciones) ? verificaciones : [];

  const estadoDe = new Map(filas.map((fila) => [fila?.etapa, fila?.estado]));
  let aprobadas = 0;
  let rechazadas = 0;
  for (const etapa of delCatalogo) {
    const estado = estadoDe.get(etapa?.clave);
    if (estado === ETAPA_APROBADA) aprobadas += 1;
    else if (estado === ETAPA_RECHAZADA) rechazadas += 1;
  }

  const total = delCatalogo.length;
  return {
    total,
    aprobadas,
    rechazadas,
    pendientes: total - aprobadas - rechazadas,
    // Sin etapas configuradas no hay proceso, y entonces no hay nada que contar: cero por ciento
    // de nada sería un número inventado.
    porcentaje: total > 0 ? Math.round((aprobadas / total) * 100) : 0,
    hayEtapas: total > 0,
    completo: total > 0 && aprobadas === total,
  };
}
