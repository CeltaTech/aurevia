// La biblioteca que cada Prestadora escribe para las Familias de su Organización: contenido y
// recursos para quien cuida en su casa
// (`supabase/migrations/20260915170000_cada_prestadora_escribe_su_contenido_para_las_familias.sql`).
//
// QUÉ SE GUARDA. Un título, un texto y, si la Prestadora ya publica material en otro lado, un
// enlace. No se suben archivos: eso es un depósito con sus propias políticas y es una decisión
// aparte.
//
// QUIÉN. Verla es de cualquiera del Panel de esa Prestadora —un borrador hay que poder revisarlo—.
// Escribirla es una acción del catálogo de permisos, `escribir_contenido_para_familias`, que cada
// Prestadora reparte como quiera desde Configuración › Accesos. El producto no elige el reparto de
// trabajo de adentro de una Prestadora.
//
// NO LLEVA CANDADO DE MODALIDAD. Una Familia de prestación directa cuida en su casa igual que una
// de marketplace. Por eso este riel no cuelga de `panelMarketplace.js`.

import { Router } from 'express';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { exigirOrganizacionActiva } from '../middleware/alcancePrestadora.js';
import { requierePermiso } from '../utils/permisos.js';
import { supabase } from '../db/connection.js';
import { ErrorConMotivo, responderError } from '../utils/errorConMotivo.js';

export const panelContenidosRouter = Router();

panelContenidosRouter.use(requiereRolPanel, exigirOrganizacionActiva);

const puedeEscribir = requierePermiso('escribir_contenido_para_familias');

const CAMPOS = 'id, titulo, cuerpo, enlace_url, orden, publicado, created_at, updated_at';

/**
 * Lo que se va a guardar, o un error con motivo.
 *
 * Repite en el servidor lo que la tabla comprueba en la base, y por el mismo motivo que las formas
 * de cobro: un `CHECK` que salta sube como código crudo de Postgres, y de ahí la pantalla sólo
 * puede decir «hay un dato mal cargado». Comprobándolo acá, cada pieza mal cargada viaja con su
 * propio motivo (`celtatech/CLAUDE.md` §6, y `utils/errorConMotivo.js`).
 */
function contenidoValidado(cuerpoDelPedido) {
  const titulo = typeof cuerpoDelPedido.titulo === 'string' ? cuerpoDelPedido.titulo.trim() : '';
  if (!titulo) throw new ErrorConMotivo('faltan_datos', 'El contenido necesita un título');

  const cuerpo = typeof cuerpoDelPedido.cuerpo === 'string' ? cuerpoDelPedido.cuerpo.trim() : '';
  if (!cuerpo) throw new ErrorConMotivo('faltan_datos', 'El contenido necesita un texto');

  // El enlace es opcional; si viene, tiene que ser una página web cifrada. Lo que no se admite es
  // un `javascript:` ni un `http://` suelto: esto termina en un enlace que toca una Familia.
  const enlaceCrudo = typeof cuerpoDelPedido.enlace_url === 'string' ? cuerpoDelPedido.enlace_url.trim() : '';
  const enlace = enlaceCrudo === '' ? null : enlaceCrudo;
  if (enlace !== null && !/^https:\/\/\S+$/.test(enlace)) {
    throw new ErrorConMotivo('enlace_invalido', `Enlace que no es una dirección https: ${enlace}`);
  }

  // Sin número de orden, la pieza va al final por fecha. Cero es un orden válido, así que no se
  // puede preguntar por el valor a secas.
  const ordenCrudo = cuerpoDelPedido.orden;
  const orden = ordenCrudo === null || ordenCrudo === undefined || ordenCrudo === '' ? 0 : Number(ordenCrudo);
  if (!Number.isInteger(orden)) {
    throw new ErrorConMotivo('orden_invalido', `Orden que no es un número entero: ${ordenCrudo}`);
  }

  return {
    titulo,
    cuerpo,
    enlace_url: enlace,
    orden,
    // Una pieza nueva nace sin publicar: se escribe primero y se muestra después.
    publicado: cuerpoDelPedido.publicado === true,
  };
}

/** El título repetido es lo único que la base rechaza y que la persona puede corregir sola. */
function errorDeGuardado(error) {
  if (error?.code === '23505') {
    return new ErrorConMotivo('titulo_de_contenido_repetido', error.message);
  }
  return error;
}

panelContenidosRouter.get('/', async (req, res) => {
  const { data, error } = await supabase
    .from('contenidos_para_familias')
    .select(CAMPOS)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .order('orden', { ascending: true })
    .order('created_at', { ascending: true });
  if (error) return responderError(res, error);
  res.json({ contenidos: data });
});

panelContenidosRouter.post('/', puedeEscribir, async (req, res) => {
  let valores;
  try {
    valores = contenidoValidado(req.body || {});
  } catch (error) {
    return responderError(res, error, 400);
  }

  const { data, error } = await supabase
    .from('contenidos_para_familias')
    .insert({
      ...valores,
      prestadora_id: req.usuarioPanel.prestadoraId,
      creado_por: req.usuarioPanel.id,
    })
    .select(CAMPOS)
    .single();
  if (error) return responderError(res, errorDeGuardado(error));

  res.json({ contenido: data });
});

panelContenidosRouter.patch('/:id', puedeEscribir, async (req, res) => {
  // Se lee la pieza entera antes de tocarla: si no es de esta Prestadora, no existe, y se contesta
  // lo mismo que si no existiera. Además, un pedido que trae sólo el interruptor de publicado
  // tiene que validarse contra el título y el texto que ya están guardados.
  const { data: actual, error: errorLectura } = await supabase
    .from('contenidos_para_familias')
    .select(CAMPOS)
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .maybeSingle();
  if (errorLectura) return responderError(res, errorLectura);
  if (!actual) {
    return responderError(res, new ErrorConMotivo('no_encontrado', 'Contenido de otra Prestadora o inexistente'));
  }

  let valores;
  try {
    valores = contenidoValidado({ ...actual, ...req.body });
  } catch (error) {
    return responderError(res, error, 400);
  }

  const { data, error } = await supabase
    .from('contenidos_para_familias')
    .update({ ...valores, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .select(CAMPOS)
    .single();
  if (error) return responderError(res, errorDeGuardado(error));

  res.json({ contenido: data });
});

// Acá sí se borra, a diferencia de las formas de cobro: una forma que ya se contrató la siguen
// apuntando los accesos, y esto no lo apunta nadie. Es texto propio de la Prestadora, y un
// borrador equivocado tiene que poder sacarse —si no, el título que eligió mal le queda ocupado
// para siempre—. La confirmación la pide la pantalla.
panelContenidosRouter.delete('/:id', puedeEscribir, async (req, res) => {
  const { data: borrado, error } = await supabase
    .from('contenidos_para_familias')
    .delete()
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .select('id');
  if (error) return responderError(res, error);
  if (!borrado?.length) {
    return responderError(res, new ErrorConMotivo('no_encontrado', 'Contenido de otra Prestadora o inexistente'));
  }
  res.json({ ok: true });
});
