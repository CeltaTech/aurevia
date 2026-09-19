import { Router } from 'express';
import { pedirRecuperacionDeClave, cambiarClaveConToken } from '../utils/recuperacionDeClave.js';
import { ErrorConMotivo, responderError } from '../utils/errorConMotivo.js';
import { claveAceptable } from '../config/reglaDeClave.js';

export const recuperarClaveRouter = Router();

// Sin auth a propósito: quien llega acá perdió justamente la forma de tener sesión.
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
recuperarClaveRouter.post('/', async (req, res) => {
  const { email } = req.body;

  try {
    if (!email || typeof email !== 'string') throw new ErrorConMotivo('faltan_datos');
    await pedirRecuperacionDeClave(email);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ErrorConMotivo) return responderError(res, err);
    console.error('Error al pedir recuperación de clave:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});

// Canjear el enlace por la clave nueva. Los tres motivos que pueden salir son los mismos de la
// activación, y la pantalla los traduce igual.
recuperarClaveRouter.post('/canjear', async (req, res) => {
  const { token, password } = req.body;

  try {
    if (!token || !password) throw new ErrorConMotivo('faltan_datos');
    if (!claveAceptable(password)) throw new ErrorConMotivo('password_debil');

    await cambiarClaveConToken(token, password);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ErrorConMotivo) return responderError(res, err);
    console.error('Error al canjear el enlace de clave nueva:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});
