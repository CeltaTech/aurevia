import { supabase } from '../db/connection.js';

// EL PUNTO UNICO DE VERDAD PARA ESCRIBIR EL REGISTRO DE ACTIVIDAD.
//
// Que hace la gente de una Prestadora: quien, cuando, sobre que y que cambio. La tabla y el
// porque de su forma estan en
// `supabase/migrations/20261001110000_registro_de_actividad.sql`.
//
// Se escribe desde acá y desde ningun otro lado. Cada ruta que registra algo llama a una de
// estas funciones: si la misma decision se copiara ruta por ruta, el dia que cambie el nombre de
// una accion habria que acordarse de todas.
//
// POR QUE LO ESCRIBE EL MOTOR Y NO UN DISPARADOR DE LA BASE. El motor entra con la llave de
// servicio (decision escrita en el `CLAUDE.md` de Careonys), asi que adentro de un disparador
// `auth.uid()` da vacio y no habria forma de saber quien hizo la accion. Es el mismo motivo por
// el que la auditoria de la sesion de soporte tambien se escribe desde Express.
//
// NUNCA SE LE PASA UN DATO SENSIBLE. Ninguna clave, ningun dato de contenido, ninguna
// direccion, ningun importe y ninguna remuneracion. La base ademas lo hace cumplir: `detalle`
// solo admite las claves del catalogo `catalogo_datos_del_registro`, y lo que no este ahi hace
// fallar la escritura.

export const ACCION_ENTRADA_AL_PANEL = 'entrada_al_panel';
export const ACCION_ALTA_DE_CUENTA = 'alta_de_cuenta_del_panel';
export const ACCION_CAMBIO_DE_CUENTA = 'cambio_de_datos_de_cuenta_del_panel';
export const ACCION_BAJA_DE_CUENTA = 'baja_de_cuenta_del_panel';
export const ACCION_CAMBIO_DE_PERMISOS = 'cambio_de_permisos_de_la_prestadora';
export const ACCION_BORRADO_DE_DATOS = 'borrado_de_datos';
export const ACCION_MODIFICACION_CRITICA = 'modificacion_critica';
export const ACCION_CAMBIO_DE_MONEDA = 'cambio_de_moneda';

// Cada cuanto vuelve a anotarse la entrada al Panel de la misma cuenta. La sesion del Panel no
// pasa por ninguna ruta del motor al abrirse —la clave se valida contra Supabase directamente—,
// asi que la entrada se reconoce en el primer pedido que llega con esa cuenta. Sin esta ventana,
// cada pedido de la jornada dejaria un renglon de entrada y el registro se volveria ilegible.
// Se puede correr por ambiente sin publicar una version nueva.
const MINUTOS_ENTRE_ENTRADAS = Number(process.env.MINUTOS_ENTRE_ENTRADAS_REGISTRADAS ?? 60);

// Cuando se anoto por ultima vez la entrada de cada cuenta, en este proceso. Vive en memoria a
// proposito: preguntarle a la base en cada pedido costaria una consulta por pedido para no
// escribir nada. Si el motor se reinicia, lo unico que pasa es que la entrada se anota una vez
// mas, que es el lado seguro del error.
const ultimaEntrada = new Map();

// La Prestadora sale siempre de la sesion comprobada, nunca de lo que venga en el pedido.
// `req.usuarioPanel` lo arma `requiereRolPanel`, que resuelve la precedencia —sesion de soporte
// primero, Organizacion propia despues— con el mismo orden que la funcion SQL
// `interno.current_tenant()`.
export async function registrarActividad(usuarioPanel, accion, {
  tablaAfectada = null,
  registroId = null,
  camposCambiados = null,
  detalle = null,
} = {}) {
  // Falla cerrado, y en silencio: sin cuenta o sin Prestadora resuelta no hay a quien ni a que
  // atribuirle la accion, y una fila mal atribuida es peor que ninguna. No se interrumpe el
  // pedido por esto: el registro acompaña al trabajo, no lo bloquea.
  if (!usuarioPanel?.id || !usuarioPanel?.prestadoraId) return;

  const { error } = await supabase.from('registro_actividad').insert({
    prestadora_id: usuarioPanel.prestadoraId,
    usuario_id: usuarioPanel.id,
    accion,
    tabla_afectada: tablaAfectada,
    registro_id: registroId,
    campos_cambiados: camposCambiados,
    detalle,
  });

  if (error) console.error('Error escribiendo el registro de actividad:', error.message);
}

// La entrada administrativa. Se anota una vez por ventana y por cuenta.
export async function registrarEntradaAlPanel(usuarioPanel) {
  if (!usuarioPanel?.id || !usuarioPanel?.prestadoraId) return;

  const clave = `${usuarioPanel.id}:${usuarioPanel.prestadoraId}`;
  const ahora = Date.now();
  const anterior = ultimaEntrada.get(clave);
  if (anterior && ahora - anterior < MINUTOS_ENTRE_ENTRADAS * 60 * 1000) return;

  // Se marca antes de escribir para que dos pedidos que llegan juntos no dejen dos renglones.
  ultimaEntrada.set(clave, ahora);
  await registrarActividad(usuarioPanel, ACCION_ENTRADA_AL_PANEL);
}

// TODO BORRADO DE DATOS DEL PANEL, EN UN SOLO LUGAR.
//
// La regla de la empresa pide auditar el borrado de datos, y no el borrado de tal o cual cosa: si
// cada ruta que borra algo tuviera que acordarse de anotarlo, la que se olvide es justamente la
// que nadie va a notar. Por eso se engancha una sola vez, en `requiereRolPanel`, sobre cualquier
// pedido de borrado del Panel que haya terminado bien.
//
// Se anota que se borro y donde, nunca que se borro: recuperar el contenido no es trabajo de un
// registro de auditoria, y guardarlo ahi seria guardar dos veces el dato que alguien pidio sacar.
//
// La ruta se guarda sin lo que venga despues del signo de pregunta: ahi puede viajar cualquier
// cosa —un nombre, un correo, una busqueda— y nada de eso entra.
export function registrarBorradoDeDatos(usuarioPanel, metodo, ruta) {
  return registrarActividad(usuarioPanel, ACCION_BORRADO_DE_DATOS, {
    detalle: { metodo, ruta: String(ruta ?? '').split('?')[0] },
  });
}

// Cuando una ruta ya dejo su propio renglon, con un nombre que dice mejor lo que paso —dar de baja
// una cuenta del Panel es un cambio de membresia y no «un borrado»—, se marca acá para que el
// enganche general no escriba un segundo renglon de lo mismo.
export function yaQuedoRegistrado(res) {
  res.locals.actividadRegistrada = true;
}

export function faltaRegistrar(res) {
  return !res.locals?.actividadRegistrada;
}

// Que columnas cambiaron, sin sus valores. Es la forma de contestar «que cambio» sin guardar
// contenido de nadie: se guardan los nombres y, para verlos, se mira la fila.
export function camposQueCambiaron(cambios) {
  return Object.keys(cambios ?? {}).filter((campo) => cambios[campo] !== undefined);
}
