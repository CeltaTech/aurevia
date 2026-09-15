import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { acotarAPrestadora, exigirOrganizacionActiva } from '../middleware/alcancePrestadora.js';
import { supabase } from '../db/connection.js';
import { marcarAusenteYCrearIncidente } from '../utils/marcarAusente.js';
import { avisarCambioDeAsistente } from '../utils/avisoCambioDeAsistente.js';
import { sugerirMotivoDelAviso } from '../utils/motivoSugeridoDelAviso.js';
import { responderError } from '../utils/errorConMotivo.js';

export const panelGuardiasRouter = Router();

/* Las guardias las escribe el Panel directo contra la base, con el pase de la persona, y así
   sigue siendo: reasignar, cancelar, registrar la llegada. Acá vive la excepción.

   POR QUÉ ESTA RUTA. Marcar una ausencia no es un cambio de estado: es un cambio de estado más
   la apertura de un incidente de relevo, y el incidente tiene que decir quién se quedó esperando.
   Averiguar eso lleva su propia consulta y su propia regla, y esa regla ya la tenía escrita el
   motor para la detección automática. Escrita otra vez del lado del navegador quedaron dos, y
   dieron distinto: la del Panel miraba un solo Paciente y un solo día. El detalle de las dos
   diferencias está en `utils/marcarAusente.js`.

   Así que la decisión se mudó entera al motor y el Panel la pide. La Prestadora la pone el
   motor, nunca el pedido: se busca la guardia acotando a la Organización activa de quien llama,
   y si no aparece, no aparece. Un identificador de otra Prestadora no distingue de uno que no
   existe, que es lo que pide CLAUDE.md §6.

   Marcar una ausencia es trabajo operativo, así que también es del Coordinador: alcanza con
   `requiereRolPanel`. */
panelGuardiasRouter.post('/:id/ausente', requiereRolPanel, exigirOrganizacionActiva, async (req, res) => {
  let query = supabase
    .from('guardias')
    .select('id, prestadora_id, paciente_id, fecha, hora_inicio, estado, asistente_id')
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data: guardia, error } = await query.maybeSingle();

  if (error) return responderError(res, error);
  if (!guardia) return res.status(404).json({ error: 'No se encontró esa guardia' });

  // Sin Asistente asignado no hay ausencia: nadie faltó. Es el mismo filtro que aplica la
  // detección automática, y por el mismo motivo — un hueco de la agenda marcado como ausencia
  // dispara la alerta más grave del sistema contra nadie.
  if (!guardia.asistente_id) {
    return res.status(400).json({ error: 'La guardia no tiene Asistente asignado' });
  }
  if (guardia.estado !== 'programada') {
    return res.status(400).json({ error: 'Solo una guardia programada puede marcarse como ausente' });
  }

  const resultado = await marcarAusenteYCrearIncidente({ guardia, prestadoraId: guardia.prestadora_id });
  if (!resultado.ok) return res.status(500).json({ error: resultado.motivo });

  res.json({ ok: true });
});

/* La segunda excepción, y por el mismo motivo que la primera: el Panel cambia el Asistente de una
   guardia contra la base, pero avisarlo no lo puede hacer él. El aviso sale por WhatsApp, por
   correo y por el celular de la Familia, y ninguno de los tres pasa por el navegador.

   La guardia ya se cambió cuando llega este pedido. Así que el aviso no puede voltear nada: si
   falla un canal queda registrado adentro de `avisarCambioDeAsistente` y la respuesta sigue
   siendo buena, porque lo que la pantalla informa es la reasignación, que salió bien.

   El Asistente nuevo viaja en el pedido y no se deduce de la guardia: la cobertura de una
   ausencia deja `guardias.asistente_id` como estaba, así que leerla nombraría al que faltó. La
   Prestadora, en cambio, nunca viaja: sale de las guardias, que se buscan acotadas a la
   Organización activa de quien llama. */
panelGuardiasRouter.post('/aviso-cambio-asistente', requiereRolPanel, exigirOrganizacionActiva, async (req, res) => {
  const { guardia_ids: guardiaIds, asistente_nuevo_id: asistenteNuevoId, asistente_anterior_id: asistenteAnteriorId } = req.body ?? {};

  if (!Array.isArray(guardiaIds) || guardiaIds.length === 0) {
    return res.status(400).json({ error: 'No se indicó ninguna guardia' });
  }
  if (!asistenteNuevoId) {
    return res.status(400).json({ error: 'No se indicó el Asistente nuevo' });
  }

  let query = supabase
    .from('guardias')
    .select('id, prestadora_id, paciente_id, fecha, hora_inicio, hora_fin')
    .in('id', guardiaIds);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data: guardias, error } = await query;

  if (error) return responderError(res, error);
  if (!guardias?.length) return res.status(404).json({ error: 'No se encontró esa guardia' });

  await avisarCambioDeAsistente({
    guardias,
    prestadoraId: guardias[0].prestadora_id,
    asistenteNuevoId,
    asistenteAnteriorId: asistenteAnteriorId ?? null,
  });

  res.json({ ok: true });
});

/* La tercera excepción: quien atiende el teléfono cuenta lo que le dijeron y el motor sugiere
   cuál de los motivos de la Prestadora es. El aviso lo sigue guardando el Panel contra la base,
   con el pase de la persona, igual que antes — acá no se escribe nada.

   POR QUÉ PASA POR EL MOTOR. La clave de la API del modelo vive en el servidor y no puede salir
   al navegador (`celtatech/CLAUDE.md` §6). Es toda la razón: no hay ninguna decisión acá que el
   Panel no pudiera tomar.

   LA LISTA LA TRAE EL MOTOR, NO EL PEDIDO. El navegador manda lo que se contó y nada más. Los
   motivos se leen de la base acotados a la Organización activa de quien llama: mandados en el
   pedido, cualquiera podría hacer que la sugerencia salga de una lista que no es la suya, y una
   sugerencia de un motivo ajeno es una filtración de cómo trabaja otra Prestadora.

   LO QUE SE CONTÓ NO SE GUARDA. Entra, se usa para preguntar y se va con la respuesta. Lo que
   queda escrito es el motivo que elija la persona, como venía siendo. */
panelGuardiasRouter.post('/motivo-del-aviso', requiereRolPanel, exigirOrganizacionActiva, async (req, res) => {
  const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';
  if (!texto) return res.status(400).json({ error: 'No se indicó lo que se avisó' });

  let query = supabase.from('motivos_aviso_previo_guardia').select('nombre, activo');
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data: motivos, error } = await query;

  if (error) return responderError(res, error);

  const { motivo } = await sugerirMotivoDelAviso({
    texto,
    motivos: motivos ?? [],
    prestadoraId: req.usuarioPanel.prestadoraId,
  });

  res.json({ motivo });
});
