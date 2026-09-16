import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { acotarAPrestadora, exigirOrganizacionActiva } from '../middleware/alcancePrestadora.js';
import { supabase } from '../db/connection.js';
import { marcarAusenteYCrearIncidente } from '../utils/marcarAusente.js';
import { cubrirGuardiaConSustituto } from '../utils/cubrirGuardia.js';
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

/* La segunda excepción, y por el mismo motivo: cubrir una ausencia con un sustituto tampoco es un
   cambio de estado. Son dos escrituras que valen juntas o no valen —la constancia de a quién le
   tocaba ese turno y por qué lo hace otro, y la guardia que pasa a nombre de quien lo hace— y el
   orden entre ellas importa. Está escrito una sola vez en `utils/cubrirGuardia.js`, con el porqué
   de cada paso.

   La Prestadora la pone el motor, nunca el pedido: la guardia se busca acotada a la Organización
   activa de quien llama, y si no aparece, no aparece. Y el sustituto se comprueba contra esa misma
   Prestadora antes de escribir nada: un identificador de otra Organización no puede terminar
   haciendo una guardia acá.

   Cubrir una ausencia es trabajo operativo, así que también es del Coordinador. */
panelGuardiasRouter.post('/:id/cubrir', requiereRolPanel, exigirOrganizacionActiva, async (req, res) => {
  const {
    asistente_sustituto_id: asistenteSustitutoId,
    ausencia_id: ausenciaId = null,
    motivo = null,
    motivo_detalle: motivoDetalle = null,
    costo_adicional: costoAdicional = null,
  } = req.body ?? {};

  if (!asistenteSustitutoId) return res.status(400).json({ error: 'Falta el Asistente que cubre' });

  let query = supabase
    .from('guardias')
    .select('id, prestadora_id, asistente_id, estado')
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  const { data: guardia, error } = await query.maybeSingle();

  if (error) return responderError(res, error);
  if (!guardia) return res.status(404).json({ error: 'No se encontró esa guardia' });

  // Sin Asistente asignado nadie faltó: esa guardia está sin cubrir, y asignarla es otra cosa.
  if (!guardia.asistente_id) {
    return res.status(400).json({ error: 'La guardia no tiene Asistente asignado' });
  }
  if (guardia.estado !== 'programada') {
    return res.status(400).json({ error: 'Solo una guardia programada puede cubrirse con un sustituto' });
  }
  if (guardia.asistente_id === asistenteSustitutoId) {
    return res.status(400).json({ error: 'El sustituto no puede ser el mismo Asistente de la guardia' });
  }

  const { data: sustituto } = await supabase
    .from('asistentes')
    .select('id')
    .eq('id', asistenteSustitutoId)
    .eq('prestadora_id', guardia.prestadora_id)
    .maybeSingle();
  if (!sustituto) return res.status(404).json({ error: 'No se encontró ese Asistente' });

  const resultado = await cubrirGuardiaConSustituto({
    guardia,
    asistenteSustitutoId,
    ausenciaId,
    motivo,
    motivoDetalle,
    costoAdicional,
  });
  if (!resultado.ok) return res.status(500).json({ error: resultado.motivo });

  res.json({ ok: true });
});

