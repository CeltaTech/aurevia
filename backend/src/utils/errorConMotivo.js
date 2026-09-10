// Un error que la pantalla puede explicar.
//
// El problema que resuelve: hasta ahora, cuando algo fallaba adentro del motor, lo único que
// subía era el texto crudo del error. Ese texto está escrito para quien programa —a veces
// derecho en inglés, como "A user with this email address has already been registered"— y
// `lib/errores.js` del Panel no tiene forma de reconocerlo, así que termina mostrando una
// frase genérica. Quien está del otro lado lee "Algo falló de nuestro lado" y se queda sin
// saber qué pasó ni qué hacer.
//
// La solución es la que ya usaba el cierre de guardia (`routes/appAsistentes.js`): el motor
// manda un **motivo**, que es un código —`correo_ya_tomado`, `sin_etapas_incorporacion`—, y
// la frase vive en las traducciones, en los tres idiomas. Nunca se manda la frase desde acá:
// el motor no sabe en qué idioma está mirando la persona, y una frase escrita en el código
// sería texto visible a mano (reglas 1 y 2 de CLAUDE.md §7).
//
// Esta clase existe para que ese mecanismo también funcione cuando el aviso nace adentro de
// una función auxiliar y tiene que atravesar varios `throw` hasta llegar a la ruta.
export class ErrorConMotivo extends Error {
  // `motivo` es el código que la pantalla traduce. `detalle` es para el registro del
  // servidor y para quien programa — nunca se muestra tal cual.
  constructor(motivo, detalle) {
    super(detalle || motivo);
    this.name = 'ErrorConMotivo';
    this.motivo = motivo;
  }
}

// Qué código de respuesta le corresponde a cada motivo. Los códigos son el idioma común de
// la web: 400 es "el pedido vino mal armado", 409 es "el pedido está bien pero choca con
// algo que ya existe", 500 es "se rompió algo de este lado". Que un correo ya tomado
// viajara como 500 no era un detalle: la pantalla trata el 500 como falla del sistema y
// tapa cualquier explicación con "Algo falló de nuestro lado".
const ESTADO_POR_MOTIVO = {
  correo_de_esta_prestadora: 409,
  correo_de_otra_cuenta: 409,
  sin_etapas_incorporacion: 409,
  faltan_datos: 400,
  password_debil: 400,
  token_invalido: 400,
  token_ya_usado: 400,
  token_vencido: 400,
  // El pase de guardia (pendiente #113). 404 cuando el pedido no existe o es de otra
  // Prestadora —desde afuera las dos cosas se tienen que ver iguales—, 409 cuando el pedido
  // está bien pero alguien ya lo resolvió, y 429 cuando se agotaron los intentos, que es el
  // código que la web reserva para "probó demasiadas veces".
  no_encontrado: 404,
  ya_comprobada: 409,
  ya_resuelta: 409,
  ya_cerrada: 409,
  no_corresponde: 409,
  codigo_incorrecto: 400,
  codigo_vencido: 400,
  demasiados_intentos: 429,
  // Apagar una modalidad de negocio que todavía tiene algo colgando. Es 409 por lo mismo que
  // un correo ya tomado: el pedido está bien armado, lo que pasa es que choca con algo que ya
  // existe y que hay que resolver antes.
  modalidad_con_asistentes: 409,
  modalidad_con_suscripciones: 409,
  modalidad_con_asistentes_y_suscripciones: 409,
  // El tope de pedidos por minuto (pendiente #177). Es el mismo 429 que los intentos agotados,
  // porque para la web es la misma situación —"probó demasiadas veces"—, pero el motivo es otro
  // y la pantalla dice otra cosa: los intentos agotados no se arreglan esperando, y esto sí.
  demasiados_pedidos: 429,
};

// Lo que una ruta contesta cuando algo falló. Se escribe una sola vez para que ninguna ruta
// se olvide de mandar el motivo, que es justamente lo que le permite a la pantalla explicar.
export function responderError(res, error, estadoPorOmision = 500) {
  const estado = ESTADO_POR_MOTIVO[error?.motivo] ?? estadoPorOmision;
  const cuerpo = error?.motivo ? { error: error.message, motivo: error.motivo } : { error: error.message };
  return res.status(estado).json(cuerpo);
}
