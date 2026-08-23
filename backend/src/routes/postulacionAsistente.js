import { Router } from 'express';
import { supabase } from '../db/connection.js';
import { resolverPrestadoraPublica } from '../middleware/resolverPrestadoraPublica.js';
import { enviarEmailCoordinador } from '../utils/email.js';

// `mergeParams` para que llegue el `:prestadora` de la dirección donde se monta este router
// (server.js) — de ahí sale la Prestadora, no de un encabezado (resolverPrestadoraPublica.js).
export const postulacionAsistenteRouter = Router({ mergeParams: true });

const IDIOMAS_SOPORTADOS = ['es-AR', 'en', 'pt-BR'];

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
    idioma: IDIOMAS_SOPORTADOS.includes(idioma) ? idioma : 'es-AR',
    prestadora_id: req.prestadoraPublica.prestadora_id,
  });

  if (error) {
    console.error('Error insertando postulación:', error.message);
    return res.status(500).json({ error: 'error_guardando_postulacion' });
  }

  try {
    await enviarEmailCoordinador({
      evento: 'nueva_postulacion_asistente',
      prestadoraId: req.prestadoraPublica.prestadora_id,
      asunto: `Nueva postulación de Asistente — ${nombre}`,
      texto: `Nombre: ${nombre}\nDNI: ${dni}\nTeléfono: ${telefono}\nEmail: ${email}\nEspecialidades: ${especialidades}\nZonas: ${zonas}\nDisponibilidad: ${disponibilidad}\nSituación fiscal: ${situacion_fiscal}`,
    });
  } catch (err) {
    console.error('Error enviando email de postulación:', err.message);
  }

  res.status(201).json({ ok: true });
});
