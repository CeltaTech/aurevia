import { Router } from 'express';
import { requiereRolAsistente } from '../middleware/requiereRolAsistente.js';
import { supabase } from '../db/connection.js';

// ============================================================================
// Pendiente #102 — consentimiento del Asistente para el registro de su ubicación.
//
// Por qué el texto lo elige el backend y no la pantalla: la fotografía que se
// guarda tiene que ser del texto que la persona realmente leyó. Si el frontend
// mandara el texto, mandaría el que él quiera, y la constancia no valdría nada.
// Acá se busca el texto vigente, se le muestra a la persona y se guarda esa
// misma fila — no una que llegue de afuera.
//
// Y una decisión de diseño que no es técnica: esta pantalla NO bloquea el uso
// de la aplicación. Un consentimiento que hay que dar para poder trabajar no es
// libre, y si no es libre no es válido (ver el análisis en PENDIENTES #102). Se
// puede rechazar, el rechazo se registra, y la persona sigue usando todo lo
// demás con normalidad.
// ============================================================================

export const appAsistentesConsentimientosRouter = Router();

// Los temas sobre los que hoy se pide consentimiento. Cuando haya más, se
// agregan acá y en el catálogo de la base — no se repite la lista en otro lado.
const CLAVES = ['seguimiento_ubicacion'];

const IDIOMAS_SOPORTADOS = ['es-AR', 'en', 'pt-BR'];
const IDIOMA_POR_DEFECTO = 'es-AR';

function normalizarIdioma(valor) {
  return IDIOMAS_SOPORTADOS.includes(valor) ? valor : IDIOMA_POR_DEFECTO;
}

// asistentes.tipo_vinculo habla de la forma de contratación; el catálogo habla
// de la modalidad legal. Un solo lugar traduce entre las dos (CLAUDE.md §7.12).
function modalidadDeVinculo(tipoVinculo) {
  return tipoVinculo === 'dependencia' ? 'dependencia' : 'autonomo';
}

// Devuelve { asistente, jurisdiccion } o null si falta algo para poder decidir.
async function contextoDelAsistente(usuarioAsistente) {
  const { data: asistente } = await supabase
    .from('asistentes')
    .select('id, prestadora_id, tipo_vinculo')
    .eq('id', usuarioAsistente.id)
    .eq('prestadora_id', usuarioAsistente.prestadoraId)
    .maybeSingle();
  if (!asistente) return null;

  const { data: prestadora } = await supabase
    .from('prestadoras')
    .select('pais')
    .eq('id', asistente.prestadora_id)
    .maybeSingle();
  if (!prestadora?.pais) return null;

  return { asistente, jurisdiccion: prestadora.pais };
}

