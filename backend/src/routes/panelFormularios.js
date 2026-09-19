// Los formularios declarados, del lado del servidor.
//
// Dos cosas hace esta ruta y ninguna más: entrega la declaración para que la pantalla la dibuje, y
// controla una respuesta antes de que nadie la guarde.
//
// **Por qué el control está acá y no sólo en la pantalla.** El Panel corre en un navegador y a un
// navegador se lo saltea armando la llamada a mano. Lo que la pantalla controla es una comodidad
// —que quien carga vea lo que falta sin esperar al servidor—; lo que decide es esto.
//
// **Y no guarda nada.** Cada pantalla guarda lo suyo donde vive: el Legajo en el Legajo, la ficha
// del Paciente en la suya. Lo que comparten es la declaración y el control, y eso es lo que está
// acá. La pantalla que guarda llama a `validarContraLaDeclaracion` antes de escribir.

import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { exigirOrganizacionActiva } from '../middleware/alcancePrestadora.js';
import { responderError } from '../utils/errorConMotivo.js';
import {
  declaracionDeFormulario,
  formulariosDelAmbito,
  validarContraLaDeclaracion,
} from '../utils/declaracionDeFormulario.js';

export const panelFormulariosRouter = Router();

panelFormulariosRouter.use(requiereRolPanel, exigirOrganizacionActiva);

// --- Qué formularios hay para un ámbito ---

panelFormulariosRouter.get('/ambito/:ambito', async (req, res) => {
  try {
    const formularios = await formulariosDelAmbito(req.params.ambito, req.usuarioPanel.prestadoraId);
    res.json({ formularios });
  } catch (error) {
    responderError(res, error);
  }
});

// --- La declaración de uno ---

panelFormulariosRouter.get('/:clave', async (req, res) => {
  try {
    const declaracion = await declaracionDeFormulario(req.params.clave, req.usuarioPanel.prestadoraId);
    res.json({ declaracion });
  } catch (error) {
    responderError(res, error);
  }
});

// --- El control de una respuesta ---
//
// Contesta la lista entera de lo que falta, no el primer renglón: quien carga tiene que ver de una
// sola vez todo lo que le falta, y no descubrir uno nuevo en cada intento. La lista dice sección,
// repetición y casillero por su clave —nombres de la declaración— y un motivo, que es un código.
// Nunca sale de acá el texto crudo de un error de la base.
//
// **Y un formulario incompleto contesta que sí, con el veredicto adentro.** Lo que se preguntó es
// si la respuesta pasa, y «no pasa, por esto» es la contestación correcta a esa pregunta, no una
// falla. Mandarlo como error haría que la pantalla lo tratara como algo que salió mal, cuando lo
// único que pasó es que quien carga todavía no terminó. Lo que sí falla —el formulario que no
// existe, la Organización que falta— sale por `responderError`, con su motivo y su número.

panelFormulariosRouter.post('/:clave/controlar', async (req, res) => {
  const respuesta = req.body?.respuesta;
  if (!respuesta || typeof respuesta !== 'object') {
    return res.status(400).json({ error: 'faltan_datos', motivo: 'faltan_datos' });
  }

  try {
    const contexto = req.body?.contexto && typeof req.body.contexto === 'object' ? req.body.contexto : {};
    const { respuesta: limpia } = await validarContraLaDeclaracion(
      req.params.clave,
      respuesta,
      req.usuarioPanel.prestadoraId,
      { contexto },
    );
    res.json({ ok: true, respuesta: limpia, faltantes: [] });
  } catch (error) {
    if (error?.motivo === 'formulario_incompleto') {
      return res.json({ ok: false, respuesta: null, faltantes: error.faltantes ?? [] });
    }
    responderError(res, error);
  }
});
