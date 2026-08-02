import { Router } from 'express';
import multer from 'multer';
import { requiereRolPanel } from '../middleware/requiereRolPanel.js';
import { supabase } from '../db/connection.js';
import { tipoMatriculaRequerida, hayAsistenteAsignadoConMatricula } from '../utils/medicacionIndicaciones.js';

// Cierra pendiente #62 (docs/PENDIENTES.md): cola de revisión de indicaciones de
// medicación solicitadas por la Familia (appFamiliasMedicacion.js). Aceptar/rechazar nunca
// bloquea por falta de matrícula del Asistente (CLAUDE.md §3) — solo informa mediante
// el flag `sinMatricula`, que el Panel usa para disparar la advertencia legal ya
// existente (AdvertenciaLegalContext, funcion_clave 'medicacion_via_sin_matricula') antes
// de confirmar la aceptación.
//
// matriculas_asistente y configuracion_matricula_via_medicacion no tienen rutas CRUD
// acá: el Panel las gestiona directo vía supabase-js bajo RLS (mismo criterio que
// autorizaciones_monitoreo_paciente/rangos_referencia_vitales — RLS ya lo permite a
// admin_prestadora). Esta ruta solo resuelve el archivo de evidencia de matrícula,
// porque el bucket es privado y sin policies (regla 7, CLAUDE.md §6).

export const panelMedicacionRouter = Router();

const BUCKET = 'prescripciones-medicacion';
const TIPOS_PERMITIDOS = ['application/pdf', 'image/jpeg', 'image/png'];
const TAMANO_MAXIMO = 10 * 1024 * 1024; // 10 MB

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO },
  fileFilter(req, file, cb) {
    cb(null, TIPOS_PERMITIDOS.includes(file.mimetype));
  },
});

function manejarErrorMulter(err, req, res, next) {
  if (err) {
    return res.status(400).json({ error: 'Archivo no permitido (solo PDF, JPG o PNG, hasta 10 MB)' });
  }
  next();
}

panelMedicacionRouter.get('/pendientes', requiereRolPanel, async (req, res) => {
  const { data, error } = await supabase
    .from('indicaciones_medicacion')
    .select('id, medicamento, dosis, frecuencia, via_administracion, prescripcion_archivo_url, fecha_desde, fecha_hasta, created_at, pacientes(id, nombre), familias(id)')
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .eq('estado', 'pendiente')
    .order('created_at', { ascending: true });
  if (error) return res.status(500).json({ error: error.message });

  const pendientes = await Promise.all(
    (data || []).map(async (indicacion) => {
      const tipoRequerido = await tipoMatriculaRequerida(req.usuarioPanel.prestadoraId, indicacion.via_administracion);
      const sinMatricula = tipoRequerido
        ? !(await hayAsistenteAsignadoConMatricula(indicacion.pacientes.id, tipoRequerido))
        : false;
      return { ...indicacion, tipoMatriculaRequerida: tipoRequerido, sinMatricula };
    })
  );

  res.json({ pendientes });
});

panelMedicacionRouter.post('/:id/aceptar', requiereRolPanel, async (req, res) => {
  const { data: indicacion } = await supabase
    .from('indicaciones_medicacion')
    .select('id, estado')
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .eq('estado', 'pendiente')
    .maybeSingle();
  if (!indicacion) return res.status(404).json({ error: 'Indicación no encontrada o ya revisada' });

  const { error } = await supabase
    .from('indicaciones_medicacion')
    .update({ estado: 'aceptada', revisado_por: req.usuarioPanel.id, revisado_en: new Date().toISOString() })
    .eq('id', indicacion.id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

panelMedicacionRouter.post('/:id/rechazar', requiereRolPanel, async (req, res) => {
  const { motivo_rechazo: motivoRechazo } = req.body || {};
  if (!motivoRechazo) return res.status(400).json({ error: 'Falta el motivo del rechazo' });

  const { data: indicacion } = await supabase
    .from('indicaciones_medicacion')
    .select('id, estado')
    .eq('id', req.params.id)
    .eq('prestadora_id', req.usuarioPanel.prestadoraId)
    .eq('estado', 'pendiente')
    .maybeSingle();
  if (!indicacion) return res.status(404).json({ error: 'Indicación no encontrada o ya revisada' });

  const { error } = await supabase
    .from('indicaciones_medicacion')
    .update({
      estado: 'rechazada',
      motivo_rechazo: motivoRechazo,
      revisado_por: req.usuarioPanel.id,
      revisado_en: new Date().toISOString(),
    })
    .eq('id', indicacion.id);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ ok: true });
});

panelMedicacionRouter.post(
  '/matriculas/:asistenteId/archivo',
  requiereRolPanel,
  upload.single('archivo'),
  manejarErrorMulter,
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'Archivo faltante o de tipo no permitido (solo PDF, JPG o PNG, hasta 10 MB)' });
    }

    const { data: asistente } = await supabase
      .from('asistentes')
      .select('id, prestadora_id')
      .eq('id', req.params.asistenteId)
      .eq('prestadora_id', req.usuarioPanel.prestadoraId)
      .maybeSingle();
    if (!asistente) return res.status(404).json({ error: 'Asistente no encontrado' });

    const extension = req.file.mimetype === 'application/pdf' ? 'pdf' : req.file.mimetype === 'image/png' ? 'png' : 'jpg';
    const ruta = `${asistente.prestadora_id}/matriculas/${asistente.id}/matricula-${Date.now()}.${extension}`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(ruta, req.file.buffer, { contentType: req.file.mimetype, upsert: true });
    if (error) return res.status(500).json({ error: error.message });

    res.json({ archivoUrl: ruta });
  }
);

panelMedicacionRouter.get('/archivo-url', requiereRolPanel, async (req, res) => {
  const ruta = req.query.ruta;
  if (!ruta || !ruta.startsWith(`${req.usuarioPanel.prestadoraId}/`)) {
    return res.status(400).json({ error: 'Ruta de archivo inválida' });
  }

  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(ruta, 60);
  if (error) return res.status(500).json({ error: error.message });

  res.json({ url: data.signedUrl });
});
