import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { exigirOrganizacionActiva } from '../middleware/alcancePrestadora.js';
import { responderError } from '../utils/errorConMotivo.js';
import {
  pedidosEsperandoCodigo,
  emitirCodigoDeLaPrestadora,
  llegadasSinComprobar,
  cerrarSinComprobar,
} from '../utils/comprobacionDePresencia.js';

export const panelComprobacionesRouter = Router();

/* El pase de guardia visto desde la Prestadora (pendiente #113).
 *
 * DOS LISTAS Y NADA MÁS. Una es urgente y la otra no:
 *
 *   `/pedidos` — el Asistente está parado en la puerta y no tiene a quién pedirle el código.
 *   Espera. Quien está de turno lo resuelve como esa Prestadora decida —llamando al domicilio,
 *   por videollamada, como sea— y suelta un código que vale unos minutos.
 *
 *   `/sin-comprobar` — la llegada ya ocurrió y el Asistente entró igual, porque la guardia nunca
 *   se traba. Queda anotada para que el Coordinador la mire después y la cierre.
 *
 * LA PRESTADORA LA PONE EL MOTOR, NUNCA EL PEDIDO. Las cuatro rutas resuelven la Organización con
 * `req.usuarioPanel.prestadoraId`, que ya trae la de la sesión de soporte si hay una abierta. Un
 * identificador de otra Prestadora no se distingue de uno que no existe: las dos cosas contestan
 * `no_encontrado`.
 *
 * POR QUÉ ALCANZA `requiereRolPanel`. Soltar un código y cerrar una llegada sin comprobar son
 * trabajo operativo del turno, igual que marcar una ausencia (`panelGuardias.js`), y el
 * Coordinador es quien está mirando la pantalla cuando entra el pedido. Si alguna Prestadora
 * quisiera reservárselo a su administración, se agrega la acción al catálogo de permisos y se
 * cuelga `requierePermiso(...)` acá; hoy ninguna lo pidió y el catálogo no se infla por las
 * dudas.
 */

/** Los pedidos que están esperando que alguien de la Prestadora los resuelva. */
panelComprobacionesRouter.get('/pedidos', requiereRolPanel, exigirOrganizacionActiva, async (req, res) => {
  try {
    res.json(await pedidosEsperandoCodigo(req.usuarioPanel.prestadoraId));
  } catch (e) {
    responderError(res, e);
  }
});

/* Suelta el código para ese pedido. Es la única vez que el código viaja en claro: de acá en más
 * queda solamente su huella, así que la pantalla lo tiene que mostrar en el momento y quien
 * atiende dictárselo al Asistente. Quién lo soltó y cuándo queda escrito en la misma fila. */
panelComprobacionesRouter.post('/:id/codigo', requiereRolPanel, exigirOrganizacionActiva, async (req, res) => {
  try {
    const { codigo, minutos } = await emitirCodigoDeLaPrestadora({
      comprobacionId: req.params.id,
      prestadoraId: req.usuarioPanel.prestadoraId,
      emitidoPor: req.usuarioPanel.id,
    });
    res.json({ codigo, minutos });
  } catch (e) {
    responderError(res, e);
  }
});

/** Las llegadas y salidas que quedaron sin comprobar y todavía nadie cerró. */
panelComprobacionesRouter.get('/sin-comprobar', requiereRolPanel, exigirOrganizacionActiva, async (req, res) => {
  try {
    res.json(await llegadasSinComprobar(req.usuarioPanel.prestadoraId));
  } catch (e) {
    responderError(res, e);
  }
});

/* Cerrar no es aprobar ni rechazar: es decir que alguien la miró. Lo que se averiguó va en la
 * nota, y la fila queda con quién la cerró y cuándo. */
panelComprobacionesRouter.post('/:id/cerrar', requiereRolPanel, exigirOrganizacionActiva, async (req, res) => {
  try {
    await cerrarSinComprobar({
      comprobacionId: req.params.id,
      prestadoraId: req.usuarioPanel.prestadoraId,
      cerradaPor: req.usuarioPanel.id,
      nota: req.body?.nota,
    });
    res.json({ ok: true });
  } catch (e) {
    responderError(res, e);
  }
});
