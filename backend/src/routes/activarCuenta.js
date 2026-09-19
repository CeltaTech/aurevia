import { Router } from 'express';
import { activarCuentaConToken, cuentaQueActivoConEsteToken } from '../utils/activacionCuenta.js';
import { ErrorConMotivo, responderError } from '../utils/errorConMotivo.js';
import { claveAceptable } from '../config/reglaDeClave.js';
import { telefonoAceptable } from '../utils/codigoAlTelefono.js';
import {
  ofrecerElCodigoAlActivar,
  verificarElTelefonoAlActivar,
} from '../utils/telefonoAlActivar.js';

export const activarCuentaRouter = Router();

// Sin auth a propósito: quien llega acá todavía no tiene sesión (pendiente #75, docs/PLAN_HASTA_PRODUCCION.md).
//
// Todo lo que puede salir mal acá viaja como **motivo**: un código que la pantalla traduce a
// una frase en el idioma de quien mira (CLAUDE.md §7, reglas 1 y 2). Antes salía solo el
// código en `error`, y las dos pantallas lo comparaban a mano, cada una con su copia de la
// misma lista de códigos — la duplicación que prohíbe la regla 12.
//
// La falla interna es el único caso sin motivo, y es a propósito: su texto está escrito para
// quien programa, y la pantalla ya tiene una frase propia para "se rompió algo de este lado".
// Un motivo ahí sería una segunda frase diciendo exactamente lo mismo.
//
// EL TELÉFONO ES OPCIONAL Y NO CAMBIA NADA DE LO ANTERIOR. Sin él, esta puerta contesta lo mismo
// que contestaba antes, que es lo que siguen mandando las dos aplicaciones de teléfono. Con él, el
// número queda cargado sin verificar y sale el código — y que el código no salga tampoco impide
// entrar: verificar es una oferta, nunca un requisito (`utils/telefonoAlActivar.js`).
activarCuentaRouter.post('/', async (req, res) => {
  const { token, password, telefono } = req.body ?? {};

  try {
    if (!token || !password) throw new ErrorConMotivo('faltan_datos');
    if (!claveAceptable(password)) throw new ErrorConMotivo('password_debil');

    // El número se revisa **antes** de activar. Después la cuenta ya quedó activa, y contestar
    // entonces que el dato vino mal haría creer que no se activó nada.
    const escrito = String(telefono ?? '').trim();
    if (escrito && !telefonoAceptable(escrito)) throw new ErrorConMotivo('telefono_invalido');

    const { usuarioId } = await activarCuentaConToken(token, password);
    const codigo = await ofrecerElCodigoAlActivar({ usuarioId, telefono: escrito });

    res.json({ ok: true, ...codigo });
  } catch (err) {
    if (err instanceof ErrorConMotivo) return responderError(res, err);
    console.error('Error al activar cuenta:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});

// El código del teléfono, escrito en la misma pantalla y todavía sin sesión.
//
// LAS DOS CONDICIONES VAN JUNTAS: el enlace dice de quién es la cuenta, y la contraseña que esa
// persona acaba de elegir prueba que es ella. Sin la segunda, quien se quedara con el correo
// podría colgarle a la cuenta un número suyo, y con un número verificado se recupera la clave.
//
// NI EL NÚMERO NI EL CÓDIGO VIAJAN POR LA DIRECCIÓN WEB: todo va en el cuerpo del pedido.
activarCuentaRouter.post('/telefono/confirmar', async (req, res) => {
  const { token, password, codigo } = req.body ?? {};

  try {
    if (!token || !password || !codigo) throw new ErrorConMotivo('faltan_datos');

    const usuarioId = await cuentaQueActivoConEsteToken(token);
    await verificarElTelefonoAlActivar({ usuarioId, clave: password, codigo });

    res.json({ ok: true });
  } catch (err) {
    if (err instanceof ErrorConMotivo) return responderError(res, err);
    console.error('Error al verificar el teléfono al activar:', err.message);
    res.status(500).json({ error: 'error_interno' });
  }
});
