import { Router } from 'express';
import {
  pedirRecuperacionDeClave,
  cambiarClaveConToken,
  segundoFactorDelEnlace,
} from '../utils/recuperacionDeClave.js';
import { ErrorConMotivo, responderError } from '../utils/errorConMotivo.js';
import { claveAceptable } from '../config/reglaDeClave.js';
import { resolverPrestadoraPublica } from '../middleware/resolverPrestadoraPublica.js';

export const recuperarClaveRouter = Router();

// Sin auth a propósito: quien llega acá perdió justamente la forma de tener sesión.
//
// LA PRESTADORA VIAJA EN LA DIRECCIÓN, igual que en los formularios del sitio público. Cada
// Prestadora donde la persona trabaja es una cuenta distinta, con su propia clave: sin saber de
// cuál se trata no hay ninguna clave que reemplazar. Y sale de la puerta por donde se entró, nunca
// de lo que venga adentro del pedido, que lo escribe quien llama.
//
// PEDIR CONTESTA SIEMPRE LO MISMO, exista el correo o no. Si la respuesta cambiara, esta puerta
// sería una forma de averiguar quién tiene cuenta preguntando de a un correo por vez, y sin
// sesión la puede abrir cualquiera. La pantalla dice que si ese correo tiene cuenta, va a llegar
// un mensaje, y eso es verdad en los dos casos.
//
// Lo que no tiene todavía es un tope de pedidos por minuto: el que hay en el motor se apoya en
// una sesión ya verificada, y acá no hay ninguna. Pedir de nuevo no abre una puerta más —el
// enlace anterior se da por usado al emitir el siguiente—, así que lo que queda expuesto es
// llenarle la casilla de correo a alguien. Anotado, sin construir un contador nuevo.
recuperarClaveRouter.post('/pedir/:prestadora', resolverPrestadoraPublica, async (req, res) => {
  const { email } = req.body;

  try {
    if (!email || typeof email !== 'string') throw new ErrorConMotivo('faltan_datos');
    await pedirRecuperacionDeClave(email, req.prestadoraPublica.prestadora_id);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ErrorConMotivo) return responderError(res, err);
    console.error('Error al pedir recuperación de clave:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});

// El segundo paso: el código al teléfono, si esa cuenta lo tiene verificado y su Prestadora tiene
// por dónde mandarlo.
//
// EL ENLACE VIAJA EN EL CUERPO Y NO EN LA DIRECCIÓN, igual que el código: una dirección queda
// escrita en el registro del servidor y en el historial del navegador.
//
// A NADIE SE LE SACA NADA: la cuenta sin teléfono verificado contesta `requiereCodigo: false` y
// sigue recuperando por correo como siempre.
recuperarClaveRouter.post('/segundo-factor', async (req, res) => {
  const { token } = req.body ?? {};

  try {
    if (!token) throw new ErrorConMotivo('faltan_datos');
    res.json(await segundoFactorDelEnlace(token));
  } catch (err) {
    if (err instanceof ErrorConMotivo) return responderError(res, err);
    console.error('Error al pedir el código de la clave nueva:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});

// Canjear el enlace por la clave nueva. Los tres motivos que pueden salir son los mismos de la
// activación, y la pantalla los traduce igual.
recuperarClaveRouter.post('/canjear', async (req, res) => {
  const { token, password, codigo } = req.body;

  try {
    if (!token || !password) throw new ErrorConMotivo('faltan_datos');
    if (!claveAceptable(password)) throw new ErrorConMotivo('password_debil');

    await cambiarClaveConToken(token, password, codigo ?? null);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ErrorConMotivo) return responderError(res, err);
    console.error('Error al canjear el enlace de clave nueva:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});
