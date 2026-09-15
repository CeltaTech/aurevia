import { Router } from 'express';
import { supabase } from '../db/connection.js';
import { resolverPrestadoraPublica } from '../middleware/resolverPrestadoraPublica.js';
import { enviarEmailCoordinador } from '../utils/email.js';
import { normalizarIdioma } from '../i18n/idiomas.js';
import { idiomaDeLaPrestadora } from '../i18n/idiomaDeLaPrestadora.js';
import { aviso } from '../i18n/avisos.js';

// `mergeParams` para que llegue el `:prestadora` de la dirección donde se monta este router
// (server.js) — de ahí sale la Prestadora, no de un encabezado (resolverPrestadoraPublica.js).
export const postulacionAsistenteRouter = Router({ mergeParams: true });

postulacionAsistenteRouter.post('/', resolverPrestadoraPublica, async (req, res) => {
  const {
    nombre, dni, telefono, email, especialidades, zonas, disponibilidad,
    anios_experiencia, situacion_fiscal, como_conocio, mensaje, idioma,
  } = req.body;

  if (!nombre || !dni || !telefono || !email || !especialidades || !zonas || !disponibilidad || !situacion_fiscal) {
    return res.status(400).json({ error: 'campos_obligatorios_faltantes' });
  }

  if (!/^\d{7,8}$/.test(dni)) {
    return res.status(400).json({ error: 'dni_invalido' });
  }

  const { error } = await supabase.from('postulaciones').insert({
    nombre, dni, telefono, email, especialidades, zonas, disponibilidad,
    anios_experiencia: anios_experiencia ?? null,
    situacion_fiscal,
    como_conocio: como_conocio ?? null,
    mensaje: mensaje ?? null,
    idioma: normalizarIdioma(idioma),
    prestadora_id: req.prestadoraPublica.prestadora_id,
  });

  if (error) {
    console.error('Error insertando postulación:', error.message);
    return res.status(500).json({ error: 'error_guardando_postulacion' });
  }

  // El aviso lo lee el Coordinador, así que sale en el idioma de la Prestadora, no en el que la
  // Postulante eligió para el formulario: son dos personas distintas mirando el mismo hecho.
  try {
    const prestadoraId = req.prestadoraPublica.prestadora_id;
    await enviarEmailCoordinador({
      evento: 'nueva_postulacion_asistente',
      prestadoraId,
      ...aviso('nueva_postulacion_asistente', await idiomaDeLaPrestadora(prestadoraId), {
        nombre, dni, telefono, email, especialidades, zonas, disponibilidad,
        situacionFiscal: situacion_fiscal,
      }),
    });
  } catch (err) {
    console.error('Error enviando email de postulación:', err.message);
  }

  res.status(201).json({ ok: true });
});
