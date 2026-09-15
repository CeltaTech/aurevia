import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { exigirOrganizacionActiva } from '../middleware/alcancePrestadora.js';
import { escuchar } from '../avisosEnVivo/canal.js';

export const panelAvisosEnVivoRouter = Router();

/* La única puerta del canal en vivo hacia el Panel.
 *
 * LOS MISMOS DOS CONTROLES QUE CUALQUIER RUTA DEL PANEL, y por el mismo motivo: la Organización
 * la resuelve el motor con `req.usuarioPanel.prestadoraId` —que ya trae la de la sesión de
 * soporte si hay una abierta— y nunca un valor que venga en el pedido. Que por acá no viaje
 * ningún dato no lo vuelve inofensivo: quién escucha los avisos de una Organización es
 * exactamente el mismo dato que quién ve sus listas.
 *
 * SIN ORGANIZACIÓN ACTIVA NO HAY CANAL. El Superadmin que todavía no abrió una sesión de soporte
 * no está adentro de ninguna Prestadora, así que no hay avisos suyos que escuchar.
 *
 * NO CONTESTA Y SE CIERRA: la respuesta queda abierta y el canal escribe en ella. Quién cierra
 * la conexión y cuándo está en `avisosEnVivo/canal.js`. */
panelAvisosEnVivoRouter.get('/', requiereRolPanel, exigirOrganizacionActiva, (req, res) => {
  escuchar(res, req.usuarioPanel.prestadoraId);
});
