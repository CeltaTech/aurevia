import crypto from 'crypto';
import { supabase } from '../db/connection.js';
import { ErrorConMotivo } from './errorConMotivo.js';
import { buscarCuentaDeAcceso } from './cuentasPanel.js';
import { enviarEmail } from './email.js';
import { IDENTIDAD } from '../config/identidadProducto.js';
import { marcaDeLaPrestadora } from './marcaPrestadora.js';
import { aviso } from '../i18n/avisos.js';
import { idiomaDelDestinatario } from '../i18n/idiomas.js';
import { idiomaDeLaPrestadora } from '../i18n/idiomaDeLaPrestadora.js';

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
 * NO CONTESTA SI EL CORREO EXISTE, y por eso no devuelve nada y no falla cuando no encuentra a
 * nadie. Quien pregunta acá no tiene sesión: si la respuesta cambiara según el correo, esta
 * pantalla sería una forma de averiguar quién trabaja en qué Prestadora, preguntando de a un
 * correo por vez. La pantalla dice siempre lo mismo.
 *
 * Lo que sí queda es constancia en el registro del servidor, sin el correo, porque es un dato
 * personal.
 */
export async function pedirRecuperacionDeClave(email) {
  const cuenta = await buscarCuentaDeAcceso(email);
  if (!cuenta) {
    console.warn('recuperacionDeClave: se pidió una clave nueva para un correo sin cuenta');
    return;
  }

  const { data: usuario } = await supabase
    .from('usuarios')
    .select('nombre, rol, prestadora_id')
    .eq('id', cuenta.id)
    .maybeSingle();

  // Cuenta de acceso sin ficha: es el sobrante de un alta que se cortó por la mitad, y con ella
  // no se entra a ningún lado. No hay nada que recuperar.
  if (!usuario) {
    console.warn('recuperacionDeClave: la cuenta no tiene ficha, no se manda nada', cuenta.id);
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
    .eq('usuario_id', cuenta.id)
    .is('usado_en', null);

  const token = crypto.randomBytes(32).toString('base64url');
  const expiraEn = new Date(Date.now() + HORAS_VALIDEZ * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('tokens_recuperacion_clave')
    .insert({ usuario_id: cuenta.id, token, expira_en: expiraEn });
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
 * Canjea el enlace por la clave nueva.
 *
 * El enlace se toma antes de tocar la clave, condicionado a que siga libre, por lo mismo que en
 * la activación: son dos sistemas distintos y no hay transacción que los abarque. Tomándolo
 * primero, dos pedidos simultáneos con el mismo enlace no pasan los dos, y un enlace de un solo
 * uso no queda sirviendo de nuevo si la segunda escritura falla.
 */
export async function cambiarClaveConToken(token, claveNueva) {
  const { data: fila, error: errorFila } = await supabase
    .from('tokens_recuperacion_clave')
    .select('id, usuario_id, expira_en, usado_en')
    .eq('token', token)
    .maybeSingle();

  // Los tres motivos viajan sin detalle, igual que en la activación: el código ya dice todo lo
  // que hay para decir, y los tres se resuelven distinto.
  if (errorFila || !fila) throw new ErrorConMotivo('token_invalido');
  if (fila.usado_en) throw new ErrorConMotivo('token_ya_usado');
  if (new Date(fila.expira_en) < new Date()) throw new ErrorConMotivo('token_vencido');

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
}
