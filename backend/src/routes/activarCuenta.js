import { Router } from 'express';
import { activarCuentaConToken } from '../utils/activacionCuenta.js';
import { ErrorConMotivo, responderError } from '../utils/errorConMotivo.js';

export const activarCuentaRouter = Router();

// Sin auth a propósito: quien llega acá todavía no tiene sesión (pendiente #75, docs/PENDIENTES.md).
//
// Todo lo que puede salir mal acá viaja como **motivo**: un código que la pantalla traduce a
// una frase en el idioma de quien mira (CLAUDE.md §7, reglas 1 y 2). Antes salía solo el
// código en `error`, y las dos pantallas lo comparaban a mano, cada una con su copia de la
// misma lista de códigos — la duplicación que prohíbe la regla 12.
//
// La falla interna es el único caso sin motivo, y es a propósito: su texto está escrito para
// quien programa, y la pantalla ya tiene una frase propia para "se rompió algo de este lado".
// Un motivo ahí sería una segunda frase diciendo exactamente lo mismo.
activarCuentaRouter.post('/', async (req, res) => {
  const { token, password } = req.body;

  try {
    if (!token || !password) throw new ErrorConMotivo('faltan_datos');
    if (typeof password !== 'string' || password.length < 8) throw new ErrorConMotivo('password_debil');

    await activarCuentaConToken(token, password);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ErrorConMotivo) return responderError(res, err);
    console.error('Error al activar cuenta:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});
