// ---------------------------------------------------------------------------
// correoDeAcceso.js — con qué correo se le habla al servicio de acceso
//
// POR QUÉ EXISTE. Una persona puede trabajar en varias Prestadoras, y en cada una tiene una
// cuenta distinta con su propia clave. El mismo correo en dos Prestadoras son dos cuentas: el
// error estaría en pensar que usar siempre el mismo correo obliga a tener una sola cuenta.
// Impedirle a alguien usar su correo en otra Prestadora sería una falla ética.
//
// El obstáculo es que el servicio de acceso exige que el correo no se repita en todo el sistema.
// Entonces el correo que se le entrega a ese servicio no es el que la persona escribe: es éste,
// que mete adentro de qué Prestadora se trata. La persona sigue escribiendo el suyo de siempre.
//
// QUÉ SE GUARDA. La parte que queda escrita del lado del servicio de acceso es un resumen del
// correo junto con la Prestadora, no el correo. Dos ventajas: el formato siempre es válido,
// venga el correo que venga; y el correo de una persona —que es dato personal— no queda escrito
// del lado del acceso, donde el aislamiento entre Prestadoras no se puede imponer. El correo de
// verdad vive en el Padrón, que sí está aislado.
//
// SE CALCULA SIEMPRE IGUAL Y SIN SECRETO. Un secreto acá no protegería nada que no esté ya
// protegido —para leer del lado del acceso hace falta la llave maestra— y el día que se perdiera
// dejaría a todo el mundo afuera sin forma de volver.
//
// NO SE CAMBIA NUNCA. Cambiar cómo se arma este texto es perder todas las cuentas: el servicio de
// acceso deja de encontrarlas. Es de lo que se guarda para siempre.
// ---------------------------------------------------------------------------

// Un dominio que no existe y que no puede existir: `.invalid` está reservado justamente para
// esto. Nadie recibe nada acá, y no hace falta: los avisos por correo los manda el motor a la
// dirección de verdad, con su propio enlace.
const DOMINIO_INTERNO = 'acceso.careonys.invalid';

/** El correo escrito por una persona, dejado comparable: sin espacios de más y sin mayúsculas. */
export function correoComparable(email) {
  return String(email ?? '').trim().toLowerCase();
}

/**
 * Con qué correo se le habla al servicio de acceso por esta persona en esta Prestadora.
 *
 * Es asíncrona porque el resumen lo calcula la plataforma, y del lado del navegador eso sólo
 * está disponible así. El mismo archivo corre en el motor y en las tres pantallas.
 */
export async function correoDeAcceso(email, prestadoraId) {
  const correo = correoComparable(email);
  const prestadora = String(prestadoraId ?? '').trim().toLowerCase();

  // Falla cerrado: sin Prestadora no hay cuenta que buscar ni que crear, y devolver algo igual
  // armaría una cuenta que no es de nadie. Ningún control se decide con un valor vacío.
  if (!correo) throw new Error('correoDeAcceso: falta el correo');
  if (!prestadora) throw new Error('correoDeAcceso: falta la Prestadora');

  const datos = new TextEncoder().encode(`${prestadora}:${correo}`);
  const resumen = await crypto.subtle.digest('SHA-256', datos);
  const texto = Array.from(new Uint8Array(resumen))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return `${texto}@${DOMINIO_INTERNO}`;
}
