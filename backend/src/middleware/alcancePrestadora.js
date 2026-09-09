// Punto único de verdad del alcance por Organización en las rutas del Panel (CLAUDE.md §7.12).
//
// Por qué existe este archivo (pendiente #98, cerrado el 2026-07-28):
// las rutas del Panel no consultan la base con las credenciales del usuario —usan la clave de
// servicio, que se saltea las reglas de aislamiento RLS—, así que el filtro por Organización lo
// tiene que poner el código. Hasta hoy ese filtro estaba escrito 40 veces con esta forma:
//
//     if (req.usuarioPanel.rol !== 'superadmin') {
//       query = query.eq('prestadora_id', req.usuarioPanel.prestadoraId);
//     }
//
// O sea: si el rol era superadmin, no se filtraba nada, y podía leer y escribir datos de
// cualquier Prestadora sin abrir la sesión de soporte técnico y sin quedar auditado. Eso
// contradecía de frente a CLAUDE.md §5 ("Si una tarea técnica requiere operar sobre una
// Prestadora real, se hace siempre abriendo una sesión de soporte técnico").
//
// Ya no hace falta ninguna rama por rol: requiereRolPanel.js deja en
// req.usuarioPanel.prestadoraId la Prestadora correcta para cualquier rol —la de la sesión de
// soporte si hay una abierta, la Organización propia si no—, con el mismo orden de precedencia
// que la función SQL current_tenant(). Filtrar siempre por ese valor es a la vez más simple y
// más seguro.

// Error de programación, no de uso: significa que una ruta llamó a acotarAPrestadora() sin
// haber exigido antes una Organización activa. Se corta en vez de dejar pasar una consulta sin
// filtro, que es exactamente lo que este archivo vino a impedir.
class SinOrganizacionActiva extends Error {}

/**
 * Acota una consulta de Supabase a la Organización activa del usuario del Panel.
 * Se aplica igual a lecturas, actualizaciones y borrados. Nunca tiene excepciones por rol.
 */
export function acotarAPrestadora(query, usuarioPanel) {
  const prestadoraId = usuarioPanel?.prestadoraId;
  if (!prestadoraId) {
    throw new SinOrganizacionActiva(
      'acotarAPrestadora() sin Organización activa: falta exigirOrganizacionActiva en esta ruta'
    );
  }
  return query.eq('prestadora_id', prestadoraId);
}

/**
 * Middleware: corta con un error entendible cuando no hay ninguna Organización sobre la que
 * operar. Le pasa a un Superadmin sin Organización propia que todavía no abrió una sesión de
 * soporte técnico. Sin este corte, prestadoraId llega vacío a las consultas de abajo.
 */
export function exigirOrganizacionActiva(req, res, next) {
  if (!req.usuarioPanel?.prestadoraId) {
    return res.status(400).json({ error: 'Hace falta entrar a una prestadora antes de operar sobre sus datos' });
  }
  next();
}

/**
 * Las dos únicas cosas de las que depende el alcance sobre la tabla `usuarios`: sobre qué
 * Organización se está trabajando ahora, y si además se alcanza al equipo técnico de CeltaTech.
 *
 * Se derivan acá una sola vez, y no en cada lugar que las necesita, para que la consulta
 * filtrada de abajo y la comprobación en memoria que le sigue no puedan discrepar sobre quién
 * es Superadmin ni sobre cuál es la Organización activa.
 */
export function alcanceDelPanel(usuarioPanel) {
  return {
    prestadoraId: usuarioPanel?.prestadoraId ?? null,
    esSuperadmin: usuarioPanel?.rol === 'superadmin',
  };
}

/**
 * Caso aparte, y el único: las cuentas de Panel con rol superadmin no pertenecen a ninguna
 * Organización (su prestadora_id es nulo — lo exige la restricción
 * usuarios_prestadora_id_solo_superadmin_null). No son datos de una Prestadora sino del equipo
 * técnico de CeltaTech, así que un filtro por prestadora_id las dejaría siempre afuera y
 * Superadmin no podría gestionar las cuentas de su propio equipo.
 *
 * Por eso, y solo en la tabla `usuarios`: se ven las cuentas de la Organización activa **más**
 * las cuentas superadmin. Una Prestadora nunca ve estas últimas, porque para llegar acá ya hay
 * que ser superadmin (lo verifica la ruta antes de llamar).
 */
export function acotarAUsuariosDelPanel(query, usuarioPanel) {
  const { prestadoraId, esSuperadmin } = alcanceDelPanel(usuarioPanel);
  if (!esSuperadmin) {
    return acotarAPrestadora(query, usuarioPanel);
  }
  if (!prestadoraId) {
    // Superadmin sin Organización activa: solo su propio equipo, ninguna Prestadora.
    return query.eq('rol', 'superadmin');
  }
  return query.or(`prestadora_id.eq.${prestadoraId},rol.eq.superadmin`);
}

/**
 * La misma regla que `acotarAUsuariosDelPanel` le pone a una consulta, preguntada sobre una fila
 * que ya se leyó. Contesta si esa cuenta del Panel está al alcance de quien pide.
 *
 * Por qué hace falta la segunda forma (pendiente #157): un filtro no protege a quien no consulta
 * filtrando. `borrarCuenta` (`utils/cuentasPanel.js`) recibe un identificador y borra, así que
 * necesita preguntar, no filtrar — y hasta el 2026-09-09 tenía su propia copia de esta regla,
 * más floja: se salteaba entera cuando quien pedía era Superadmin. Ahora la ruta y la función
 * preguntan las dos acá, y las dos formas de la regla viven juntas a propósito, para que nadie
 * pueda cambiar una sin ver la otra.
 *
 * `cuenta` es la fila de `usuarios` como sale de la base (`{ rol, prestadora_id }`) y tiene que
 * traer las dos columnas: sin `rol` no se puede reconocer al equipo técnico. `alcance` es lo que
 * devuelve `alcanceDelPanel`.
 *
 * Falla cerrado: sin fila, sin alcance, sin rol conocido o sin Organización con la cual comparar,
 * se niega. En particular, dos cuentas sin Organización **no** son de la misma Organización: la
 * comparación exige que los dos valores existan, porque un permiso resuelto comparando dos
 * vacíos deja pasar justamente el caso que no se entendió.
 */
export function laCuentaDelPanelEstaAlAlcance(cuenta, alcance) {
  if (!cuenta || !alcance) return false;

  // La misma excepción que explica el `.or()` de arriba, y ninguna otra: las cuentas superadmin
  // son del equipo técnico de CeltaTech y no cuelgan de ninguna Organización, así que ningún
  // filtro por Organización las encuentra. Sólo las alcanza otro Superadmin.
  if (cuenta.rol === 'superadmin') return alcance.esSuperadmin === true;

  const organizacionDeLaCuenta = cuenta.prestadora_id ?? null;
  const organizacionActiva = alcance.prestadoraId ?? null;
  if (!organizacionDeLaCuenta || !organizacionActiva) return false;
  return organizacionDeLaCuenta === organizacionActiva;
}
