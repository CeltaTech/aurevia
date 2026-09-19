import crypto from 'crypto';
import { supabase } from '../db/connection.js';
import { ErrorConMotivo } from './errorConMotivo.js';
import { correoComparable } from '../config/correoDeAcceso.js';
import { enviarEmail } from './email.js';
import { IDENTIDAD } from '../config/identidadProducto.js';
import { marcaDeLaPrestadora } from './marcaPrestadora.js';
import { aviso } from '../i18n/avisos.js';
import { idiomaDelDestinatario } from '../i18n/idiomas.js';
import { idiomaDeLaPrestadora } from '../i18n/idiomaDeLaPrestadora.js';
import { avisarDeSeguridad, AVISO_CLAVE_RECUPERADA } from './avisoDeSeguridad.js';
import {
  mandarCodigoAlTelefono,
  comprobarCodigoDelTelefono,
  USO_RECUPERAR,
} from './codigoAlTelefono.js';
import { elTelefonoSirveDeSegundoFactor } from './segundoFactorDelTelefono.js';
import {
  cambioDeClaveHabilitado,
  usarCambioDeClaveHabilitado,
} from './habilitarCambioDeClave.js';
import { seAgotaronLosPedidosDeClave, anotarPedidoDeClave } from './topeDePedidosDeClave.js';

// EL ENLACE DURA POCO, y menos que el de activación.
//
// Uno activa una cuenta que todavía no se usó; éste abre una que está en uso. Un enlace que
// reemplaza la clave de una cuenta viva vale tanto como la clave, así que cuanto menos tiempo
// esté vivo en una casilla de correo, mejor. Siete días serían siete días de puerta abierta.
const HORAS_VALIDEZ = 2;

const ROLES_DE_PANEL = ['superadmin', 'admin_prestadora', 'coordinador'];

// A qué pantalla manda el enlace. Es el mismo reparto que el de la activación, y por el mismo
// motivo: cada rol entra por una puerta distinta, y un enlace a la puerta equivocada deja a la
// persona afuera sin entender por qué.
function urlAppPorRol(rol) {
  if (rol === 'asistente') return process.env.PWA_ASISTENTES_URL;
  if (ROLES_DE_PANEL.includes(rol)) return process.env.PANEL_URL;
  return process.env.PWA_FAMILIAS_URL;
}

/**
 * Manda el enlace para elegir una clave nueva, si ese correo tiene cuenta.
 *
 * SE RECUPERA LA CLAVE DE UNA PRESTADORA, no la de un correo. El mismo correo tiene una cuenta
 * distinta en cada Prestadora donde la persona trabaja, con su propia clave, así que sin saber de
 * cuál se trata no hay ninguna clave que reemplazar. La Prestadora sale de la puerta por donde se
 * entró —la dirección propia de esa Prestadora—, nunca de lo que venga en el pedido.
 *
 * NO CONTESTA SI EL CORREO EXISTE, y por eso no devuelve nada y no falla cuando no encuentra a
 * nadie. Quien pregunta acá no tiene sesión: si la respuesta cambiara según el correo, esta
 * pantalla sería una forma de averiguar quién trabaja en qué Prestadora, preguntando de a un
 * correo por vez. La pantalla dice siempre lo mismo. Y un correo que existe en otra Prestadora se
 * trata igual que uno que no existe en ninguna.
 *
 * Lo que sí queda es constancia en el registro del servidor, sin el correo, porque es un dato
 * personal.
 */
