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
  modalidad_con_accesos: 409,
  modalidad_con_asistentes_y_accesos: 409,
  // Dos avisos que antes viajaban como frase adentro del `Error` y que, al dejar de mandarse el
  // texto crudo, se habrían perdido: quien mira leería "algo falló de nuestro lado" cuando en
  // realidad no falló nada, sólo que lo que pidió no corresponde. El de la persona es 409 —el
  // pedido está bien armado, lo que pasa es que esa persona no es del círculo de esa Familia—;
  // el del Paciente es 404, y contesta lo mismo cuando el Paciente no existe y cuando es de otra
  // Prestadora, que desde afuera se tienen que ver iguales.
  persona_fuera_del_circulo: 409,
  paciente_no_encontrado: 404,
  // Las formas de cobro que arma la Prestadora. Son todos 400 salvo el nombre repetido, que es
  // 409 por lo mismo que el correo ya tomado: el pedido está bien armado y choca con algo que ya
  // existe. Cada uno nombra la pieza que está mal —el importe, el período, el saldo— porque quien
  // lo lee es quien la cargó y puede corregirla; ninguno nombra una columna ni una restricción.
  nombre_de_forma_repetido: 409,
  importe_invalido: 400,
  periodo_incompleto: 400,
  periodo_invalido: 400,
  unidad_de_periodo_desconocida: 400,
  dias_gratis_invalido: 400,
  contactos_incluidos_invalido: 400,
  renovacion_sin_periodo: 400,
  // La baja en un clic de un acceso del Marketplace. El acceso que no existe y el que es de otra
  // Familia contestan lo mismo: desde afuera se tienen que ver iguales. La forma que no se renueva
  // es 409 por lo mismo que el correo ya tomado —el pedido está bien armado y choca con lo que esa
  // forma es—, y no nombra ninguna columna. Los demás motivos de la baja no están acá a propósito:
  // caen en 500, que es lo honesto, porque son fallas de este lado o del proveedor.
  acceso_inexistente: 404,
  forma_que_no_se_renueva: 409,
  // El tope de pedidos por minuto (pendiente #177). Es el mismo 429 que los intentos agotados,
  // porque para la web es la misma situación —"probó demasiadas veces"—, pero el motivo es otro
  // y la pantalla dice otra cosa: los intentos agotados no se arreglan esperando, y esto sí.
  demasiados_pedidos: 429,
};

// Lo que una ruta contesta cuando algo falló. Se escribe una sola vez para que ninguna ruta
// se olvide de mandar el motivo, que es justamente lo que le permite a la pantalla explicar.
//
// Y ES EL ÚNICO LUGAR QUE DECIDE QUÉ SALE HACIA AFUERA. El texto crudo de un error de la base
// describe la base: nombra tablas, columnas y restricciones —"insert or update on table
// facturas_familia_items violates foreign key constraint …"— y eso no puede llegar nunca al
// navegador (`../../../CLAUDE.md` §6). Acá el detalle se queda del lado del servidor y afuera
// va únicamente el motivo, que es un código.
//
// Además no se pierde nada al no mandarlo. `panel/src/lib/errores.js` clasifica por motivo y
// por código de respuesta, y el código de respuesta se mira **antes** que el texto: un 500
// cae en "falla del sistema" sin leer una sola letra del mensaje. O sea que ese texto crudo
// viajaba entero hasta el navegador para que la pantalla lo descartara.
//
// `error` sigue viniendo en el cuerpo, y sigue siendo un código y no una frase: hay pantallas
// que lo leen para armar su propio Error. Nunca es texto para mostrarle a nadie — la frase
// vive en las traducciones, en los tres idiomas.
const SIN_MOTIVO = 'falla_del_sistema';

export function responderError(res, error, estadoPorOmision = 500) {
  const estado = ESTADO_POR_MOTIVO[error?.motivo] ?? estadoPorOmision;
  const motivo = error?.motivo ?? SIN_MOTIVO;

  // El detalle, acá. Es lo que hay que mirar cuando algo falla, y el único lugar donde está.
  const donde = res?.req ? `${res.req.method} ${res.req.originalUrl ?? res.req.url}` : 'sin ruta';
  console.error(`[${estado}] ${donde} — ${motivo}:`, error?.message ?? error);

  const cuerpo = error?.motivo ? { error: motivo, motivo } : { error: motivo };
  return res.status(estado).json(cuerpo);
}