/* La tercera excepción, y por el mismo motivo que la primera: el Panel cambia el Asistente de una
   guardia contra la base, pero avisarlo no lo puede hacer él. El aviso sale por WhatsApp, por
   correo y por el celular de la Familia, y ninguno de los tres pasa por el navegador.

   La guardia ya se cambió cuando llega este pedido. Así que el aviso no puede voltear nada: si
   falla un canal queda registrado adentro de `avisarCambioDeAsistente` y la respuesta sigue
   siendo buena, porque lo que la pantalla informa es la reasignación, que salió bien.

   El Asistente nuevo viaja en el pedido y no se deduce de la guardia, porque este aviso también
   lo usa la reasignación, donde la guardia todavía puede estar contando al anterior. La
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
    .select('id, prestadora_id, paciente_id, fecha, hora_inicio, hora_fin, dias_hasta_el_fin')
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

/* EL DESCANSO ADENTRO DE LA GUARDIA, MIRADO DESDE EL PANEL.

   En una guardia de 24, 48 o 72 horas la Asistente descansa adentro del turno, y ese rato queda
   anotado. Descansar disponible no se descuenta de lo que se le paga, no interrumpe el turno y no
   la saca de la guardia: la constancia existe para saber qué pasó, no para restar nada.

   POR QUÉ ESTAS DOS RUTAS. La que estuvo cuarenta y ocho horas adentro puede haberse olvidado de
   marcarlo, y ese rato igual existió: la Coordinadora lo anota después. No puede hacerlo contra la
   base desde el navegador porque la migración que crea la tabla sólo le dio permiso de lectura a
   quien tiene sesión — escribir es del motor.

   ACÁ SE ANOTA UN DESCANSO YA TERMINADO, con su principio y su fin. Empezar uno abierto es de la
   Asistente, que es la que está adentro; la Coordinadora registra lo que ya pasó.

   La Prestadora la pone el motor, nunca el pedido: la guardia se busca acotada a la Organización
   activa de quien llama, y si no aparece, no aparece.

   Anotar un descanso es trabajo operativo, así que también es del Coordinador. */
async function guardiaDelPanel(req) {
  let query = supabase
    .from('guardias')
    .select('id, prestadora_id')
    .eq('id', req.params.id);
  query = acotarAPrestadora(query, req.usuarioPanel);
  return query.maybeSingle();
}

panelGuardiasRouter.get('/:id/descansos', requiereRolPanel, exigirOrganizacionActiva, async (req, res) => {
  const { data: guardia, error } = await guardiaDelPanel(req);
  if (error) return responderError(res, error);
  if (!guardia) return res.status(404).json({ error: 'No se encontró esa guardia' });

  const { data, error: errorDescansos } = await supabase
    .from('descansos_guardia')
    .select('id, inicio_at, fin_at, nota, registrado_por')
    .eq('guardia_id', guardia.id)
    .eq('prestadora_id', guardia.prestadora_id)
    .order('inicio_at', { ascending: false });

  if (errorDescansos) return responderError(res, errorDescansos);

  res.json({ descansos: data ?? [] });
});

panelGuardiasRouter.post('/:id/descansos', requiereRolPanel, exigirOrganizacionActiva, async (req, res) => {
  const { inicio_at: inicioAt, fin_at: finAt, nota = null } = req.body ?? {};

  if (!inicioAt || !finAt) return res.status(400).json({ error: 'Falta el principio o el fin del descanso' });

  const inicio = new Date(inicioAt);
  const fin = new Date(finAt);
  if (Number.isNaN(inicio.getTime()) || Number.isNaN(fin.getTime())) {
    return res.status(400).json({ error: 'El principio o el fin del descanso no es una fecha válida' });
  }
  // La misma comprobación que hace la base. Acá está para que el motivo llegue entendible: el
  // texto crudo de una restricción nombra tablas y columnas, y eso no sale a la pantalla.
  if (fin <= inicio) {
    return res.status(400).json({ error: 'El descanso no puede terminar antes de empezar' });
  }
  // Un descanso que todavía no pasó no se anota: esto registra lo que ya ocurrió.
  if (fin > new Date()) {
    return res.status(400).json({ error: 'El descanso no puede terminar en el futuro' });
  }

  const { data: guardia, error } = await guardiaDelPanel(req);
  if (error) return responderError(res, error);
  if (!guardia) return res.status(404).json({ error: 'No se encontró esa guardia' });

  const { data, error: errorAlta } = await supabase
    .from('descansos_guardia')
    .insert({
      prestadora_id: guardia.prestadora_id,
      guardia_id: guardia.id,
      inicio_at: inicio.toISOString(),
      fin_at: fin.toISOString(),
      registrado_por: req.usuarioPanel.id,
      nota: typeof nota === 'string' && nota.trim() ? nota.trim() : null,
    })
    .select('id, inicio_at, fin_at, nota, registrado_por')
    .single();

  if (errorAlta) return responderError(res, errorAlta);

  res.status(201).json({ descanso: data });
});
