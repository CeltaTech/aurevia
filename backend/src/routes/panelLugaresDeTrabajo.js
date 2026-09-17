// Dónde trabaja cada persona: los lugares que acepta cubrir una Asistente y hasta dónde llega
// una coordinadora.
//
// **Se guardan lugares, no zonas.** La disponibilidad de una Asistente no tiene por qué coincidir
// con el agrupamiento de la Prestadora: puede cubrir dos localidades del norte y una del oeste, y
// ninguna otra. Guardar la zona diría de más, y aparecería disponible donde no va. La zona sigue
// siendo el atajo para cargar —marcarla entera y después desmarcar lo que no— y la forma de hablar
// en pantalla: agrupar para mostrar es distinto de guardar.
//
// **Y el alcance de la coordinadora se guarda igual, en lugares**, para que las dos puntas de la
// comparación sean la misma cosa. Mientras se comparaban dos textos escritos a mano, una zona
// escrita distinta no encontraba a nadie y nadie se enteraba.

import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { exigirOrganizacionActiva } from '../middleware/alcancePrestadora.js';
import { exigirAdministracion } from '../middleware/exigirAdministracion.js';
import { supabase } from '../db/connection.js';
import { responderError } from '../utils/errorConMotivo.js';

export const panelLugaresDeTrabajoRouter = Router();

panelLugaresDeTrabajoRouter.use(requiereRolPanel, exigirOrganizacionActiva);

// Cambiar hasta dónde llega una coordinadora es cambiar qué Asistentes ve, o sea un permiso. Eso
// es de la administración, nunca de quien coordina (CLAUDE.md §5, mínimo privilegio).
const soloAdministracion = exigirAdministracion('Solo Admin o Superadmin puede cambiar el alcance de una coordinadora');

/** Los lugares guardados de esa persona, en la tabla que corresponda. */
async function lugaresDe(tabla, columna, id, prestadoraId) {
  const { data, error } = await supabase
    .from(tabla)
    .select('lugar_id')
    .eq(columna, id)
    .eq('prestadora_id', prestadoraId);
  if (error) throw error;
  return (data ?? []).map((fila) => fila.lugar_id);
}

/**
 * Deja guardados exactamente esos lugares: borra los que había y escribe los que llegaron.
 *
 * Se borra y se escribe, y no se calcula la diferencia, porque la pantalla manda la lista entera
 * de lo que quedó tildado: comparar acá sería adivinar cuál de las dos listas es la buena.
 *
 * Que los lugares sean de esta Organización no se comprueba renglón por renglón: lo hace la clave
 * foránea compuesta, que rechaza la inserción entera si alguno no lo es. Un control escrito acá
 * además del de la base sería la misma decisión en dos lugares.
 */
async function guardarLugaresDe(tabla, columna, id, prestadoraId, lugares) {
  const { error: errorBorrado } = await supabase
    .from(tabla)
    .delete()
    .eq(columna, id)
    .eq('prestadora_id', prestadoraId);
  if (errorBorrado) throw errorBorrado;

  if (!lugares.length) return;
  const { error } = await supabase
    .from(tabla)
    .insert(lugares.map((lugarId) => ({ [columna]: id, lugar_id: lugarId, prestadora_id: prestadoraId })));
  if (error) throw error;
}

/** Que la persona exista adentro de esta Organización se comprueba antes de borrar nada: sin esto,
 *  un identificador de otra Prestadora entraría al borrado. */
async function existeEnLaOrganizacion(tabla, id, prestadoraId) {
  const { data, error } = await supabase
    .from(tabla)
    .select('id')
    .eq('id', id)
    .eq('prestadora_id', prestadoraId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

// --- Dónde acepta trabajar una Asistente ---

panelLugaresDeTrabajoRouter.get('/asistente/:id', async (req, res) => {
  try {
    const lugares = await lugaresDe('asistente_lugares', 'asistente_id', req.params.id, req.usuarioPanel.prestadoraId);
    res.json({ lugares });
  } catch (error) {
    responderError(res, error);
  }
});

panelLugaresDeTrabajoRouter.put('/asistente/:id', async (req, res) => {
  const lugares = Array.isArray(req.body?.lugares) ? req.body.lugares : null;
  if (!lugares) return res.status(400).json({ error: 'Falta la lista de lugares' });

  const prestadoraId = req.usuarioPanel.prestadoraId;
  try {
    if (!(await existeEnLaOrganizacion('asistentes', req.params.id, prestadoraId))) {
      return res.status(404).json({ error: 'No se encontró esa Asistente' });
    }
    await guardarLugaresDe('asistente_lugares', 'asistente_id', req.params.id, prestadoraId, lugares);
    res.json({ ok: true });
  } catch (error) {
    responderError(res, error);
  }
});

// --- Hasta dónde llega una coordinadora ---

panelLugaresDeTrabajoRouter.get('/usuario/:id', soloAdministracion, async (req, res) => {
  try {
    const lugares = await lugaresDe('usuario_lugares', 'usuario_id', req.params.id, req.usuarioPanel.prestadoraId);
    res.json({ lugares });
  } catch (error) {
    responderError(res, error);
  }
});

panelLugaresDeTrabajoRouter.put('/usuario/:id', soloAdministracion, async (req, res) => {
  const lugares = Array.isArray(req.body?.lugares) ? req.body.lugares : null;
  if (!lugares) return res.status(400).json({ error: 'Falta la lista de lugares' });

  const prestadoraId = req.usuarioPanel.prestadoraId;
  try {
    if (!(await existeEnLaOrganizacion('usuarios', req.params.id, prestadoraId))) {
      return res.status(404).json({ error: 'No se encontró esa persona' });
    }
    await guardarLugaresDe('usuario_lugares', 'usuario_id', req.params.id, prestadoraId, lugares);
    res.json({ ok: true });
  } catch (error) {
    responderError(res, error);
  }
});
