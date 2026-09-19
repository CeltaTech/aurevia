import { Router } from 'express';
import { supabase } from '../db/connection.js';
import { resolverPrestadoraPublica } from '../middleware/resolverPrestadoraPublica.js';
import { enviarEmailCoordinador } from '../utils/email.js';
import { normalizarIdioma } from '../i18n/idiomas.js';
import { idiomaDeLaPrestadora } from '../i18n/idiomaDeLaPrestadora.js';
import { aviso } from '../i18n/avisos.js';
import { responderError } from '../utils/errorConMotivo.js';
import { resolverEscalasVigentes, obtenerValorEscala } from '../utils/escalasLegales.js';
import { revisarPostulacion } from '../utils/postulacionCompleta.js';

// `mergeParams` para que llegue el `:prestadora` de la dirección donde se monta este router
// (server.js) — de ahí sale la Prestadora, no de un encabezado (resolverPrestadoraPublica.js).
export const postulacionAsistenteRouter = Router({ mergeParams: true });

// La edad mínima para trabajar es un valor legal: sale de `escalas_legales`, a la escala vigente
// el día de la postulación y en la jurisdicción de la Prestadora. Si no hay ninguna vigente
// devuelve `null`, y entonces nadie se rechaza por edad — ver `utils/postulacionCompleta.js`.
async function edadMinimaVigente(prestadoraId, hoy) {
  const { data: prestadora } = await supabase
    .from('prestadoras').select('pais').eq('id', prestadoraId).maybeSingle();
  if (!prestadora?.pais) return null;

  const { data: filas } = await supabase
    .from('escalas_legales').select('*')
    .eq('jurisdiccion', prestadora.pais)
    .eq('tipo', 'edad_minima_para_trabajar');
  if (!filas?.length) return null;

  const valor = obtenerValorEscala(resolverEscalasVigentes(filas, hoy, prestadora.pais), 'edad_minima_para_trabajar', 'general');
  return valor && valor > 0 ? valor : null;
}

// Las listas de opciones del formulario. El sitio público no consulta la base: se las pide acá,
// y el motor entra con la llave de servicio filtrando por la Prestadora que resolvió la
// dirección. Van sólo las activas y en su orden.
postulacionAsistenteRouter.get('/opciones', resolverPrestadoraPublica, async (req, res) => {
  const prestadoraId = req.prestadoraPublica.prestadora_id;

  const { data, error } = await supabase
    .from('opciones_postulacion')
    .select('grupo, clave, etiqueta, orden')
    .eq('prestadora_id', prestadoraId)
    .eq('activo', true)
    .order('grupo')
    .order('orden');

  if (error) return responderError(res, error);

  const porGrupo = {};
  for (const opcion of data) {
    (porGrupo[opcion.grupo] ??= []).push({ clave: opcion.clave, etiqueta: opcion.etiqueta });
  }

  const hoy = new Date().toISOString().slice(0, 10);
  res.json({ opciones: porGrupo, edad_minima: await edadMinimaVigente(prestadoraId, hoy) });
});

postulacionAsistenteRouter.post('/', resolverPrestadoraPublica, async (req, res) => {
  const prestadoraId = req.prestadoraPublica.prestadora_id;
  const hoy = new Date().toISOString().slice(0, 10);

  const { data: opciones, error: errorOpciones } = await supabase
    .from('opciones_postulacion')
    .select('grupo, clave, activo')
    .eq('prestadora_id', prestadoraId)
    .eq('activo', true);

  if (errorOpciones) return responderError(res, errorOpciones);

  const { error: motivo, datos } = revisarPostulacion(req.body, {
    opciones,
    edadMinima: await edadMinimaVigente(prestadoraId, hoy),
    hoy,
  });

  if (motivo) return res.status(400).json({ error: motivo });

  const { error } = await supabase.from('postulaciones').insert({
    ...datos,
    idioma: normalizarIdioma(req.body.idioma),
    prestadora_id: prestadoraId,
  });

  if (error) {
    console.error('Error insertando postulación:', error.message);
    return res.status(500).json({ error: 'error_guardando_postulacion' });
  }

  // El aviso lo lee el Coordinador, así que sale en el idioma de la Prestadora, no en el que la
  // Postulante eligió para el formulario: son dos personas distintas mirando el mismo hecho.
  try {
    await enviarEmailCoordinador({
      evento: 'nueva_postulacion_asistente',
      prestadoraId,
      // Del cuerpo del correo sale sólo el nombre: el documento, el teléfono, el correo y la
      // situación fiscal se miran en el Panel, que es donde el permiso se comprueba.
      ...aviso('nueva_postulacion_asistente', await idiomaDeLaPrestadora(prestadoraId), {
        nombre: datos.nombre,
      }),
    });
  } catch (err) {
    console.error('Error enviando email de postulación:', err.message);
  }

  res.status(201).json({ ok: true });
});
