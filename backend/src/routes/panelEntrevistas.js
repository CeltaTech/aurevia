import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { exigirOrganizacionActiva } from '../middleware/alcancePrestadora.js';
import { responderError } from '../utils/errorConMotivo.js';
import {
  agendarEntrevista,
  cancelarEntrevista,
  cerrarEntrevista,
  entrevistasDeLaPostulacion,
  reprogramarEntrevista,
} from '../utils/entrevistaDePostulacion.js';

/* La entrevista de una postulación, desde el Panel.
   ================================================

   QUÉ RESOLVÍA MAL ESTO. La etapa de entrevista del Proceso de Incorporación de Asistentes
   (`docs/PRD_03_Reclutamiento.md`) se coordinaba por afuera y terminaba en una casilla marcada a
   mano, que no decía cuándo fue, quién entrevistó ni si la persona se presentó. Y coordinar por
   afuera obliga a quien entrevista a darle su teléfono o su correo personal a alguien que todavía
   es un postulante.

   QUÉ HACE Y QUÉ NO. Agenda, mueve, cancela y cierra. No cambia la situación de la postulación:
   haber entrevistado a alguien no es haberlo aprobado, y esa decisión se toma en la pantalla de
   Postulantes, que es donde estaba antes y donde sigue.

   LA PRESTADORA SALE DE LA SESIÓN, nunca del pedido. Es `req.usuarioPanel.prestadoraId`, que ya
   resolvió el middleware: quien manda el pedido no elige a qué Prestadora le agenda una
   entrevista. Lo mismo hace que una postulación de otra Prestadora no exista para esta sesión, y
   por eso el motivo que sale es «no encontrado» y no «sin permiso»: desde afuera las dos tienen
   que verse iguales. */

export const panelEntrevistasRouter = Router();

// Toda la historia de entrevistas de una postulación, la última primero. Reprogramar deja rastro,
// y quien mira quiere ver que a esta persona se le movió la cita dos veces.
panelEntrevistasRouter.get(
  '/:postulacionId',
  requiereRolPanel,
  exigirOrganizacionActiva,
  async (req, res) => {
    try {
      const entrevistas = await entrevistasDeLaPostulacion({
        prestadoraId: req.usuarioPanel.prestadoraId,
        postulacionId: req.params.postulacionId,
      });
      res.json({ entrevistas });
    } catch (error) {
      responderError(res, error);
    }
  },
);

panelEntrevistasRouter.post(
  '/:postulacionId',
  requiereRolPanel,
  exigirOrganizacionActiva,
  async (req, res) => {
    try {
      const entrevista = await agendarEntrevista({
        prestadoraId: req.usuarioPanel.prestadoraId,
        postulacionId: req.params.postulacionId,
        agendadaPara: req.body?.agendada_para,
        usuarioId: req.usuarioPanel.id,
      });
      res.status(201).json({ entrevista });
    } catch (error) {
      responderError(res, error);
    }
  },
);

// Mover la cita es `PATCH` y no otro `POST`: es la misma entrevista en otro momento, con la misma
// llave y la misma sala. Un `POST` crearía una segunda, y el postulante tendría dos citas.
panelEntrevistasRouter.patch(
  '/:postulacionId',
  requiereRolPanel,
  exigirOrganizacionActiva,
  async (req, res) => {
    try {
      const entrevista = await reprogramarEntrevista({
        prestadoraId: req.usuarioPanel.prestadoraId,
        postulacionId: req.params.postulacionId,
        agendadaPara: req.body?.agendada_para,
      });
      res.json({ entrevista });
    } catch (error) {
      responderError(res, error);
    }
  },
);

// Cómo salió: se hizo, o la persona no se presentó. Cancelarla es otra cosa y tiene su propia
// dirección, porque cancelar es que no va a pasar y esto es que ya pasó.
panelEntrevistasRouter.post(
  '/:postulacionId/cierre',
  requiereRolPanel,
  exigirOrganizacionActiva,
  async (req, res) => {
    try {
      const entrevista = await cerrarEntrevista({
        prestadoraId: req.usuarioPanel.prestadoraId,
        postulacionId: req.params.postulacionId,
        estado: req.body?.estado,
        usuarioId: req.usuarioPanel.id,
        observaciones: req.body?.observaciones ?? null,
      });
      res.json({ entrevista });
    } catch (error) {
      responderError(res, error);
    }
  },
);

panelEntrevistasRouter.post(
  '/:postulacionId/cancelacion',
  requiereRolPanel,
  exigirOrganizacionActiva,
  async (req, res) => {
    try {
      const entrevista = await cancelarEntrevista({
        prestadoraId: req.usuarioPanel.prestadoraId,
        postulacionId: req.params.postulacionId,
        usuarioId: req.usuarioPanel.id,
        observaciones: req.body?.observaciones ?? null,
      });
      res.json({ entrevista });
    } catch (error) {
      responderError(res, error);
    }
  },
);
