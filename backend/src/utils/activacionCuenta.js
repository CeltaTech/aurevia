import crypto from 'crypto';
import { supabase } from '../db/connection.js';
import { correoDe } from './correoDeUnaPersona.js';
import { ErrorConMotivo } from './errorConMotivo.js';
import { enviarEmail } from './email.js';
import { IDENTIDAD } from '../config/identidadProducto.js';
import { marcaDeLaPrestadora } from './marcaPrestadora.js';
import { aviso } from '../i18n/avisos.js';
import { idiomaDelDestinatario } from '../i18n/idiomas.js';
import { idiomaDeLaPrestadora } from '../i18n/idiomaDeLaPrestadora.js';

const DIAS_VALIDEZ_TOKEN = 7;

// URL pública de la PWA correspondiente al rol de la cuenta nueva — nunca hardcodeada
// (CLAUDE.md §7 regla 1), viene de variables de entorno propias por app (backend/.env.example).
const ROLES_DE_PANEL = ['superadmin', 'admin_prestadora', 'coordinador'];

// A qué pantalla manda el link de activación. Cada rol entra por una puerta distinta, y un link
// a la puerta equivocada no es un detalle estético: la persona no tiene cuenta ahí y se queda
// afuera sin entender por qué.
function urlAppPorRol(rol) {
  if (rol === 'asistente') return process.env.PWA_ASISTENTES_URL;
  if (ROLES_DE_PANEL.includes(rol)) return process.env.PANEL_URL;
  return process.env.PWA_FAMILIAS_URL;
}

// Punto único de verdad: genera el token de un solo uso y manda el email de activación por
// el SMTP que ya existe (email.js) — usado por crearCuentaConPerfil cuando la cuenta nueva es de
// Familia/Asistente/Círculo, y también para el administrador que se crea al dar de alta una
// Prestadora (`routes/panelPrestadoras.js`): esa persona tampoco tiene a quién pedirle su clave,
// porque quien la dio de alta es de CeltaTech y no puede ver ni elegir la contraseña de nadie.
// Las demás cuentas de Panel —las que una Prestadora crea para su propio equipo— siguen con el
// camino de siempre, en el que quien la crea comunica la primera clave.
export async function invitarActivacionCuenta({ usuarioId, email, nombre, rol, prestadoraId = null, idioma = null }) {
  const appUrl = urlAppPorRol(rol);
  if (!appUrl) {
    // Sin URL configurada (ej. entorno local sin la variable seteada) no se puede armar un
    // link válido — se registra y se sigue sin romper el alta de la cuenta, en vez de fallar
    // toda la operación por un email que de todos modos no se podría entregar bien.
    console.error(`invitarActivacionCuenta: falta la variable de entorno para el rol "${rol}", no se envió el email de activación`);
    return;
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const expiraEn = new Date(Date.now() + DIAS_VALIDEZ_TOKEN * 24 * 60 * 60 * 1000).toISOString();

  const { error } = await supabase
    .from('tokens_activacion_cuenta')
    .insert({ usuario_id: usuarioId, token, expira_en: expiraEn });
  if (error) throw new Error(error.message);

  // Este correo lo recibe una Familia o un Asistente, y para ellos la empresa es la Prestadora: es
  // a quien llamaron, con quien firmaron y de quien esperan un correo. Por eso el nombre que va
  // adelante es el de ella, no el del producto. El producto queda en la línea del pie, que va
  // siempre.
  //
  // Si la marca llegara vacía se usa el nombre del producto: es preferible un correo que dice
  // Careonys a uno que dice «Activación de la cuenta en undefined».
  const link = `${appUrl}/activar-cuenta?token=${token}`;
  const marca = await marcaDeLaPrestadora(prestadoraId);
  const textos = aviso('activacion_cuenta', idiomaDelDestinatario(idioma, await idiomaDeLaPrestadora(prestadoraId)), {
    nombre,
    link,
    dias: DIAS_VALIDEZ_TOKEN,
    empresa: marca?.nombre || IDENTIDAD.nombre,
    producto: IDENTIDAD.nombre,
  });
  await enviarEmail({ to: email, asunto: textos.asunto, texto: textos.texto, formato: textos.html });
}

// Usado tanto por el alta inicial como por "Reenviar invitación" (token vencido o extraviado).
export async function reenviarActivacionCuenta(usuarioId) {
  const { data: usuario, error: errorUsuario } = await supabase
    .from('usuarios')
    .select('nombre, rol, prestadora_id')
    .eq('id', usuarioId)
    .single();
  if (errorUsuario || !usuario) throw new Error('Cuenta no encontrada');

  // El correo no está en `usuarios` — ver `correoDeUnaPersona.js`. Sin él no hay a dónde mandar
  // la invitación, y decirlo así es distinto de decir que la cuenta no existe.
  const email = await correoDe(usuarioId);
  if (!email) throw new Error('La cuenta no tiene correo');

  await invitarActivacionCuenta({
    usuarioId,
    email,
    nombre: usuario.nombre,
    rol: usuario.rol,
    prestadoraId: usuario.prestadora_id,
  });
}

// Consumido por el endpoint público POST /api/activar-cuenta — valida el token (existe, no
// vencido, no usado), fija la contraseña real elegida por la persona, y lo marca usado.
// Nunca expone a qué Prestadora pertenece la cuenta ni ningún otro dato del usuario.
export async function activarCuentaConToken(token, passwordNueva) {
  const { data: fila, error: errorFila } = await supabase
    .from('tokens_activacion_cuenta')
    .select('id, usuario_id, expira_en, usado_en')
    .eq('token', token)
    .maybeSingle();

  // Los tres avisos viajan como motivo hasta la pantalla, que los explica en el idioma de
  // quien mira: son tres problemas distintos y se resuelven distinto —el enlace equivocado se
  // vuelve a abrir desde el correo, el ya usado se saltea entrando por la pantalla de ingreso,
  // y el vencido obliga a pedir una invitación nueva—. Van sin detalle a propósito: el código
  // ya dice todo lo que hay para decir, y un detalle acá solo reemplazaría el código en la
  // respuesta sin quedar registrado en ningún lado.
  if (errorFila || !fila) throw new ErrorConMotivo('token_invalido');
  if (fila.usado_en) throw new ErrorConMotivo('token_ya_usado');
  if (new Date(fila.expira_en) < new Date()) throw new ErrorConMotivo('token_vencido');

  const { error: errorPassword } = await supabase.auth.admin.updateUserById(fila.usuario_id, { password: passwordNueva });
  if (errorPassword) throw new Error(errorPassword.message);

  await supabase.from('tokens_activacion_cuenta').update({ usado_en: new Date().toISOString() }).eq('id', fila.id);
}