export async function pedirRecuperacionDeClave(email, prestadoraId) {
  if (!prestadoraId) {
    console.warn('recuperacionDeClave: se pidió una clave nueva sin saber de qué Prestadora');
    return;
  }

  // EL TOPE SE MIRA ANTES DE BUSCAR LA CUENTA, y el pedido se anota exista el correo o no
  // (`utils/topeDePedidosDeClave.js`). Si sólo contaran los correos con cuenta, quedarse sin
  // pedidos sería la señal de que ese correo existe.
  if (await seAgotaronLosPedidosDeClave(prestadoraId, email)) {
    console.warn('recuperacionDeClave: se alcanzó el tope de pedidos por hora para un correo');
    return;
  }
  await anotarPedidoDeClave(prestadoraId, email);

  // La cuenta se busca en la Prestadora por donde se entró. Es la misma tabla que impone que ese
  // correo no se repita adentro de una, así que acá hay una fila o ninguna.
  const { data: usuario } = await supabase
    .from('usuarios')
    .select('id, nombre, rol, prestadora_id')
    .eq('prestadora_id', prestadoraId)
    .eq('email', correoComparable(email))
    .maybeSingle();

  if (!usuario) {
    console.warn('recuperacionDeClave: se pidió una clave nueva para un correo sin cuenta');
    return;
  }

  const appUrl = urlAppPorRol(usuario.rol);
  if (!appUrl) {
    console.error(`recuperacionDeClave: falta la variable de entorno para el rol "${usuario.rol}"`);
    return;
  }

  // Los enlaces anteriores de esa cuenta se dan por usados antes de emitir el nuevo: pedir dos
  // veces no deja dos puertas abiertas, deja una.
  await supabase
    .from('tokens_recuperacion_clave')
    .update({ usado_en: new Date().toISOString() })
    .eq('usuario_id', usuario.id)
    .is('usado_en', null);

  const token = crypto.randomBytes(32).toString('base64url');
  const expiraEn = new Date(Date.now() + HORAS_VALIDEZ * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('tokens_recuperacion_clave')
    .insert({ usuario_id: usuario.id, token, expira_en: expiraEn });
  if (error) throw new Error(error.message);

  const link = `${appUrl}/clave-nueva?token=${token}`;
  const marca = await marcaDeLaPrestadora(usuario.prestadora_id);
  const textos = aviso(
    'recuperacion_clave',
    idiomaDelDestinatario(null, await idiomaDeLaPrestadora(usuario.prestadora_id)),
    {
      nombre: usuario.nombre,
      link,
      horas: HORAS_VALIDEZ,
      empresa: marca?.nombre || IDENTIDAD.nombre,
      producto: IDENTIDAD.nombre,
    },
  );
  await enviarEmail({ to: email, asunto: textos.asunto, texto: textos.texto, formato: textos.html });
}

/**
 * El enlace, comprobado. Los tres motivos viajan sin detalle, igual que en la activación: el código
 * ya dice todo lo que hay para decir, y los tres se resuelven distinto.
 */
async function filaDelEnlace(token) {
  const { data: fila, error } = await supabase
    .from('tokens_recuperacion_clave')
    .select('id, usuario_id, expira_en, usado_en')
    .eq('token', token)
    .maybeSingle();

  if (error || !fila) throw new ErrorConMotivo('token_invalido');
  if (fila.usado_en) throw new ErrorConMotivo('token_ya_usado');
  if (new Date(fila.expira_en) < new Date()) throw new ErrorConMotivo('token_vencido');
  return fila;
}

async function cuentaDelEnlace(usuarioId) {
  const { data } = await supabase
    .from('usuarios')
    .select('id, nombre, email, telefono, telefono_verificado_en, prestadora_id')
    .eq('id', usuarioId)
    .maybeSingle();
  return data ?? null;
}

async function haceFaltaElCodigo(usuarioId) {
  const cuenta = await cuentaDelEnlace(usuarioId);
  if (!cuenta) return false;
  return elTelefonoSirveDeSegundoFactor(cuenta);
}

/** La puerta que la Prestadora dejó abierta para esta cuenta, si hay alguna viva. */
async function puertaAbiertaParaLaCuenta(usuarioId) {
  return cambioDeClaveHabilitado(usuarioId);
}

/**
 * El segundo paso de la recuperación: el código al teléfono.
 *
 * SE PIDE DESPUÉS DEL ENLACE Y NO ANTES. Quien llega acá ya probó que lee el correo de esa cuenta,
 * así que contestar si hace falta un código no le dice nada que no supiera. Preguntarlo antes del
 * enlace convertiría esta puerta en una forma de averiguar quién tiene teléfono cargado en qué
 * Prestadora, preguntando de a un correo por vez.
 *
 * NO DEVUELVE EL NÚMERO, ni entero ni tapado: la pantalla no lo necesita para pedirle a alguien que
 * mire su teléfono.
 *
 * Y CUANDO LA PRESTADORA YA HABILITÓ EL CAMBIO, no se pide nada. Es el paso 17: quien llamó por
 * teléfono ya fue reconocido por una persona, y ésa es la salida cuando el segundo factor no se
 * puede cumplir —número perdido, número viejo, teléfono robado—.
 *
 * @returns {Promise<{ requiereCodigo: boolean, vence: string|null }>}
 */
export async function segundoFactorDelEnlace(token) {
  const fila = await filaDelEnlace(token);

  if (await puertaAbiertaParaLaCuenta(fila.usuario_id)) {
    return { requiereCodigo: false, vence: null };
  }

  const cuenta = await cuentaDelEnlace(fila.usuario_id);
  if (!cuenta || !(await elTelefonoSirveDeSegundoFactor(cuenta))) {
    return { requiereCodigo: false, vence: null };
  }

  const { vence } = await mandarCodigoAlTelefono({ usuario: cuenta, uso: USO_RECUPERAR });
  return { requiereCodigo: true, vence };
}

/**
 * Canjea el enlace por la clave nueva.
 *
 * El enlace se toma antes de tocar la clave, condicionado a que siga libre, por lo mismo que en
 * la activación: son dos sistemas distintos y no hay transacción que los abarque. Tomándolo
 * primero, dos pedidos simultáneos con el mismo enlace no pasan los dos, y un enlace de un solo
 * uso no queda sirviendo de nuevo si la segunda escritura falla.
 */
export async function cambiarClaveConToken(token, claveNueva, codigo = null) {
  const fila = await filaDelEnlace(token);

  // EL SEGUNDO FACTOR SE COMPRUEBA ANTES DE TOMAR EL ENLACE. Al revés, escribir mal el código
  // quemaría el enlace y dejaría a la persona sin forma de entrar, que es justo lo contrario de lo
  // que esta pantalla viene a resolver.
  const puerta = await puertaAbiertaParaLaCuenta(fila.usuario_id);
  if (!puerta && (await haceFaltaElCodigo(fila.usuario_id))) {
    if (!codigo) throw new ErrorConMotivo('faltan_datos');
    await comprobarCodigoDelTelefono({ usuarioId: fila.usuario_id, uso: USO_RECUPERAR, codigo });
  }

  const { data: tomado, error: errorTomar } = await supabase
    .from('tokens_recuperacion_clave')
    .update({ usado_en: new Date().toISOString() })
    .eq('id', fila.id)
    .is('usado_en', null)
    .select('id')
    .maybeSingle();
  if (errorTomar) throw new Error(errorTomar.message);
  if (!tomado) throw new ErrorConMotivo('token_ya_usado');

  const { error: errorClave } = await supabase.auth.admin.updateUserById(fila.usuario_id, {
    password: claveNueva,
  });
  if (errorClave) {
    await supabase.from('tokens_recuperacion_clave').update({ usado_en: null }).eq('id', fila.id);
    throw new Error(errorClave.message);
  }

  // La puerta se gasta recién ahora, con la clave ya cambiada. Gastarla antes dejaría a esa persona
  // sin puerta y sin clave nueva si lo de abajo fallaba, y volver a abrirla exige otro llamado.
  if (puerta) await usarCambioDeClaveHabilitado(puerta.id);

  // Y queda avisado. Es el aviso que le llega a alguien a quien le cambiaron la clave sin que él lo
  // pidiera, y es la única forma que tiene de enterarse. Sale después de que la clave ya cambió: un
  // aviso de algo que al final no pasó es peor que ninguno.
  const { data: cuenta } = await supabase
    .from('usuarios')
    .select('id, nombre, email, prestadora_id')
    .eq('id', fila.usuario_id)
    .maybeSingle();
  if (cuenta) await avisarDeSeguridad(AVISO_CLAVE_RECUPERADA, cuenta);
}
