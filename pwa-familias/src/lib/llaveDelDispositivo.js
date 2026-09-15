/**
 * La llave que guarda este teléfono, del lado del navegador.
 * ==========================================================
 *
 * ORIGINAL. La copia de `pwa-familias/` se regenera con `scripts/sincronizar_copias.mjs` y nunca
 * se edita a mano (`CLAUDE.md` §6). Por eso acá no hay una sola palabra propia de ninguna de las
 * dos aplicaciones: el rol y la puerta los pone quien llama.
 *
 * QUÉ HACE Y QUÉ NO. Pide el desafío, se lo da al navegador para que el teléfono lo firme con la
 * llave que guarda adentro, y devuelve la firma. La huella y la cara no pasan por acá ni por
 * ningún otro lado del producto: las mira el propio aparato para destrabar su llave, y lo único
 * que sale es la firma.
 *
 * LA ENTRADA NO PREGUNTA EL CORREO. La llave se dio de alta como «detectable», así que el teléfono
 * sabe cuál ofrecer sin que nadie se lo diga. Pedir el correo antes convertiría esta pantalla en
 * una manera de averiguar quién tiene cuenta.
 *
 * Y LA SESIÓN NACE DONDE NACEN TODAS. El motor no arma ninguna sesión por su cuenta: devuelve un
 * pase de un solo uso y acá se canjea con `verifyOtp`, que es el mismo camino del enlace de
 * entrada por correo.
 */
import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { supabase } from './supabaseClient';
import { errorDeLaRespuesta } from './errores';

const API_URL = import.meta.env.VITE_API_URL;

/**
 * Si este navegador y este aparato pueden guardar una llave.
 *
 * Se pregunta antes de mostrar el botón: ofrecer una puerta que no abre es peor que no ofrecerla.
 * Ante la duda contesta que no, que es el lado seguro — quien no pueda usar la llave sigue
 * teniendo la contraseña.
 */
export async function esteAparatoGuardaLlaves() {
  try {
    if (!window.PublicKeyCredential) return false;
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Si la persona canceló el pedido del navegador, en vez de haber fallado algo. */
export function loCancelaronAMano(error) {
  return error?.name === 'NotAllowedError' || error?.name === 'AbortError';
}

async function puertaDeCalle(ruta, cuerpo) {
  const respuesta = await fetch(`${API_URL}/api/llave-de-dispositivo${ruta}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpo),
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) throw errorDeLaRespuesta(respuesta, datos);
  return datos;
}

/**
 * Entrar. Deja la sesión abierta igual que la entrada con contraseña, así que quien llama no tiene
 * que hacer nada más: `onAuthStateChange` se entera solo.
 */
export async function entrarConLaLlaveDelAparato(rol) {
  const opciones = await puertaDeCalle('/entrar/desafio', { rol });
  const firma = await startAuthentication({ optionsJSON: opciones });
  const { email, pase } = await puertaDeCalle('/entrar', { rol, respuesta: firma });

  const { error } = await supabase.auth.verifyOtp({ email, token: pase, type: 'magiclink' });
  if (error) throw error;
}

/**
 * Dar de alta una llave en este aparato. La puerta la pone quien llama, porque vive adentro de la
 * aplicación y cada una tiene la suya.
 *
 * `puerta.desafio()` pide el número a firmar y `puerta.guardar(firma)` manda la llave nueva.
 */
export async function guardarLaLlaveEnEsteAparato(puerta) {
  const opciones = await puerta.desafio();
  const firma = await startRegistration({ optionsJSON: opciones });
  return puerta.guardar(firma);
}
