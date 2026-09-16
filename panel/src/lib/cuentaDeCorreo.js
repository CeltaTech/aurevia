/* Cómo se lee la cuenta de correo que contesta el motor.

   El correo de todas las Prestadoras sale por un mismo servicio de afuera, que acepta hasta
   cierta cantidad por día y por mes. Pasado cualquiera de los dos límites deja de aceptar, y los
   avisos no salen.

   Las dos decisiones —cómo se escribe cada número y cuándo hay que avisar— viven acá y no
   adentro de la pantalla, para que se puedan probar sin dibujar nada.

   SIN LÍMITE CARGADO NO SE INVENTA NINGUNO. El límite es del plan contratado y llega por
   configuración; cuando no está, se muestra el número solo. Poner uno de adorno haría creer que
   queda margen donde no se sabe cuánto queda. */

/** ¿Se alcanzó alguno de los dos límites? Sin límite cargado, no hay con qué decir que sí. */
export function seAlcanzoElLimite(correos) {
  if (!correos) return false;
  const dia = correos.tope_diario !== null && correos.del_dia >= correos.tope_diario;
  const mes = correos.tope_mensual !== null && correos.del_mes >= correos.tope_mensual;
  return dia || mes;
}

/** El texto de un período: «12 de 100», o «12, sin límite cargado». */
export function contraSuLimite(cantidad, tope, textos) {
  const plantilla = tope === null || tope === undefined ? textos.correos_sin_tope : textos.correos_de_tope;
  return plantilla.replace('{cantidad}', cantidad).replace('{tope}', tope);
}