// Texto vigente para una jurisdicción + tema + modalidad + idioma. Si no hay
// fila, devuelve null: sin texto no hay consentimiento posible, y no se
// inventa uno por analogía con otro país (CLAUDE.md §3).
async function textoVigente({ jurisdiccion, clave, modalidad, idioma }) {
  const { data } = await supabase
    .from('textos_consentimiento')
    .select('id, version, idioma, titulo, cuerpo, puntos_clave, es_borrador')
    .eq('jurisdiccion', jurisdiccion)
    .eq('clave', clave)
    .eq('modalidad', modalidad)
    .eq('idioma', idioma)
    .is('vigente_hasta', null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function decisionViva(asistenteId, clave) {
  const { data } = await supabase
    .from('consentimientos_asistente')
    .select('id, decision, version_mostrada, decidido_at, texto_consentimiento_id')
    .eq('asistente_id', asistenteId)
    .eq('clave', clave)
    .is('retirado_at', null)
    .maybeSingle();
  return data || null;
}

// ============================================================================
// GET / — qué se le tiene que preguntar a esta persona, y qué contestó ya.
//
// "pendiente" es true cuando todavía no decidió, o cuando decidió sobre una
// versión del texto que quedó vieja: si el alcance cambió, el sí anterior no
// cubre el nuevo y hay que volver a preguntar.
// ============================================================================
appAsistentesConsentimientosRouter.get('/', requiereRolAsistente, async (req, res) => {
  const idioma = normalizarIdioma(req.query.idioma);
  const contexto = await contextoDelAsistente(req.usuarioAsistente);
  if (!contexto) {
    return res.status(404).json({ error: 'Perfil no encontrado' });
  }

  const modalidad = modalidadDeVinculo(contexto.asistente.tipo_vinculo);
  const items = [];

  for (const clave of CLAVES) {
    const texto = await textoVigente({
      jurisdiccion: contexto.jurisdiccion,
      clave,
      modalidad,
      idioma,
    });
    // Sin texto para esta jurisdicción no hay nada que preguntar. No es un
    // error: es el caso normal de un país sin documento legal cargado.
    if (!texto) continue;

    const decision = await decisionViva(contexto.asistente.id, clave);
    items.push({
      clave,
      modalidad,
      jurisdiccion: contexto.jurisdiccion,
      texto: {
        id: texto.id,
        version: texto.version,
        idioma: texto.idioma,
        titulo: texto.titulo,
        cuerpo: texto.cuerpo,
        puntos_clave: texto.puntos_clave || [],
        es_borrador: texto.es_borrador,
      },
      decision: decision
        ? {
            valor: decision.decision,
            version_mostrada: decision.version_mostrada,
            decidido_at: decision.decidido_at,
            desactualizada: decision.texto_consentimiento_id !== texto.id,
          }
        : null,
      pendiente: !decision || decision.texto_consentimiento_id !== texto.id,
    });
  }

  res.json({ consentimientos: items });
});

// ============================================================================
// POST / — registrar la decisión.
//
// Guarda la fotografía del texto exacto. Si ya había una decisión viva sobre
// otra versión, se la retira primero: la fila anterior no se pisa ni se borra,
// porque hace falta poder demostrar qué hubo vigente entre qué fechas.
// ============================================================================
appAsistentesConsentimientosRouter.post('/', requiereRolAsistente, async (req, res) => {
  const { clave, decision } = req.body || {};
  const idioma = normalizarIdioma(req.body?.idioma);

  if (!CLAVES.includes(clave)) {
    return res.status(400).json({ error: 'Consentimiento desconocido' });
  }
  if (!['otorgado', 'rechazado'].includes(decision)) {
    return res.status(400).json({ error: 'Decisión no válida' });
  }

  const contexto = await contextoDelAsistente(req.usuarioAsistente);
  if (!contexto) {
    return res.status(404).json({ error: 'Perfil no encontrado' });
  }

  const modalidad = modalidadDeVinculo(contexto.asistente.tipo_vinculo);
  const texto = await textoVigente({
    jurisdiccion: contexto.jurisdiccion,
    clave,
    modalidad,
    idioma,
  });
  if (!texto) {
    return res.status(409).json({ error: 'Todavía no hay texto de consentimiento para este país' });
  }

  const viva = await decisionViva(contexto.asistente.id, clave);
  if (viva) {
    if (viva.texto_consentimiento_id === texto.id && viva.decision === decision) {
      return res.json({ ok: true, sin_cambios: true });
    }
    // Solo un 'otorgado' se puede retirar (lo dice la restricción de la tabla).
    // Un 'rechazado' que cambia de opinión se reemplaza borrando el anterior:
    // no hay nada que preservar, nunca autorizó nada.
    if (viva.decision === 'otorgado') {
      const { error } = await supabase
        .from('consentimientos_asistente')
        .update({ retirado_at: new Date().toISOString(), motivo_retiro: 'reemplazado_por_decision_nueva' })
        .eq('id', viva.id);
      if (error) return res.status(500).json({ error: 'No se pudo registrar la decisión' });
    } else {
      const { error } = await supabase
        .from('consentimientos_asistente')
        .delete()
        .eq('id', viva.id);
      if (error) return res.status(500).json({ error: 'No se pudo registrar la decisión' });
    }
  }

  const { error } = await supabase.from('consentimientos_asistente').insert({
    prestadora_id: contexto.asistente.prestadora_id,
    asistente_id: contexto.asistente.id,
    clave,
    texto_consentimiento_id: texto.id,
    version_mostrada: texto.version,
    idioma_mostrado: texto.idioma,
    texto_mostrado: texto.cuerpo,
    decision,
  });
  if (error) {
    return res.status(500).json({ error: 'No se pudo registrar la decisión' });
  }

  res.json({ ok: true });
});

// ============================================================================
// POST /retirar — la ley exige que se pueda retirar, así que existe la ruta.
//
// No borra la fila: le pone fecha de retiro. Desde ese instante
// consentimiento_seguimiento_vigente() devuelve false para esta persona.
// ============================================================================
appAsistentesConsentimientosRouter.post('/retirar', requiereRolAsistente, async (req, res) => {
  const { clave, motivo } = req.body || {};
  if (!CLAVES.includes(clave)) {
    return res.status(400).json({ error: 'Consentimiento desconocido' });
  }

  const viva = await decisionViva(req.usuarioAsistente.id, clave);
  if (!viva || viva.decision !== 'otorgado') {
    return res.status(409).json({ error: 'No hay un consentimiento vigente para retirar' });
  }

  // Se comprueba que la fila se haya escrito de verdad. La lectura de arriba pasó hace un
  // instante, pero acá se contesta "listo, retirado" y eso es lo que la persona se lleva: si no
  // quedó escrito, no se le puede decir que sí. Un consentimiento que alguien cree retirado y
  // sigue vigente es exactamente lo que la ley no perdona.
  const { data: retirado, error } = await supabase
    .from('consentimientos_asistente')
    .update({
      retirado_at: new Date().toISOString(),
      motivo_retiro: typeof motivo === 'string' && motivo.trim() ? motivo.trim().slice(0, 500) : null,
    })
    .eq('id', viva.id)
    .is('retirado_at', null)
    .select('id');

  if (error) {
    return res.status(500).json({ error: 'No se pudo retirar el consentimiento' });
  }
  if (!retirado?.length) {
    return res.status(409).json({ error: 'No hay un consentimiento vigente para retirar' });
  }

  res.json({ ok: true });
});
